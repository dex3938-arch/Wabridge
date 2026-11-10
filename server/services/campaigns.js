import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, nowIso, tx, parseJson, logActivity, getSettings } from '../db.js';
import { broadcast } from './events.js';
import { emitOutbound } from './outbound.js';
import { sendMessage, upsertConversation, recordMessage } from './messaging.js';
import { engineState } from './monitor.js';
import { META_SESSION, metaSendTemplate } from './meta.js';
import { MEDIA_DIR } from './media.js';
import { personalise, normalizePhone, toChatId, localParts, withinWindow, randomBetween } from './text.js';

// Safe bulk sender: one message at a time, random gaps, daily caps, quiet hours, opt-out checks
// and an automatic pause when sends keep failing (a common early sign of a restricted number).

export function campaignView(id) {
  const c = get('SELECT * FROM campaigns WHERE id = ?', id);
  if (!c) return null;
  return {
    ...c,
    audience: parseJson(c.audience, {}),
    media: parseJson(c.media, null),
    meta_template: parseJson(c.meta_template, null),
    pending: get("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'", id).n,
  };
}

// Resolves the audience into a recipient snapshot. Returns { total, skipped }.
export function buildRecipients(campaign) {
  const audience = parseJson(campaign.audience, {});
  const tags = audience.tags || [];
  const seen = new Map();
  const add = (phone, name, contactId) => {
    const p = normalizePhone(phone);
    if (p && p.length >= 8 && !seen.has(p)) seen.set(p, { phone: p, name, contactId });
  };

  if (audience.all) {
    for (const c of all('SELECT id, phone, name FROM contacts')) add(c.phone, c.name, c.id);
  } else if (tags.length) {
    const rows = all('SELECT id, phone, name, tags FROM contacts');
    for (const c of rows) {
      const t = parseJson(c.tags, []);
      const ok = audience.match === 'all' ? tags.every((x) => t.includes(x)) : tags.some((x) => t.includes(x));
      if (ok) add(c.phone, c.name, c.id);
    }
  }
  for (const id of audience.contactIds || []) {
    const c = get('SELECT id, phone, name FROM contacts WHERE id = ?', id);
    if (c) add(c.phone, c.name, c.id);
  }
  for (const line of audience.phones || []) {
    const [num, ...rest] = String(line).split(/[,;\t]/);
    add(num, rest.join(' ').trim() || null, null);
  }

  let skipped = 0;
  tx(() => {
    run("DELETE FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'", campaign.id);
    for (const r of seen.values()) {
      const contact = get('SELECT * FROM contacts WHERE phone = ?', r.phone);
      let status = 'pending';
      let error = null;
      if (contact?.opted_out) {
        status = 'skipped';
        error = 'Opted out';
      } else if (campaign.require_opt_in && !contact?.opted_in) {
        status = 'skipped';
        error = 'No opt-in recorded';
      }
      if (status === 'skipped') skipped++;
      run(
        'INSERT OR IGNORE INTO campaign_recipients(campaign_id, contact_id, phone, name, status, error) VALUES(?, ?, ?, ?, ?, ?)',
        campaign.id,
        contact?.id || r.contactId,
        r.phone,
        contact?.name || r.name,
        status,
        error,
      );
    }
    const total = get('SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ?', campaign.id).n;
    const sk = get("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'skipped'", campaign.id).n;
    run('UPDATE campaigns SET total = ?, skipped = ? WHERE id = ?', total, sk, campaign.id);
  });
  return { total: seen.size, skipped };
}

const busy = new Set();

