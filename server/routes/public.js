import { Router } from 'express';
import { all, get, run, parseJson } from '../db.js';
import { requireApiKey } from '../auth.js';
import { request } from '../services/openwa.js';
import { engineState } from '../services/monitor.js';
import { sendMessage, upsertContact } from '../services/messaging.js';
import { metaReady, META_SESSION, metaSendTemplate } from '../services/meta.js';
import { normalizePhone, personalise } from '../services/text.js';

// Public REST API for your own apps (CRM, website, n8n, …). Auth: X-WaBridge-Key header.
const r = Router();
r.use(requireApiKey);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function pickSession(numberId, channel) {
  if (channel === 'meta') {
    if (!metaReady()) throw bad('The official Meta channel is not configured.', 409);
    return META_SESSION;
  }
  const sessions = engineState.sessions || [];
  if (numberId) {
    const s = sessions.find((x) => x.id === numberId || x.name === numberId);
    if (!s) throw bad('Unknown numberId.', 404);
    if (s.status !== 'ready' && channel !== 'auto') throw bad(`Number "${s.name}" is ${s.status}.`, 409);
    if (s.status === 'ready') return s.id;
  }
  const ready = sessions.find((x) => x.status === 'ready');
  if (ready) return ready.id;
  if ((channel === 'auto' || !channel) && metaReady()) return META_SESSION;
  throw bad('No connected WhatsApp number is available.', 409);
}

r.get('/numbers', (req, res) => {
  res.json({
    numbers: (engineState.sessions || []).map((s) => ({ id: s.id, name: s.name, status: s.status, phone: s.phone })),
    officialChannel: metaReady(),
  });
});

r.post('/messages', async (req, res) => {
  const { to, text, media, numberId, channel = 'auto', name } = req.body || {};
  const phone = normalizePhone(to);
  if (!phone) throw bad('"to" must be a phone number with country code.');
  if (!text && !media) throw bad('Send "text" or "media".');
  const sessionId = pickSession(numberId, channel);
  const m = media
    ? { kind: media.type || 'image', url: media.url, base64: media.base64, mimetype: media.mimetype, filename: media.filename, caption: media.caption || text }
    : undefined;
  const out = await sendMessage({ sessionId, phone, text, media: m, name, author: 'api' });
  res.status(201).json({
    id: out.message.id,
    waId: out.message.wa_id,
    status: out.message.status,
    numberId: sessionId,
    conversationId: out.conversation.id,
  });
});

r.post('/messages/template', async (req, res) => {
  const { to, templateId, templateName, variables = {}, numberId, language, params } = req.body || {};
  const phone = normalizePhone(to);
  if (!phone) throw bad('"to" must be a phone number with country code.');
  const contact = get('SELECT * FROM contacts WHERE phone = ?', phone) || { phone };
  const vars = { ...contact, fields: { ...parseJson(contact.fields, {}), ...variables } };
  if (templateName && !templateId && req.body.channel === 'meta') {
    const out = await metaSendTemplate(phone, templateName, language || 'en', (params || []).map((p) => personalise(p, vars)));
    return res.status(201).json({ waId: out.messageId, numberId: META_SESSION });
  }
  const t = templateId
    ? get('SELECT * FROM templates WHERE id = ?', templateId)
    : get('SELECT * FROM templates WHERE name = ? COLLATE NOCASE', templateName || '');
  if (!t) throw bad('Template not found.', 404);
  const sessionId = pickSession(numberId, 'auto');
  const out = await sendMessage({ sessionId, phone, text: personalise(t.body, vars), author: 'api' });
  res.status(201).json({ id: out.message.id, waId: out.message.wa_id, status: out.message.status, numberId: sessionId });
});

r.get('/messages/:id', (req, res) => {
  const m = get('SELECT id, wa_id, direction, type, body, status, error, created_at FROM messages WHERE id = ?', req.params.id);
  if (!m) throw bad('Message not found.', 404);
  res.json(m);
});

r.post('/contacts', (req, res) => {
  const { phone, name, email, tags, optedIn } = req.body || {};
  const p = normalizePhone(phone);
  if (!p) throw bad('Invalid phone.');
  const c = upsertContact(p, name, 'api');
  if (email) run('UPDATE contacts SET email = ? WHERE id = ?', email, c.id);
  if (Array.isArray(tags)) {
    const merged = [...new Set([...parseJson(c.tags, []), ...tags.map(String)])];
    run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify(merged), c.id);
  }
  if (optedIn !== undefined) run('UPDATE contacts SET opted_in = ?, opted_out = CASE WHEN ? THEN 0 ELSE opted_out END WHERE id = ?', optedIn ? 1 : 0, optedIn ? 1 : 0, c.id);
  const row = get('SELECT * FROM contacts WHERE id = ?', c.id);
  res.json({ ...row, tags: parseJson(row.tags, []), fields: parseJson(row.fields, {}) });
});

r.get('/conversations', (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const rows = phone
    ? all('SELECT * FROM conversations WHERE phone = ? ORDER BY last_at DESC', phone)
    : all('SELECT * FROM conversations ORDER BY last_at DESC LIMIT 50');
  res.json({ conversations: rows });
});

// Full engine passthrough: /api/v1/engine/<anything> → OpenWA /api/<anything>
r.all('/engine/*path', async (req, res) => {
  const sub = [].concat(req.params.path).join('/');
  const out = await request(req.method, `/api/${sub}`, {
    body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : req.body,
    query: req.query,
    raw: true,
    timeoutMs: 120000,
  });
  res.status(out.status).json(out.data);
});

export default r;
