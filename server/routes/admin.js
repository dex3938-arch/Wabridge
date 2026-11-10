import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get, run, getSettings, saveSettings, DEFAULT_SETTINGS, parseJson, logActivity } from '../db.js';
import { requireAdmin, hashPassword, createApiKey } from '../auth.js';
import { config } from '../config.js';
import { request, engine } from '../services/openwa.js';
import { engineState, hookUrl, tick } from '../services/monitor.js';
import { OUTBOUND_EVENTS, testOutbound } from '../services/outbound.js';
import { metaConfig, metaPhoneInfo, metaTemplates } from '../services/meta.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------------- settings ----------------
export const settings = Router();
const SECRET_KEYS = { ai: ['apiKey'], meta: ['accessToken', 'appSecret'], engine: ['webhookSecret'] };
const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');

settings.get('/', (req, res) => {
  const out = {};
  for (const section of Object.keys(DEFAULT_SETTINGS)) {
    if (section === 'engine') continue;
    const s = getSettings(section);
    for (const k of SECRET_KEYS[section] || []) {
      s[`${k}Set`] = Boolean(s[k]);
      s[k] = mask(s[k]);
    }
    out[section] = s;
  }
  out.ai.apiKeySet ||= Boolean(config.anthropicKey);
  out.ai.apiKeyFromEnv = !getSettings('ai').apiKey && Boolean(config.anthropicKey);
  const mc = metaConfig();
  out.meta.webhookUrl = `${config.publicUrl}/hooks/meta`;
  out.meta.verifyTokenSet = Boolean(mc.verifyToken);
  res.json(out);
});

settings.put('/:section', requireAdmin, (req, res) => {
  const section = req.params.section;
  if (!DEFAULT_SETTINGS[section] || section === 'engine') throw bad('Unknown settings section.', 404);
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULT_SETTINGS[section])) continue;
    // Secrets: an empty or masked value means "keep the saved one"; null clears it.
    if ((SECRET_KEYS[section] || []).includes(k)) {
      if (v === null) patch[k] = '';
      else if (typeof v === 'string' && v && !v.startsWith('••••')) patch[k] = v.trim();
      continue;
    }
    patch[k] = v;
  }
  if (section === 'meta' && patch.enabled && !patch.verifyToken && !getSettings('meta').verifyToken) {
    patch.verifyToken = crypto.randomBytes(12).toString('hex');
  }
  saveSettings(section, patch);
  logActivity('settings.updated', `Settings updated: ${section}`, { userId: req.user.id });
  res.json({ ok: true });
});

// ---------------- engine status ----------------
export const engineRoutes = Router();
engineRoutes.get('/', async (req, res) => {
  let health = null;
  let current = null;
  try {
    health = await engine.health();
    current = await engine.currentEngine().catch(() => null);
  } catch (e) {
    health = { status: 'down', error: e.message };
  }
  res.json({
    url: config.openwaUrl,
    keySet: Boolean(config.openwaKey),
    online: health?.status === 'ok',
    health,
    engineType: current?.engine || current?.type || current?.name || current || null,
    webhookUrl: hookUrl(),
    checkedAt: engineState.checkedAt,
  });
});
engineRoutes.post('/refresh', async (req, res) => {
  await tick();
  res.json({ online: engineState.online, error: engineState.error });
});

// ---------------- integrations ----------------
export const integrations = Router();
integrations.use(requireAdmin);

