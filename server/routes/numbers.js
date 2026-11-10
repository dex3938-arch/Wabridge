import { Router } from 'express';
import { all, get, run, logActivity } from '../db.js';
import { requireAdmin } from '../auth.js';
import { engine } from '../services/openwa.js';
import { ensureWebhook, forgetSession, engineState, tick } from '../services/monitor.js';
import { upsertConversation } from '../services/messaging.js';
import { metaConfig, metaReady, META_SESSION } from '../services/meta.js';
import { normalizePhone, isGroupChat } from '../services/text.js';

const r = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function todayCounts() {
  const rows = all(
    `SELECT c.session_id, m.direction, COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.created_at >= strftime('%Y-%m-%dT00:00:00Z','now') GROUP BY c.session_id, m.direction`,
  );
  const map = {};
  for (const x of rows) {
    map[x.session_id] ??= { in: 0, out: 0 };
    map[x.session_id][x.direction] = x.n;
  }
  return map;
}

function warmupDay(startedAt) {
  if (!startedAt) return null;
  return Math.floor((Date.now() - Date.parse(startedAt)) / 86400000) + 1;
}

// Engine numbers merged with WaBridge metadata, plus the official channel when configured.
r.get('/', async (req, res) => {
  let sessions = [];
  let engineError = null;
  try {
    sessions = await engine.listSessions();
  } catch (e) {
    engineError = e.message;
    sessions = engineState.sessions || [];
  }
  const meta = Object.fromEntries(all('SELECT * FROM numbers').map((n) => [n.session_id, n]));
  const counts = todayCounts();
  const list = sessions.map((s) => ({
    id: s.id,
    channel: 'openwa',
    name: s.name,
    status: s.status,
    phone: s.phone,
    pushName: s.pushName,
    connectedAt: s.connectedAt,
    lastActive: s.lastActive,
    lastError: s.lastError,
    restriction: s.restriction,
    label: meta[s.id]?.label || s.name,
    color: meta[s.id]?.color || null,
    dailyLimit: meta[s.id]?.daily_limit || null,
    warmupDay: warmupDay(meta[s.id]?.warmup_started_at),
    today: counts[s.id] || { in: 0, out: 0 },
  }));
  const mc = metaConfig();
  if (mc.enabled) {
    list.push({
      id: META_SESSION,
      channel: 'meta',
      name: 'Official Cloud API',
      label: 'Official WhatsApp (Meta)',
      status: metaReady() ? 'ready' : 'action_required',
      phone: mc.phoneNumberId ? `ID ${mc.phoneNumberId}` : null,
      today: counts[META_SESSION] || { in: 0, out: 0 },
    });
  }
  res.json({ numbers: list, engine: { online: !engineError, error: engineError } });
});

r.post('/', requireAdmin, async (req, res) => {
  const { name, label, proxyUrl, dailyLimit } = req.body || {};
  const slug = String(name || label || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (slug.length < 3) throw bad('Name must be at least 3 letters or numbers.');
  const session = await engine.createSession(slug, proxyUrl?.trim() || undefined);
  run(
    'INSERT OR REPLACE INTO numbers(session_id, label, daily_limit) VALUES(?, ?, ?)',
    session.id,
    label?.trim() || name,
    Number(dailyLimit) || null,
  );
  await ensureWebhook(session.id, true).catch(() => {});
  const started = await engine.startSession(session.id);
  logActivity('session.created', `Number "${label || slug}" added`, { userId: req.user.id, meta: { sessionId: session.id } });
  void tick();
  res.json({ session: started || session });
});

r.patch('/:id', requireAdmin, async (req, res) => {
  const { label, color, dailyLimit, proxyUrl } = req.body || {};
  const id = req.params.id;
  if (!get('SELECT 1 FROM numbers WHERE session_id = ?', id)) run('INSERT INTO numbers(session_id) VALUES(?)', id);
  if (label !== undefined) run('UPDATE numbers SET label = ? WHERE session_id = ?', label, id);
  if (color !== undefined) run('UPDATE numbers SET color = ? WHERE session_id = ?', color, id);
  if (dailyLimit !== undefined) run('UPDATE numbers SET daily_limit = ? WHERE session_id = ?', Number(dailyLimit) || null, id);
  if (proxyUrl !== undefined) await engine.setProxy(id, proxyUrl || '');
  res.json({ ok: true });
});

for (const action of ['start', 'stop', 'logout']) {
  r.post(`/:id/${action}`, requireAdmin, async (req, res) => {
    const fn = { start: engine.startSession, stop: engine.stopSession, logout: engine.logoutSession }[action];
    const out = await fn(req.params.id);
    if (action === 'start') await ensureWebhook(req.params.id, true).catch(() => {});
    logActivity(`session.${action}`, `Number ${action} requested`, { userId: req.user.id, meta: { sessionId: req.params.id } });
    void tick();
    res.json(out || { ok: true });
  });
}

r.post('/:id/restart', requireAdmin, async (req, res) => {
  await engine.stopSession(req.params.id).catch(() => {});
  const out = await engine.startSession(req.params.id);
  void tick();
  res.json(out || { ok: true });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  await engine.deleteSession(req.params.id);
  run('DELETE FROM numbers WHERE session_id = ?', req.params.id);
  forgetSession(req.params.id);
  logActivity('session.deleted', 'Number removed', { level: 'warn', userId: req.user.id, meta: { sessionId: req.params.id } });
  void tick();
  res.json({ ok: true });
});

r.get('/:id/qr', async (req, res) => {
  try {
    res.json(await engine.getQr(req.params.id));
  } catch (e) {
    const s = await engine.getSession(req.params.id).catch(() => null);
    res.json({ qrCode: null, status: s?.status || 'unknown', message: e.message });
  }
});

r.post('/:id/pairing-code', requireAdmin, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw bad('Enter the phone number with country code.');
  res.json(await engine.pairingCode(req.params.id, phone));
});

// Pull the most recent chats from WhatsApp into the inbox.
r.post('/:id/sync-chats', async (req, res) => {
  const chats = await engine.chats(req.params.id, Number(req.body?.limit) || 50);
  let imported = 0;
  for (const c of chats || []) {
    if (!c.id || ['status', 'broadcast', 'channel'].includes(c.kind)) continue;
    const conv = upsertConversation({ sessionId: req.params.id, chatId: c.id, name: c.name });
    const lastAt = c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null;
    if (lastAt && (!conv.last_at || lastAt > conv.last_at)) {
      run(
        'UPDATE conversations SET last_message = COALESCE(?, last_message), last_at = ?, unread = ?, is_group = ? WHERE id = ?',
        c.lastMessage || null,
        lastAt,
        c.unreadCount || 0,
        isGroupChat(c.id) ? 1 : 0,
        conv.id,
      );
    }
    imported++;
  }
  res.json({ imported });
});

r.get('/:id/groups', async (req, res) => res.json(await engine.groups(req.params.id)));

// Bulk "is this number on WhatsApp?" check (max 50 per call to stay gentle).
r.post('/:id/check', async (req, res) => {
  const phones = (req.body?.phones || []).map((p) => normalizePhone(p)).filter(Boolean).slice(0, 50);
  const results = [];
  for (const p of phones) {
    try {
      const out = await engine.checkNumber(req.params.id, p);
      results.push({ phone: p, exists: Boolean(out?.exists), whatsappId: out?.whatsappId });
      run('UPDATE contacts SET on_whatsapp = ? WHERE phone = ?', out?.exists ? 1 : 0, p);
    } catch (e) {
      results.push({ phone: p, exists: null, error: e.message });
    }
  }
  res.json({ results });
});

export default r;
