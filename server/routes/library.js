import { Router } from 'express';
import { all, get, run, nowIso } from '../db.js';
import { generateReply, aiConfig } from '../services/ai.js';
import { personalise, isBusinessOpen } from '../services/text.js';
import { matches } from '../services/automation.js';

// Templates (saved replies) and automation rules.
export const templates = Router();
export const automations = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

templates.get('/', (req, res) => {
  res.json({ templates: all('SELECT * FROM templates ORDER BY category, name') });
});
templates.post('/', (req, res) => {
  const { name, body, category = 'general', shortcut } = req.body || {};
  if (!name?.trim() || !body?.trim()) throw bad('Name and message are required.');
  const info = run(
    'INSERT INTO templates(name, body, category, shortcut) VALUES(?, ?, ?, ?)',
    name.trim(),
    body,
    category || 'general',
    shortcut?.trim().replace(/^\//, '') || null,
  );
  res.json({ template: get('SELECT * FROM templates WHERE id = ?', Number(info.lastInsertRowid)) });
});
templates.put('/:id', (req, res) => {
  const { name, body, category, shortcut } = req.body || {};
  run(
    'UPDATE templates SET name = COALESCE(?, name), body = COALESCE(?, body), category = COALESCE(?, category), shortcut = ?, updated_at = ? WHERE id = ?',
    name ?? null,
    body ?? null,
    category ?? null,
    shortcut?.trim().replace(/^\//, '') || null,
    nowIso(),
    req.params.id,
  );
  res.json({ template: get('SELECT * FROM templates WHERE id = ?', req.params.id) });
});
templates.delete('/:id', (req, res) => {
  run('DELETE FROM templates WHERE id = ?', req.params.id);
  res.json({ ok: true });
});
templates.post('/preview', (req, res) => {
  res.json({ text: personalise(req.body?.body, req.body?.contact || { name: 'Priya Sharma', phone: '919800000000' }) });
});

const RULE_FIELDS = {
  name: 'name',
  enabled: 'enabled',
  sessionId: 'session_id',
  trigger: 'trigger_type',
  matchType: 'match_type',
  keywords: 'keywords',
  replyType: 'reply_type',
  replyBody: 'reply_body',
  addTag: 'add_tag',
  priority: 'priority',
  cooldownMinutes: 'cooldown_minutes',
  includeGroups: 'include_groups',
};

function ruleValues(body) {
  const out = {};
  for (const [k, col] of Object.entries(RULE_FIELDS)) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (['priority', 'cooldown_minutes'].includes(col)) v = Number(v) || 0;
    out[col] = v === '' && col !== 'keywords' ? null : v;
  }
  return out;
}

automations.get('/', (req, res) => {
  res.json({ automations: all('SELECT * FROM automations ORDER BY priority, id') });
});
automations.post('/', (req, res) => {
  const v = ruleValues(req.body || {});
  if (!v.name) throw bad('Give the rule a name.');
  if (v.trigger_type === 'keyword' && !String(v.keywords || '').trim()) throw bad('Add at least one keyword.');
  if (v.reply_type !== 'ai' && !String(v.reply_body || '').trim()) throw bad('Write the reply message.');
  const cols = Object.keys(v);
  const info = run(`INSERT INTO automations(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(', ')})`, ...cols.map((c) => v[c]));
  res.json({ automation: get('SELECT * FROM automations WHERE id = ?', Number(info.lastInsertRowid)) });
});
automations.put('/:id', (req, res) => {
  const v = ruleValues(req.body || {});
  const cols = Object.keys(v);
  if (cols.length) run(`UPDATE automations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => v[c]), req.params.id);
  res.json({ automation: get('SELECT * FROM automations WHERE id = ?', req.params.id) });
});
automations.delete('/:id', (req, res) => {
  run('DELETE FROM automations WHERE id = ?', req.params.id);
  run('DELETE FROM automation_hits WHERE automation_id = ?', req.params.id);
  res.json({ ok: true });
});

// Simulate an incoming message: which rule fires and what would the reply be?
automations.post('/simulate', async (req, res) => {
  const text = String(req.body?.text || '');
  const firstMessage = Boolean(req.body?.firstMessage);
  const rules = all('SELECT * FROM automations WHERE enabled = 1 ORDER BY priority, id');
  for (const rule of rules) {
    let hit = false;
    if (rule.trigger_type === 'welcome') hit = firstMessage;
    else if (rule.trigger_type === 'away') hit = !isBusinessOpen();
    else if (rule.trigger_type === 'any') hit = true;
    else if (rule.trigger_type === 'keyword') hit = matches(rule, text);
    if (hit) {
      const reply =
        rule.reply_type === 'ai'
          ? await generateReply({ messages: [{ role: 'user', content: text }] }).catch((e) => `⚠️ ${e.message}`)
          : personalise(rule.reply_body, { name: 'Priya Sharma', phone: '919800000000' });
      return res.json({ matched: rule, reply });
    }
  }
  const ai = aiConfig();
  if (ai.enabled && ai.apiKey) {
    const reply = await generateReply({ messages: [{ role: 'user', content: text }] }).catch((e) => `⚠️ ${e.message}`);
    return res.json({ matched: { name: 'AI assistant (fallback)' }, reply });
  }
  res.json({ matched: null, reply: null });
});

export const ai = Router();
ai.post('/test', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) throw bad('Type a customer message to test.');
  const overrides = {};
  for (const k of ['persona', 'knowledge', 'model', 'effort']) {
    if (req.body?.overrides?.[k]) overrides[k] = req.body.overrides[k];
  }
  const reply = await generateReply({ messages: [{ role: 'user', content: text }], overrides });
  res.json({ reply: reply || '(no reply)' });
});
