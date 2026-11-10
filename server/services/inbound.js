import crypto from 'node:crypto';
import { get, run, logActivity, getSettings, saveSettings } from '../db.js';
import { engine } from './openwa.js';
import { broadcast } from './events.js';
import { emitOutbound } from './outbound.js';
import { saveBase64 } from './media.js';
import { META_SESSION } from './meta.js';
import { handleInbound } from './automation.js';
import { upsertConversation, upsertContact, recordMessage, setMessageStatusByWaId, conversationView } from './messaging.js';
import { phoneFromChatId, isGroupChat, sleep } from './text.js';

// ---------- engine webhook signature ----------
export function engineWebhookSecret() {
  let { webhookSecret } = getSettings('engine');
  if (!webhookSecret) {
    webhookSecret = crypto.randomBytes(24).toString('hex');
    saveSettings('engine', { webhookSecret });
  }
  return webhookSecret;
}

export function verifyEngineSignature(rawBody, header) {
  if (!header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', engineWebhookSecret()).update(rawBody).digest('hex')}`;
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function firstTime(key) {
  if (!key) return true;
  const info = run('INSERT OR IGNORE INTO seen_events(key) VALUES(?)', String(key));
  return info.changes > 0;
}

// ---------- group names (cached per session) ----------
const groupCache = new Map();
async function groupName(sessionId, chatId) {
  const hit = groupCache.get(sessionId);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.map.get(chatId) || null;
  try {
    const groups = await engine.groups(sessionId);
    const map = new Map((groups || []).map((g) => [g.id, g.name]));
    groupCache.set(sessionId, { at: Date.now(), map });
    return map.get(chatId) || null;
  } catch {
    return null;
  }
}

function describe(data) {
  if (data.body) return data.body;
  if (data.location) return `📍 ${data.location.description || data.location.address || `${data.location.latitude}, ${data.location.longitude}`}`;
  if (data.poll?.name) return `📊 ${data.poll.name}`;
  if (data.media?.filename) return data.media.filename;
  return '';
}

const tsIso = (t) => (t ? new Date(Number(t) * 1000).toISOString() : undefined);

async function onMessage(sessionId, data, direction) {
  if (!data?.chatId || data.isStatusBroadcast || ['status', 'broadcast', 'channel'].includes(data.kind)) return;
  const group = isGroupChat(data.chatId);
  const senderName = data.contact?.pushName || data.contact?.name || null;
  const phone = group ? null : phoneFromChatId(data.chatId) || data.senderPhone || null;
  let name = group ? null : direction === 'in' ? senderName : null;
  if (group) {
    const existing = get('SELECT name FROM conversations WHERE session_id = ? AND chat_id = ?', sessionId, data.chatId);
    if (!existing?.name) name = await groupName(sessionId, data.chatId);
  }
  const conv = upsertConversation({ sessionId, chatId: data.chatId, name, phone });
  const mediaPath = data.media?.data ? saveBase64(data.media.data, data.media.mimetype, data.media.filename) : null;
  const message = recordMessage(conv, {
    waId: data.id,
    direction,
    type: data.type || 'text',
    body: describe(data),
    mediaName: data.media?.filename,
    mediaPath,
    mediaMime: data.media?.mimetype,
    author: direction === 'in' ? (group ? senderName || phoneFromChatId(data.author) : null) : 'phone',
    createdAt: tsIso(data.timestamp),
  });
  if (!message) return;
  if (direction === 'in') {
    if (phone) upsertContact(phone, senderName);
    emitOutbound('message.received', {
      sessionId,
      chatId: data.chatId,
      phone,
      name: senderName,
      waId: data.id,
      type: data.type,
      body: message.body,
      isGroup: group,
    });
    void handleInbound(get('SELECT * FROM conversations WHERE id = ?', conv.id), message);
  }
}

const SESSION_EVENTS = new Set(['session.status', 'session.authenticated', 'session.disconnected', 'session.qr']);

export async function handleEngineEvent(payload) {
  const { event, sessionId, data = {}, idempotencyKey } = payload || {};
  if (!event || !sessionId) return;
  if (!firstTime(idempotencyKey)) return;

  switch (event) {
    case 'message.received':
      if (data.fromMe) return onMessage(sessionId, data, 'out');
      return onMessage(sessionId, data, 'in');
    case 'message.sent': {
      // Our own API sends are already in the inbox; give the send call a moment to store its id.
      await sleep(2500);
      if (get('SELECT id FROM messages WHERE wa_id = ?', data.id)) return;
      return onMessage(sessionId, data, 'out');
    }
    case 'message.ack':
    case 'message.failed':
      return setMessageStatusByWaId(data.id || data.messageId, data.status);
    default:
      if (SESSION_EVENTS.has(event)) {
        const status = data.status || event.split('.')[1];
        broadcast('session', { sessionId, event, status, phone: data.phone, pushName: data.pushName });
        if (event === 'session.disconnected') {
          logActivity('session.disconnected', `A WhatsApp number disconnected (${data.reason || 'no reason given'})`, {
            level: 'error',
            meta: { sessionId },
          });
        }
        if (event === 'session.authenticated') {
          logActivity('session.connected', `WhatsApp number ${data.phone || ''} connected`, { meta: { sessionId } });
        }
        if (event !== 'session.qr') emitOutbound('session.status', { sessionId, event, status });
      }
  }
}

// ---------- Meta Cloud API inbound ----------
export async function handleMetaEvent(body) {
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        if (!firstTime(`meta_${m.id}`)) continue;
        const chatId = `${m.from}@c.us`;
        const conv = upsertConversation({ channel: 'meta', sessionId: META_SESSION, chatId, name: names[m.from] });
        const media = m[m.type] || {};
        const text =
          m.text?.body ||
          media.caption ||
          m.button?.text ||
          m.interactive?.button_reply?.title ||
          m.interactive?.list_reply?.title ||
          (m.location ? `📍 ${m.location.name || `${m.location.latitude}, ${m.location.longitude}`}` : '') ||
          '';
        const message = recordMessage(conv, {
          waId: m.id,
          direction: 'in',
          type: m.type === 'interactive' || m.type === 'button' ? 'text' : m.type,
          body: text,
          mediaName: media.filename,
          createdAt: tsIso(m.timestamp),
        });
        if (!message) continue;
        upsertContact(m.from, names[m.from], 'meta');
        emitOutbound('message.received', { sessionId: META_SESSION, chatId, phone: m.from, name: names[m.from], waId: m.id, type: m.type, body: text });
        void handleInbound(get('SELECT * FROM conversations WHERE id = ?', conv.id), message);
      }
      for (const s of v.statuses || []) {
        setMessageStatusByWaId(s.id, s.status === 'failed' ? 'failed' : s.status);
        if (s.status === 'failed' && s.errors?.[0]) {
          run('UPDATE messages SET error = ? WHERE wa_id = ?', s.errors[0].title || s.errors[0].message, s.id);
        }
      }
    }
  }
}

export { conversationView };
