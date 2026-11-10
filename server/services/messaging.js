import { get, run, all, nowIso, logActivity } from '../db.js';
import { engine, EngineError } from './openwa.js';
import { broadcast } from './events.js';
import { emitOutbound } from './outbound.js';
import { META_SESSION, metaSendText, metaSendMedia } from './meta.js';
import { phoneFromChatId, isGroupChat, toChatId, preview } from './text.js';
import { saveBase64 } from './media.js';

// ---------- conversations & contacts ----------
export function upsertContact(phone, name, source = 'whatsapp') {
  if (!phone) return null;
  const existing = get('SELECT * FROM contacts WHERE phone = ?', phone);
  if (existing) {
    if (name && !existing.name) run('UPDATE contacts SET name = ? WHERE id = ?', name, existing.id);
    return get('SELECT * FROM contacts WHERE id = ?', existing.id);
  }
  run('INSERT INTO contacts(phone, name, source, on_whatsapp) VALUES(?, ?, ?, 1)', phone, name || null, source);
  return get('SELECT * FROM contacts WHERE phone = ?', phone);
}

export function upsertConversation({ channel = 'openwa', sessionId, chatId, name, phone: phoneHint }) {
  const phone = phoneHint || phoneFromChatId(chatId);
  const group = isGroupChat(chatId) ? 1 : 0;
  run(
    `INSERT INTO conversations(channel, session_id, chat_id, phone, name, is_group)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, chat_id) DO UPDATE SET
       name = COALESCE(excluded.name, conversations.name),
       phone = COALESCE(conversations.phone, excluded.phone)`,
    channel,
    sessionId,
    chatId,
    phone,
    name || null,
    group,
  );
  return get('SELECT * FROM conversations WHERE session_id = ? AND chat_id = ?', sessionId, chatId);
}

export function conversationView(id) {
  return get(
    `SELECT c.*, u.name AS assignee_name, ct.id AS contact_id, ct.tags AS contact_tags, ct.opted_out
       FROM conversations c
       LEFT JOIN users u ON u.id = c.assigned_to
       LEFT JOIN contacts ct ON ct.phone = c.phone
      WHERE c.id = ?`,
    id,
  );
}

const MEDIA_LABEL = {
  image: '📷 Photo',
  video: '🎬 Video',
  audio: '🎵 Audio',
  voice: '🎤 Voice message',
  ptt: '🎤 Voice message',
  document: '📄 Document',
  sticker: '🌟 Sticker',
  location: '📍 Location',
  contact: '👤 Contact',
  poll: '📊 Poll',
};

