import { config } from '../config.js';
import { get, run, nowIso, logActivity, housekeeping } from '../db.js';
import { engine } from './openwa.js';
import { broadcast } from './events.js';
import { emitOutbound } from './outbound.js';
import { engineWebhookSecret } from './inbound.js';

// Keeps WaBridge in sync with the engine: health, number status changes, and makes sure every
// number delivers its events to WaBridge's webhook receiver.

export const ENGINE_EVENTS = [
  'message.received',
  'message.sent',
  'message.ack',
  'message.failed',
  'session.status',
  'session.authenticated',
  'session.disconnected',
];

export const engineState = { online: false, error: null, checkedAt: null, sessions: [] };
const lastStatus = new Map();
const hooked = new Set();

export const hookUrl = () => `${config.publicUrl}/hooks/openwa`;

export async function ensureWebhook(sessionId, force = false) {
  if (hooked.has(sessionId) && !force) return;
  const url = hookUrl();
  const secret = engineWebhookSecret();
  const body = { url, events: ENGINE_EVENTS, secret, retryCount: 3 };
  const hooks = await engine.listWebhooks(sessionId);
  const mine = (hooks || []).find((h) => h.url === url);
  let id;
  if (mine) {
    await engine.updateWebhook(sessionId, mine.id, { ...body, active: true });
    id = mine.id;
  } else {
    const created = await engine.createWebhook(sessionId, body);
    id = created?.id;
  }
  run('UPDATE numbers SET webhook_id = ? WHERE session_id = ?', id || null, sessionId);
  hooked.add(sessionId);
}

export function forgetSession(sessionId) {
  hooked.delete(sessionId);
  lastStatus.delete(sessionId);
}

function trackNumber(s) {
  const row = get('SELECT * FROM numbers WHERE session_id = ?', s.id);
  if (!row) {
    run('INSERT INTO numbers(session_id, label) VALUES(?, ?)', s.id, s.name);
  }
  if (s.status === 'ready' && !(row && row.warmup_started_at)) {
    run('UPDATE numbers SET warmup_started_at = ? WHERE session_id = ?', s.connectedAt || nowIso(), s.id);
  }
}

export async function tick() {
  let sessions;
  try {
    sessions = await engine.listSessions();
    if (!engineState.online) {
      engineState.online = true;
      engineState.error = null;
      broadcast('engine', { online: true });
      logActivity('engine.online', 'WhatsApp engine is reachable');
    }
  } catch (e) {
    if (engineState.online || engineState.error !== e.message) {
      engineState.online = false;
      engineState.error = e.message;
      broadcast('engine', { online: false, error: e.message });
      logActivity('engine.offline', e.message, { level: 'error' });
    }
    engineState.checkedAt = nowIso();
    return;
  }
  engineState.checkedAt = nowIso();
  engineState.sessions = sessions;
  for (const s of sessions) {
    trackNumber(s);
    const prev = lastStatus.get(s.id);
    if (prev !== s.status) {
      lastStatus.set(s.id, s.status);
      if (prev !== undefined) {
        broadcast('session', { sessionId: s.id, status: s.status, phone: s.phone, pushName: s.pushName });
        emitOutbound('session.status', { sessionId: s.id, status: s.status, phone: s.phone });
        if (s.status === 'ready') logActivity('session.ready', `${s.name} (${s.phone || ''}) is connected`, { meta: { sessionId: s.id } });
        if (['disconnected', 'failed', 'action_required'].includes(s.status)) {
          logActivity('session.down', `${s.name} is ${s.status.replace('_', ' ')}${s.lastError ? `: ${s.lastError}` : ''}`, {
            level: 'error',
            meta: { sessionId: s.id },
          });
        }
      }
    }
    ensureWebhook(s.id).catch((e) => {
      if (!hooked.has(`err:${s.id}`)) {
        hooked.add(`err:${s.id}`);
        logActivity('webhook.error', `Could not register the event webhook for ${s.name}: ${e.message}`, { level: 'warn' });
      }
    });
  }
}

export function startMonitor() {
  void tick();
  setInterval(() => void tick(), 10000).unref();
  setInterval(() => housekeeping(), 6 * 60 * 60 * 1000).unref();
}
