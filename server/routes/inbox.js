import { Router } from 'express';
import { all, get, run, logActivity } from '../db.js';
import { engine } from '../services/openwa.js';
import { broadcast } from '../services/events.js';
import { emitOutbound } from '../services/outbound.js';
import { generateReply } from '../services/ai.js';
import { META_SESSION } from '../services/meta.js';
import {
  listConversations,
  conversationView,
  recordMessage,
  sendMessage,
  upsertConversation,
  upsertContact,
} from '../services/messaging.js';
import { normalizePhone, toChatId } from '../services/text.js';

const r = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const toIso = (t) => {
  if (!t) return undefined;
  const n = Number(t);
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
};

r.get('/', (req, res) => {
  const { status = 'open', assigned, sessionId, q, before } = req.query;
  const rows = listConversations({ status, assigned, sessionId, q, before, userId: req.user.id });
  const counts = get(
    `SELECT SUM(status = 'open') AS open, SUM(status = 'pending') AS pending, SUM(status = 'closed') AS closed,
            SUM(assigned_to IS NULL AND status != 'closed') AS unassigned,
            SUM(assigned_to = ? AND status != 'closed') AS mine, SUM(unread > 0) AS unread
       FROM conversations`,
    req.user.id,
  );
  res.json({ conversations: rows, counts });
});

// Start a brand-new chat from the inbox.
r.post('/start', async (req, res) => {
  const { sessionId, phone, text, name } = req.body || {};
  const p = normalizePhone(phone);
  if (!p) throw bad('Enter a valid phone number.');
  if (!text?.trim()) throw bad('Write a first message.');
  if (name) upsertContact(p, name, 'manual');
  const out = await sendMessage({ sessionId, phone: p, text: text.trim(), name, author: 'agent' });
  res.json(out);
});

r.get('/:id', (req, res) => {
  const conv = conversationView(req.params.id);
  if (!conv) throw bad('Conversation not found.', 404);
  const notes = all(
    `SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.conversation_id = ? ORDER BY n.id DESC`,
    conv.id,
  );
  const contact = conv.phone ? get('SELECT * FROM contacts WHERE phone = ?', conv.phone) : null;
  res.json({ conversation: conv, notes, contact });
});

async function backfill(conv) {
  if (conv.backfilled || conv.session_id === META_SESSION) return;
  run('UPDATE conversations SET backfilled = 1 WHERE id = ?', conv.id);
  let items = [];
  try {
    const out = await engine.storedMessages(conv.session_id, conv.chat_id, 50);
    items = (out?.messages || []).map((m) => ({
      waId: m.waMessageId || m.id,
      direction: m.direction === 'outgoing' ? 'out' : 'in',
      type: m.type || 'text',
      body: m.body,
      status: m.direction === 'outgoing' ? m.status || 'sent' : 'received',
      createdAt: toIso(m.timestamp) || m.createdAt,
    }));
  } catch {
    /* engine store may be empty */
  }
  if (!items.length) {
    try {
      const hist = await engine.history(conv.session_id, conv.chat_id, 40);
      items = (hist || []).map((m) => ({
        waId: m.id,
        direction: m.fromMe ? 'out' : 'in',
        type: m.type || 'text',
        body: m.body,
        status: m.fromMe ? 'sent' : 'received',
        createdAt: toIso(m.timestamp),
      }));
    } catch {
      /* live history is whatsapp-web.js only */
    }
  }
  items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const m of items) recordMessage(conv, { ...m, historical: true, author: m.direction === 'out' ? 'phone' : null });
}

r.get('/:id/messages', async (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) throw bad('Conversation not found.', 404);
  await backfill(conv);
  const before = req.query.before ? Number(req.query.before) : null;
  const rows = before
    ? all('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY created_at DESC, id DESC LIMIT 60', conv.id, before)
    : all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 60', conv.id);
  res.json({ messages: rows.reverse(), hasMore: rows.length === 60 });
});

r.post('/:id/messages', async (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) throw bad('Conversation not found.', 404);
  const { text, media, quotedMessageId } = req.body || {};
  if (!text?.trim() && !media) throw bad('Message is empty.');
  const out = await sendMessage({
    conv,
    sessionId: conv.session_id,
    chatId: conv.chat_id,
    text: text?.trim(),
    media,
    quotedMessageId,
    author: 'agent',
  });
  if (!conv.assigned_to) {
    run('UPDATE conversations SET assigned_to = ? WHERE id = ?', req.user.id, conv.id);
    broadcast('conversation', conversationView(conv.id));
  }
  res.json(out);
});

r.post('/:id/read', async (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) throw bad('Conversation not found.', 404);
  run('UPDATE conversations SET unread = 0 WHERE id = ?', conv.id);
  if (conv.session_id !== META_SESSION && conv.unread > 0) engine.markRead(conv.session_id, conv.chat_id).catch(() => {});
  res.json({ ok: true });
});

r.patch('/:id', (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) throw bad('Conversation not found.', 404);
  const { status, assignedTo, botPaused, name } = req.body || {};
  if (status && ['open', 'pending', 'closed'].includes(status)) run('UPDATE conversations SET status = ? WHERE id = ?', status, conv.id);
  if (assignedTo !== undefined) {
    run('UPDATE conversations SET assigned_to = ? WHERE id = ?', assignedTo || null, conv.id);
    const who = assignedTo ? get('SELECT name FROM users WHERE id = ?', assignedTo)?.name : 'nobody';
    logActivity('conversation.assigned', `${conv.name || conv.phone} assigned to ${who}`, { userId: req.user.id });
    emitOutbound('conversation.assigned', { conversationId: conv.id, phone: conv.phone, assignedTo: who });
  }
  if (botPaused !== undefined) run('UPDATE conversations SET bot_paused = ? WHERE id = ?', botPaused ? 1 : 0, conv.id);
  if (name !== undefined) run('UPDATE conversations SET name = ? WHERE id = ?', name || null, conv.id);
  const view = conversationView(conv.id);
  broadcast('conversation', view);
  res.json({ conversation: view });
});

r.post('/:id/notes', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) throw bad('Note is empty.');
  run('INSERT INTO notes(conversation_id, user_id, body) VALUES(?, ?, ?)', req.params.id, req.user.id, body);
  res.json({ ok: true });
});

// Draft a reply with Claude without sending it.
r.post('/:id/ai-draft', async (req, res) => {
  const text = await generateReply({ conversationId: Number(req.params.id) });
  res.json({ text: text || '' });
});

r.post('/new', (req, res) => {
  const { sessionId, phone, name } = req.body || {};
  const p = normalizePhone(phone);
  if (!p || !sessionId) throw bad('Choose a number and enter a phone number.');
  const conv = upsertConversation({ sessionId, chatId: toChatId(p), name, channel: sessionId === META_SESSION ? 'meta' : 'openwa' });
  res.json({ conversation: conversationView(conv.id) });
});

export default r;