export function recordMessage(conv, m) {
  const createdAt = m.createdAt || nowIso();
  if (m.waId) {
    const dup = get('SELECT id FROM messages WHERE conversation_id = ? AND wa_id = ?', conv.id, m.waId);
    if (dup) return null;
  }
  const info = run(
    `INSERT INTO messages(conversation_id, wa_id, direction, type, body, media_name, media_path, media_mime, status, error, author, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    conv.id,
    m.waId || null,
    m.direction,
    m.type || 'text',
    m.body ?? null,
    m.mediaName || null,
    m.mediaPath || null,
    m.mediaMime || null,
    m.status || (m.direction === 'in' ? 'received' : 'sent'),
    m.error || null,
    m.author || null,
    createdAt,
  );
  const lastText = m.body ? preview(m.body, 140) : MEDIA_LABEL[m.type] || m.type;
  if (!m.historical || !conv.last_at || createdAt > conv.last_at) {
    run(
      `UPDATE conversations SET last_message = ?, last_direction = ?, last_at = ?,
         unread = CASE WHEN ? = 'in' AND ? = 0 THEN unread + 1 ELSE unread END,
         last_inbound_at = CASE WHEN ? = 'in' THEN ? ELSE last_inbound_at END,
         status = CASE WHEN ? = 'in' AND status = 'closed' AND ? = 0 THEN 'open' ELSE status END
       WHERE id = ?`,
      lastText,
      m.direction,
      createdAt,
      m.direction,
      m.historical ? 1 : 0,
      m.direction,
      createdAt,
      m.direction,
      m.historical ? 1 : 0,
      conv.id,
    );
  }
  if (conv.phone) run('UPDATE contacts SET last_message_at = ? WHERE phone = ?', createdAt, conv.phone);
  const message = get('SELECT * FROM messages WHERE id = ?', Number(info.lastInsertRowid));
  if (!m.historical) {
    broadcast('message', { message, conversation: conversationView(conv.id) });
  }
  return message;
}

export function setMessageStatusByWaId(waId, status) {
  if (!waId || !status) return;
  const order = { pending: 0, sent: 1, delivered: 2, read: 3, played: 3 };
  const row = get('SELECT * FROM messages WHERE wa_id = ? ORDER BY id DESC LIMIT 1', waId);
  if (!row) return;
  if (status !== 'failed' && (order[status] ?? 0) <= (order[row.status] ?? 0)) return;
  run('UPDATE messages SET status = ? WHERE id = ?', status, row.id);
  broadcast('message.status', { id: row.id, conversationId: row.conversation_id, status });
  emitOutbound('message.status', { waId, status, conversationId: row.conversation_id });
}

// ---------- sending ----------
function sentTodayFor(sessionId) {
  return get(
    `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.session_id = ? AND m.direction = 'out' AND m.status != 'failed'
        AND m.created_at >= strftime('%Y-%m-%dT00:00:00Z','now')`,
    sessionId,
  ).n;
}

/**
 * Send one message through the right channel and keep the inbox in sync.
 * media: { kind: image|video|audio|document, url?, base64?, mimetype?, filename? }
 */
export async function sendMessage({ sessionId, chatId, phone, text, media, author = 'agent', quotedMessageId, name }) {
  if (!sessionId) throw Object.assign(new Error('Choose a WhatsApp number to send from.'), { status: 400 });
  const target = chatId || toChatId(phone);
  const channel = sessionId === META_SESSION ? 'meta' : 'openwa';
  const conv = upsertConversation({ channel, sessionId, chatId: target, name });

  if (channel === 'openwa') {
    const number = get('SELECT daily_limit FROM numbers WHERE session_id = ?', sessionId);
    if (number?.daily_limit && sentTodayFor(sessionId) >= number.daily_limit) {
      throw Object.assign(new Error(`Daily limit of ${number.daily_limit} messages reached for this number.`), {
        status: 429,
      });
    }
  }

  const pending = recordMessage(conv, {
    direction: 'out',
    type: media ? media.kind : 'text',
    body: media ? media.caption || text || '' : text,
    mediaName: media?.filename,
    mediaPath: media?.base64 ? saveBase64(media.base64, media.mimetype, media.filename) : media?.url || null,
    mediaMime: media?.mimetype || null,
    status: 'pending',
    author,
  });

  try {
    let result;
    if (channel === 'meta') {
      const to = phoneFromChatId(target);
      if (media) {
        if (!media.url) throw Object.assign(new Error('The official API needs a public media URL.'), { status: 400 });
        result = await metaSendMedia(to, media.kind, media.url, media.caption || text, media.filename);
      } else {
        result = await metaSendText(to, text);
      }
    } else if (media) {
      const body = { chatId: target };
      if (media.url) body.url = media.url;
      if (media.base64) body.base64 = media.base64;
      if (media.mimetype) body.mimetype = media.mimetype;
      if (media.filename) body.filename = media.filename;
      if (media.caption || text) body.caption = media.caption || text;
      if (media.kind === 'audio' && media.ptt) body.ptt = true;
      result = await engine.sendMedia(sessionId, media.kind, body);
    } else {
      const body = { chatId: target, text };
      if (quotedMessageId) body.quotedMessageId = quotedMessageId;
      result = await engine.sendText(sessionId, body);
    }
    const waId = result?.messageId || null;
    run("UPDATE messages SET wa_id = ?, status = 'sent' WHERE id = ?", waId, pending.id);
    if (author === 'agent') {
      run('UPDATE conversations SET last_human_reply_at = ?, unread = 0 WHERE id = ?', nowIso(), conv.id);
    }
    const message = get('SELECT * FROM messages WHERE id = ?', pending.id);
    broadcast('message.status', { id: message.id, conversationId: conv.id, status: 'sent', waId });
    emitOutbound('message.sent', {
      sessionId,
      chatId: target,
      waId,
      type: message.type,
      body: message.body,
      author,
    });
    return { message, conversation: conversationView(conv.id) };
  } catch (e) {
    const reason = e instanceof EngineError || e?.status ? e.message : 'Send failed';
    run("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", reason, pending.id);
    broadcast('message.status', { id: pending.id, conversationId: conv.id, status: 'failed', error: reason });
    logActivity('message.failed', `Send to ${phoneFromChatId(target) || target} failed: ${reason}`, {
      level: 'warn',
      meta: { sessionId },
    });
    throw e;
  }
}

export function listConversations({ status, assigned, sessionId, q, userId, limit = 60, before }) {
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    where.push('c.status = ?');
    params.push(status);
  }
  if (assigned === 'me') {
    where.push('c.assigned_to = ?');
    params.push(userId);
  } else if (assigned === 'unassigned') {
    where.push('c.assigned_to IS NULL');
  }
  if (sessionId) {
    where.push('c.session_id = ?');
    params.push(sessionId);
  }
  if (q) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.last_message LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (before) {
    where.push('c.last_at < ?');
    params.push(before);
  }
  const sql = `SELECT c.*, u.name AS assignee_name, ct.opted_out
                 FROM conversations c
                 LEFT JOIN users u ON u.id = c.assigned_to
                 LEFT JOIN contacts ct ON ct.phone = c.phone
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY COALESCE(c.last_at, c.created_at) DESC
                LIMIT ?`;
  return all(sql, ...params, limit);
}
