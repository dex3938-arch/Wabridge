import crypto from 'node:crypto';
import { all, run, nowIso, parseJson } from '../db.js';

// Forwards WaBridge events to the user's own systems (CRM, n8n, Zapier, custom backend).
// Every delivery is signed: X-WaBridge-Signature: sha256=<hex HMAC of the raw body>.

export const OUTBOUND_EVENTS = [
  'message.received',
  'message.sent',
  'message.status',
  'conversation.assigned',
  'contact.opted_out',
  'contact.opted_in',
  'session.status',
  'campaign.completed',
  'lead.created',
];

async function deliver(hook, event, data, attempt = 1) {
  const body = JSON.stringify({ event, timestamp: nowIso(), data });
  const signature = `sha256=${crypto.createHmac('sha256', hook.secret).update(body).digest('hex')}`;
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WaBridge-Webhook/1.0',
        'X-WaBridge-Event': event,
        'X-WaBridge-Signature': signature,
        'X-WaBridge-Attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    run(
      'UPDATE outbound_webhooks SET last_status = ?, last_error = ?, last_at = ?, deliveries = deliveries + 1, failures = failures + ? WHERE id = ?',
      res.status,
      res.ok ? null : `HTTP ${res.status}`,
      nowIso(),
      res.ok ? 0 : 1,
      hook.id,
    );
    if (!res.ok && res.status >= 500 && attempt < 3) {
      setTimeout(() => deliver(hook, event, data, attempt + 1), attempt * 5000).unref();
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    run(
      'UPDATE outbound_webhooks SET last_status = ?, last_error = ?, last_at = ?, failures = failures + 1 WHERE id = ?',
      0,
      String(e?.message || e),
      nowIso(),
      hook.id,
    );
    if (attempt < 3) setTimeout(() => deliver(hook, event, data, attempt + 1), attempt * 5000).unref();
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}

export function emitOutbound(event, data) {
  const hooks = all('SELECT * FROM outbound_webhooks WHERE active = 1');
  for (const hook of hooks) {
    const events = parseJson(hook.events, ['*']);
    if (events.includes('*') || events.includes(event)) void deliver(hook, event, data);
  }
}

export const testOutbound = (hook) =>
  deliver(hook, 'webhook.test', { message: 'Hello from WaBridge 👋', hookId: hook.id });