function setCampaign(id, fields) {
  const keys = Object.keys(fields);
  run(`UPDATE campaigns SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), id);
  broadcast('campaign', campaignView(id));
}

function sessionReady(sessionId) {
  if (sessionId === META_SESSION) return true;
  const s = (engineState.sessions || []).find((x) => x.id === sessionId);
  return s?.status === 'ready';
}

function loadMedia(media) {
  if (!media) return null;
  if (media.url) return { kind: media.kind, url: media.url, mimetype: media.mimetype, filename: media.filename };
  if (media.path) {
    const file = path.join(MEDIA_DIR, path.basename(media.path));
    if (!fs.existsSync(file)) return null;
    return {
      kind: media.kind,
      base64: fs.readFileSync(file).toString('base64'),
      mimetype: media.mimetype,
      filename: media.filename,
    };
  }
  return null;
}

async function sendOne(c) {
  const r = get(
    "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 1",
    c.id,
  );
  if (!r) {
    setCampaign(c.id, { status: 'completed', finished_at: nowIso(), next_send_at: null });
    logActivity('campaign.completed', `Campaign "${c.name}" finished — ${c.sent} sent, ${c.failed} failed, ${c.skipped} skipped`);
    emitOutbound('campaign.completed', { id: c.id, name: c.name, sent: c.sent, failed: c.failed, skipped: c.skipped });
    return;
  }
  const contact = get('SELECT * FROM contacts WHERE phone = ?', r.phone);
  if (contact?.opted_out) {
    run("UPDATE campaign_recipients SET status = 'skipped', error = 'Opted out' WHERE id = ?", r.id);
    setCampaign(c.id, { skipped: c.skipped + 1 });
    return;
  }
  const vars = { name: r.name || contact?.name, phone: r.phone, fields: parseJson(contact?.fields, {}) };

  try {
    let waId = null;
    if (c.channel === 'meta') {
      const t = parseJson(c.meta_template, {});
      const params = (t.params || []).map((p) => personalise(p, vars));
      const res = await metaSendTemplate(r.phone, t.name, t.language || 'en', params);
      waId = res.messageId;
      const conv = upsertConversation({ channel: 'meta', sessionId: META_SESSION, chatId: toChatId(r.phone), name: vars.name });
      recordMessage(conv, { waId, direction: 'out', type: 'text', body: `[Template: ${t.name}] ${params.join(' · ')}`, author: 'campaign' });
    } else {
      const text = personalise(c.body, vars);
      const media = loadMedia(parseJson(c.media, null));
      const { message } = await sendMessage({
        sessionId: c.session_id,
        phone: r.phone,
        name: vars.name,
        text,
        media: media ? { ...media, caption: text } : undefined,
        author: 'campaign',
      });
      waId = message.wa_id;
    }
    run("UPDATE campaign_recipients SET status = 'sent', wa_id = ?, sent_at = ?, error = NULL WHERE id = ?", waId, nowIso(), r.id);
    const delay = randomBetween(c.min_delay, c.max_delay) * 1000;
    setCampaign(c.id, {
      sent: c.sent + 1,
      consecutive_failures: 0,
      last_error: null,
      next_send_at: new Date(Date.now() + delay).toISOString(),
    });
  } catch (e) {
    const retryAfter = e?.body?.retryAfterSeconds;
    if (e?.status === 429 && retryAfter) {
      setCampaign(c.id, {
        next_send_at: new Date(Date.now() + retryAfter * 1000).toISOString(),
        last_error: `Engine pacing limit — resuming in ${Math.ceil(retryAfter / 60)} min`,
      });
      return;
    }
    run("UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?", e.message, r.id);
    const consecutive = c.consecutive_failures + 1;
    const fields = {
      failed: c.failed + 1,
      consecutive_failures: consecutive,
      last_error: e.message,
      next_send_at: new Date(Date.now() + randomBetween(c.min_delay, c.max_delay) * 1000).toISOString(),
    };
    if (consecutive >= c.stop_after_failures) {
      fields.status = 'paused';
      fields.last_error = `Paused automatically after ${consecutive} failures in a row: ${e.message}`;
      logActivity('campaign.paused', `Campaign "${c.name}" paused: ${e.message}`, { level: 'error' });
    }
    setCampaign(c.id, fields);
  }
}

function sentToday(c) {
  return get(
    `SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'sent'
       AND sent_at >= strftime('%Y-%m-%dT00:00:00Z','now')`,
    c.id,
  ).n;
}

export async function campaignTick() {
  const now = nowIso();
  for (const c of all("SELECT * FROM campaigns WHERE status = 'scheduled' AND schedule_at <= ?", now)) {
    setCampaign(c.id, { status: 'running', started_at: c.started_at || now, next_send_at: now });
    logActivity('campaign.started', `Campaign "${c.name}" started`);
  }
  const tz = getSettings('general').timezone;
  for (const c of all("SELECT * FROM campaigns WHERE status = 'running'")) {
    if (busy.has(c.id)) continue;
    if (c.next_send_at && c.next_send_at > now) continue;
    if (c.quiet_start && c.quiet_end && withinWindow(c.quiet_start, c.quiet_end, localParts(tz).minutes)) {
      setCampaign(c.id, { next_send_at: new Date(Date.now() + 60000).toISOString(), last_error: 'Quiet hours — waiting' });
      continue;
    }
    if (c.daily_cap && sentToday(c) >= c.daily_cap) {
      setCampaign(c.id, {
        next_send_at: new Date(Date.now() + 30 * 60000).toISOString(),
        last_error: `Daily cap of ${c.daily_cap} reached — continues tomorrow`,
      });
      continue;
    }
    if (!sessionReady(c.session_id)) {
      setCampaign(c.id, { status: 'paused', last_error: 'Paused: the sending number is not connected' });
      logActivity('campaign.paused', `Campaign "${c.name}" paused — number not connected`, { level: 'warn' });
      continue;
    }
    busy.add(c.id);
    sendOne(c)
      .catch((e) => logActivity('campaign.error', e.message, { level: 'error' }))
      .finally(() => busy.delete(c.id));
  }
}

export function startCampaignRunner() {
  setInterval(() => void campaignTick(), 3000).unref();
}