integrations.get('/webhooks', (req, res) => {
  const hooks = all('SELECT * FROM outbound_webhooks ORDER BY id DESC').map((h) => ({
    ...h,
    events: parseJson(h.events, ['*']),
    secret: undefined,
    secretHint: mask(h.secret),
  }));
  res.json({ webhooks: hooks, events: OUTBOUND_EVENTS });
});
integrations.post('/webhooks', (req, res) => {
  const { name, url, events = ['*'] } = req.body || {};
  if (!/^https?:\/\//i.test(url || '')) throw bad('Enter a full URL starting with http:// or https://');
  const secret = `whsec_${crypto.randomBytes(20).toString('hex')}`;
  const info = run('INSERT INTO outbound_webhooks(name, url, events, secret) VALUES(?, ?, ?, ?)', name || 'Webhook', url, JSON.stringify(events), secret);
  res.json({ id: Number(info.lastInsertRowid), secret });
});
integrations.put('/webhooks/:id', (req, res) => {
  const { name, url, events, active } = req.body || {};
  const h = get('SELECT * FROM outbound_webhooks WHERE id = ?', req.params.id);
  if (!h) throw bad('Webhook not found.', 404);
  run(
    'UPDATE outbound_webhooks SET name = ?, url = ?, events = ?, active = ? WHERE id = ?',
    name ?? h.name,
    url ?? h.url,
    events ? JSON.stringify(events) : h.events,
    active === undefined ? h.active : active ? 1 : 0,
    h.id,
  );
  res.json({ ok: true });
});
integrations.delete('/webhooks/:id', (req, res) => {
  run('DELETE FROM outbound_webhooks WHERE id = ?', req.params.id);
  res.json({ ok: true });
});
integrations.post('/webhooks/:id/test', async (req, res) => {
  const h = get('SELECT * FROM outbound_webhooks WHERE id = ?', req.params.id);
  if (!h) throw bad('Webhook not found.', 404);
  res.json(await testOutbound(h));
});

integrations.get('/api-keys', (req, res) => {
  res.json({ keys: all('SELECT id, name, prefix, scope, last_used_at, revoked, created_at FROM api_keys ORDER BY id DESC') });
});
integrations.post('/api-keys', (req, res) => {
  const name = String(req.body?.name || '').trim() || 'API key';
  const { key, prefix, hash } = createApiKey();
  run('INSERT INTO api_keys(name, prefix, key_hash) VALUES(?, ?, ?)', name, prefix, hash);
  logActivity('apikey.created', `API key "${name}" created`, { userId: req.user.id });
  res.json({ key, prefix });
});
integrations.post('/api-keys/:id/revoke', (req, res) => {
  run('UPDATE api_keys SET revoked = 1 WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

integrations.get('/meta/status', async (req, res) => {
  const c = metaConfig();
  if (!c.phoneNumberId || !c.accessToken) return res.json({ connected: false, reason: 'Add the Phone Number ID and access token.' });
  try {
    res.json({ connected: true, phone: await metaPhoneInfo() });
  } catch (e) {
    res.json({ connected: false, reason: e.message });
  }
});
integrations.get('/meta/templates', async (req, res) => {
  res.json({ templates: await metaTemplates() });
});

// ---------------- team ----------------
export const team = Router();
team.get('/', (req, res) => {
  res.json({ users: all('SELECT id, name, email, role, active, last_login, created_at FROM users ORDER BY id') });
});
team.post('/', requireAdmin, (req, res) => {
  const { name, email, password, role = 'agent' } = req.body || {};
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '')) throw bad('Enter a name and a valid email.');
  if (!password || password.length < 8) throw bad('Password must be at least 8 characters.');
  if (get('SELECT 1 FROM users WHERE email = ?', email.trim())) throw bad('This email is already on the team.', 409);
  run('INSERT INTO users(name, email, password_hash, role) VALUES(?, ?, ?, ?)', name.trim(), email.trim(), hashPassword(password), role === 'admin' ? 'admin' : 'agent');
  logActivity('team.added', `${name} joined the team as ${role}`, { userId: req.user.id });
  res.json({ ok: true });
});
team.put('/:id', requireAdmin, (req, res) => {
  const { role, active, password, name } = req.body || {};
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw bad('User not found.', 404);
  const admins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;
  if (u.role === 'admin' && admins <= 1 && (role === 'agent' || active === false)) throw bad('Keep at least one active admin.');
  if (role) run('UPDATE users SET role = ? WHERE id = ?', role === 'admin' ? 'admin' : 'agent', u.id);
  if (active !== undefined) run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, u.id);
  if (name) run('UPDATE users SET name = ? WHERE id = ?', name, u.id);
  if (password) {
    if (password.length < 8) throw bad('Password must be at least 8 characters.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
  }
  res.json({ ok: true });
});
team.delete('/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) throw bad('You cannot remove yourself.');
  const u = get('SELECT role FROM users WHERE id = ?', req.params.id);
  if (u?.role === 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n <= 1) throw bad('Keep at least one admin.');
  run('DELETE FROM users WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---------------- activity ----------------
export const activity = Router();
activity.get('/', (req, res) => {
  const { level, limit = 100 } = req.query;
  const rows = level
    ? all('SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE level = ? ORDER BY a.id DESC LIMIT ?', level, Number(limit))
    : all('SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?', Number(limit));
  res.json({ activity: rows.map((a) => ({ ...a, meta: parseJson(a.meta, null) })) });
});

// ---------------- API explorer (full engine access) ----------------
export const explorer = Router();
explorer.use(requireAdmin);
explorer.get('/spec', async (req, res) => {
  const out = await request('GET', '/api/docs-json', { raw: true });
  if (out.status !== 200 || typeof out.data !== 'object') {
    return res.json({ endpoints: [], note: 'Engine API docs are disabled. Set ENABLE_SWAGGER=true on the engine to list endpoints here.' });
  }
  const endpoints = [];
  for (const [path, ops] of Object.entries(out.data.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const ref = op.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop();
      const schema = ref ? out.data.components?.schemas?.[ref] : null;
      const example = {};
      for (const [k, v] of Object.entries(schema?.properties || {})) {
        if (!(schema.required || []).includes(k)) continue;
        example[k] = v.example ?? (v.type === 'number' ? 0 : v.type === 'boolean' ? false : v.type === 'array' ? [] : '');
      }
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: op.summary || '',
        tag: op.tags?.[0] || 'Other',
        example: ref ? example : null,
      });
    }
  }
  res.json({ endpoints });
});
explorer.post('/', async (req, res) => {
  const { method = 'GET', path = '', body, query } = req.body || {};
  if (!String(path).startsWith('/api/')) throw bad('Path must start with /api/');
  const started = Date.now();
  const out = await request(String(method).toUpperCase(), path, {
    body: ['GET', 'DELETE'].includes(String(method).toUpperCase()) ? undefined : body,
    query,
    raw: true,
    timeoutMs: 60000,
  });
  res.json({ ...out, ms: Date.now() - started });
});
