import { Router } from 'express';
import { all, get, run, nowIso, logActivity, getSettings } from '../db.js';
import { campaignView, buildRecipients, campaignTick } from '../services/campaigns.js';
import { sendMessage } from '../services/messaging.js';
import { metaSendTemplate, META_SESSION } from '../services/meta.js';
import { saveBase64 } from '../services/media.js';
import { personalise, normalizePhone } from '../services/text.js';
import { broadcast } from '../services/events.js';

const r = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function fieldsFrom(body) {
  const safety = getSettings('safety');
  const f = {};
  if (body.name !== undefined) f.name = String(body.name).trim();
  if (body.channel !== undefined) f.channel = body.channel === 'meta' ? 'meta' : 'openwa';
  if (body.sessionId !== undefined) f.session_id = body.sessionId;
  if (body.body !== undefined) f.body = body.body;
  if (body.audience !== undefined) f.audience = JSON.stringify(body.audience || {});
  if (body.metaTemplate !== undefined) f.meta_template = JSON.stringify(body.metaTemplate || null);
  if (body.media !== undefined) {
    let media = body.media;
    if (media?.base64) {
      media = { kind: media.kind, path: saveBase64(media.base64, media.mimetype, media.filename), mimetype: media.mimetype, filename: media.filename };
    }
    f.media = JSON.stringify(media || null);
  }
  if (body.minDelay !== undefined) f.min_delay = Math.max(5, Number(body.minDelay) || safety.defaultMinDelay);
  if (body.maxDelay !== undefined) f.max_delay = Math.max(f.min_delay || 5, Number(body.maxDelay) || safety.defaultMaxDelay);
  if (body.dailyCap !== undefined) f.daily_cap = Math.max(1, Number(body.dailyCap) || safety.defaultDailyCap);
  if (body.quietStart !== undefined) f.quiet_start = body.quietStart || null;
  if (body.quietEnd !== undefined) f.quiet_end = body.quietEnd || null;
  if (body.stopAfterFailures !== undefined) f.stop_after_failures = Math.max(1, Number(body.stopAfterFailures) || 5);
  if (body.requireOptIn !== undefined) f.require_opt_in = body.requireOptIn ? 1 : 0;
  return f;
}

r.get('/', (req, res) => {
  const rows = all('SELECT id FROM campaigns ORDER BY id DESC LIMIT 200');
  res.json({ campaigns: rows.map((x) => campaignView(x.id)) });
});

r.get('/:id', (req, res) => {
  const c = campaignView(req.params.id);
  if (!c) throw bad('Campaign not found.', 404);
  const recipients = all(
    'SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY CASE status WHEN \'failed\' THEN 0 WHEN \'pending\' THEN 1 ELSE 2 END, id LIMIT 300',
    c.id,
  );
  const replies = get(
    `SELECT COUNT(DISTINCT cr.phone) AS n FROM campaign_recipients cr
       JOIN conversations cv ON cv.phone = cr.phone
       JOIN messages m ON m.conversation_id = cv.id AND m.direction = 'in' AND m.created_at > cr.sent_at
      WHERE cr.campaign_id = ? AND cr.status = 'sent'`,
    c.id,
  ).n;
  res.json({ campaign: c, recipients, replies });
});

r.post('/', (req, res) => {
  const f = fieldsFrom(req.body || {});
  if (!f.name) throw bad('Give the campaign a name.');
  const safety = getSettings('safety');
  const info = run(
    `INSERT INTO campaigns(name, channel, session_id, body, media, meta_template, audience, min_delay, max_delay, daily_cap,
       quiet_start, quiet_end, stop_after_failures, require_opt_in, created_by)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.name,
    f.channel || 'openwa',
    f.session_id || null,
    f.body || '',
    f.media || null,
    f.meta_template || null,
    f.audience || '{}',
    f.min_delay ?? safety.defaultMinDelay,
    f.max_delay ?? safety.defaultMaxDelay,
    f.daily_cap ?? safety.defaultDailyCap,
    f.quiet_start ?? '21:00',
    f.quiet_end ?? '09:00',
    f.stop_after_failures ?? 5,
    f.require_opt_in ?? 1,
    req.user.id,
  );
  res.json({ campaign: campaignView(Number(info.lastInsertRowid)) });
});

r.patch('/:id', (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ?', req.params.id);
  if (!c) throw bad('Campaign not found.', 404);
  if (!['draft', 'paused', 'scheduled'].includes(c.status)) throw bad('Pause the campaign before editing it.', 409);
  const f = fieldsFrom(req.body || {});
  const keys = Object.keys(f);
  if (keys.length) run(`UPDATE campaigns SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), c.id);
  res.json({ campaign: campaignView(c.id) });
});

// Count the audience before launching (no side effects).
r.post('/audience-preview', (req, res) => {
  const fake = { id: -1, audience: JSON.stringify(req.body?.audience || {}), require_opt_in: req.body?.requireOptIn ? 1 : 0 };
  const audience = req.body?.audience || {};
  const tags = audience.tags || [];
  const { all: allContacts } = audience;
  let rows = [];
  if (allContacts) rows = all('SELECT phone, opted_in, opted_out, tags FROM contacts');
  else if (tags.length) {
    rows = all('SELECT phone, opted_in, opted_out, tags FROM contacts').filter((c) => {
      const t = JSON.parse(c.tags || '[]');
      return audience.match === 'all' ? tags.every((x) => t.includes(x)) : tags.some((x) => t.includes(x));
    });
  }
  const phones = new Set(rows.map((x) => x.phone));
  let pasted = 0;
  for (const line of audience.phones || []) {
    const p = normalizePhone(String(line).split(/[,;\t]/)[0]);
    if (p && !phones.has(p)) {
      phones.add(p);
      pasted++;
    }
  }
  const optedOut = rows.filter((x) => x.opted_out).length;
  const noConsent = fake.require_opt_in ? rows.filter((x) => !x.opted_in && !x.opted_out).length + pasted : 0;
  res.json({ total: phones.size, optedOut, noConsent, willSend: Math.max(0, phones.size - optedOut - noConsent) });
});

r.post('/:id/launch', (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ?', req.params.id);
  if (!c) throw bad('Campaign not found.', 404);
  if (!['draft', 'paused', 'scheduled'].includes(c.status)) throw bad('This campaign has already run.', 409);
  if (c.channel === 'openwa' && !c.session_id) throw bad('Choose the WhatsApp number to send from.');
  if (c.channel === 'openwa' && !String(c.body || '').trim()) throw bad('Write the message first.');
  if (c.channel === 'meta' && !JSON.parse(c.meta_template || 'null')?.name) throw bad('Choose an approved Meta template.');
  if (c.status === 'draft') {
    const { total, skipped } = buildRecipients(c);
    if (total - skipped <= 0) throw bad('Nobody to send to — check the audience and opt-in setting.');
  }
  const scheduleAt = req.body?.scheduleAt ? new Date(req.body.scheduleAt).toISOString() : null;
  if (scheduleAt && scheduleAt > nowIso()) {
    run("UPDATE campaigns SET status = 'scheduled', schedule_at = ?, last_error = NULL WHERE id = ?", scheduleAt, c.id);
  } else {
    run(
      "UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, ?), next_send_at = ?, consecutive_failures = 0, last_error = NULL WHERE id = ?",
      nowIso(),
      nowIso(),
      c.id,
    );
  }
  logActivity('campaign.launched', `Campaign "${c.name}" ${scheduleAt ? 'scheduled' : 'started'}`, { userId: req.user.id });
  const view = campaignView(c.id);
  broadcast('campaign', view);
  void campaignTick();
  res.json({ campaign: view });
});

r.post('/:id/pause', (req, res) => {
  run("UPDATE campaigns SET status = 'paused', last_error = 'Paused by user' WHERE id = ? AND status IN ('running','scheduled')", req.params.id);
  const view = campaignView(req.params.id);
  broadcast('campaign', view);
  res.json({ campaign: view });
});

r.post('/:id/cancel', (req, res) => {
  run("UPDATE campaigns SET status = 'cancelled', finished_at = ? WHERE id = ? AND status NOT IN ('completed','cancelled')", nowIso(), req.params.id);
  run("UPDATE campaign_recipients SET status = 'skipped', error = 'Campaign cancelled' WHERE campaign_id = ? AND status = 'pending'", req.params.id);
  const view = campaignView(req.params.id);
  broadcast('campaign', view);
  res.json({ campaign: view });
});

r.post('/:id/retry-failed', (req, res) => {
  const n = run("UPDATE campaign_recipients SET status = 'pending', error = NULL WHERE campaign_id = ? AND status = 'failed'", req.params.id).changes;
  run("UPDATE campaigns SET failed = MAX(0, failed - ?), status = CASE WHEN status IN ('completed','paused') THEN 'paused' ELSE status END WHERE id = ?", n, req.params.id);
  res.json({ requeued: n, campaign: campaignView(req.params.id) });
});

r.post('/:id/duplicate', (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ?', req.params.id);
  if (!c) throw bad('Campaign not found.', 404);
  const info = run(
    `INSERT INTO campaigns(name, channel, session_id, body, media, meta_template, audience, min_delay, max_delay, daily_cap,
       quiet_start, quiet_end, stop_after_failures, require_opt_in, created_by)
     SELECT name || ' (copy)', channel, session_id, body, media, meta_template, audience, min_delay, max_delay, daily_cap,
       quiet_start, quiet_end, stop_after_failures, require_opt_in, ? FROM campaigns WHERE id = ?`,
    req.user.id,
    c.id,
  );
  res.json({ campaign: campaignView(Number(info.lastInsertRowid)) });
});

r.delete('/:id', (req, res) => {
  const c = get('SELECT status FROM campaigns WHERE id = ?', req.params.id);
  if (c?.status === 'running') throw bad('Pause or cancel the campaign before deleting it.', 409);
  run('DELETE FROM campaigns WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// Send the campaign message to one number to check how it looks.
r.post('/:id/test', async (req, res) => {
  const c = campaignView(req.params.id);
  if (!c) throw bad('Campaign not found.', 404);
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw bad('Enter a phone number for the test.');
  const contact = get('SELECT * FROM contacts WHERE phone = ?', phone) || { name: 'Test', phone };
  if (c.channel === 'meta') {
    const t = c.meta_template || {};
    await metaSendTemplate(phone, t.name, t.language || 'en', (t.params || []).map((p) => personalise(p, contact)));
    return res.json({ ok: true });
  }
  if (!c.session_id || c.session_id === META_SESSION) throw bad('Choose the WhatsApp number to send from.');
  await sendMessage({ sessionId: c.session_id, phone, text: personalise(c.body, contact), author: 'campaign' });
  res.json({ ok: true });
});

export default r;
