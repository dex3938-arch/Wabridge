import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { DATA_DIR } from '../config.js';
import { all, get, run, nowIso } from '../db.js';
import { broadcast } from './events.js';
import { emitOutbound } from './outbound.js';
import { upsertConversation, upsertContact, recordMessage, setMessageStatusByWaId } from './messaging.js';
import { handleInbound } from './automation.js';
import { saveBase64 } from './media.js';
import { phoneFromChatId, isGroupChat, toChatId } from './text.js';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

// Silent logger for Baileys to avoid terminal clutter
const logger = pino({ level: 'silent' });

// Active in-memory session instances: Map<sessionId, SessionObject>
export const activeSessions = new Map();

// Helper to get data directory for sessions
export function getSessionDir(sessionId) {
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  return path.join(sessionsDir, sessionId);
}

// Session lifecycle: start or resume a Baileys session
export async function startSession(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');

  // If already running or connecting, reuse it
  if (activeSessions.has(sessionId)) {
    const existing = activeSessions.get(sessionId);
    if (existing && (existing.status === 'ready' || existing.status === 'connecting' || existing.status === 'qr_pending')) {
      return { sessionId, status: existing.status, qrCode: existing.qrCode };
    }
  }

  const sessionDir = getSessionDir(sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  const sessionObj = {
    id: sessionId,
    sessionId,
    sock,
    saveCreds,
    sessionDir,
    status: 'connecting',
    qrCode: null,
    phone: null,
    pushName: null,
    connectedAt: null,
  };
  activeSessions.set(sessionId, sessionObj);

  // Credential updates
  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
    } catch (e) {
      console.warn(`[Baileys:${sessionId}] Failed to save credentials:`, e.message);
    }
  });

  // Connection state updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const session = activeSessions.get(sessionId);
    if (!session) return;

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 320,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        session.qrCode = qrDataUrl;
        session.status = 'qr_pending';
        broadcast('session', {
          sessionId,
          event: 'connection.update',
          status: 'qr_pending',
          qrCode: qrDataUrl,
        });
      } catch (e) {
        console.warn(`[Baileys:${sessionId}] QR generation failed:`, e.message);
      }
    }

    if (connection === 'open') {
      session.status = 'ready';
      session.qrCode = null;
      session.connectedAt = nowIso();

      if (sock.user) {
        const rawId = sock.user.id || '';
        session.phone = rawId.split(':')[0].split('@')[0] || null;
        session.pushName = sock.user.name || null;
      }

      run(
        'UPDATE numbers SET warmup_started_at = COALESCE(warmup_started_at, ?) WHERE session_id = ?',
        session.connectedAt,
        sessionId,
      );

      broadcast('session', {
        sessionId,
        event: 'connection.update',
        status: 'ready',
        phone: session.phone,
        pushName: session.pushName,
      });
      emitOutbound('session.status', { sessionId, status: 'ready', phone: session.phone });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.code;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        session.status = 'logged_out';
        session.qrCode = null;
        broadcast('session', { sessionId, event: 'connection.update', status: 'logged_out' });
        emitOutbound('session.status', { sessionId, status: 'logged_out' });
        await cleanupSession(sessionId);
      } else {
        session.status = 'disconnected';
        broadcast('session', { sessionId, event: 'connection.update', status: 'disconnected' });
        // Attempt reconnect after brief delay if session still exists
        setTimeout(() => {
          if (activeSessions.has(sessionId)) {
            startSession(sessionId).catch((err) => {
              console.warn(`[Baileys:${sessionId}] Reconnect failed:`, err.message);
            });
          }
        }, 3000);
      }
    }
  });

  // Incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !Array.isArray(messages)) return;
    for (const msg of messages) {
      try {
        await processInboundMessage(sock, sessionId, msg);
      } catch (err) {
        console.warn(`[Baileys:${sessionId}] Error processing message:`, err);
      }
    }
  });

  // Message status updates
  sock.ev.on('message.update', async (updates) => {
    if (!Array.isArray(updates)) return;
    for (const { key, update } of updates) {
      if (key?.id && update?.status) {
        try {
          setMessageStatusByWaId(key.id, mapBaileysStatus(update.status));
        } catch {}
      }
    }
  });

  return { sessionId, status: sessionObj.status, qrCode: sessionObj.qrCode };
}

function mapBaileysStatus(status) {
  if (typeof status === 'string') return status.toLowerCase();
  switch (status) {
    case 1:
    case 2:
      return 'sent';
    case 3:
      return 'delivered';
    case 4:
    case 5:
      return 'read';
    default:
      return 'sent';
  }
}

// Process inbound messages from WhatsApp Multi-Device
async function processInboundMessage(sock, sessionId, msg) {
  if (!msg?.key) return;
  const remoteJid = msg.key.remoteJid || '';
  if (remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) return;

  const fromMe = Boolean(msg.key.fromMe);
  const chatId = remoteJid;
  const isGroup = isGroupChat(chatId) || chatId.endsWith('@g.us');
  const senderJid = msg.key.participant || (fromMe ? sock?.user?.id : remoteJid) || remoteJid;
  const senderPhone = senderJid ? senderJid.split(':')[0].split('@')[0] : null;

  let pushName = msg.pushName || null;
  if (!pushName && isGroup) {
    pushName = await getGroupName(sock, chatId);
  }

  const { type, body, media } = await extractMessageContent(msg);
  const phone = isGroup ? null : (senderPhone || phoneFromChatId(chatId));

  const conv = upsertConversation({
    channel: 'baileys',
    sessionId,
    chatId,
    name: pushName || (isGroup ? 'WhatsApp Group' : phone),
    phone: phone,
  });

  if (!conv) return;

  if (phone && !isGroup && !fromMe) {
    upsertContact(phone, pushName);
  }

  const timestamp = msg.messageTimestamp
    ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
    : nowIso();

  const message = recordMessage(conv, {
    waId: msg.key.id,
    direction: fromMe ? 'out' : 'in',
    type,
    body,
    mediaName: media?.filename || null,
    mediaPath: media?.path || null,
    mediaMime: media?.mimetype || null,
    author: fromMe ? 'me' : (pushName || senderPhone || null),
    createdAt: timestamp,
  });

  if (!message) return;

  if (!fromMe) {
    emitOutbound('message.received', {
      sessionId,
      chatId,
      phone,
      name: pushName,
      waId: msg.key.id,
      type,
      body,
      isGroup,
    });
    await handleInbound(conv, message);
  } else {
    emitOutbound('message.sent', {
      sessionId,
      chatId,
      phone,
      name: pushName,
      waId: msg.key.id,
      type,
      body,
    });
  }
}

// Extract message text, caption, or media from Baileys message
async function extractMessageContent(msg) {
  const m = msg.message || {};
  let type = 'text';
  let body = '';
  let media = null;

  if (m.conversation) {
    type = 'text';
    body = m.conversation;
  } else if (m.extendedTextMessage?.text) {
    type = 'text';
    body = m.extendedTextMessage.text;
  } else if (m.imageMessage) {
    type = 'image';
    body = m.imageMessage.caption || '';
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer) {
        const ext = (m.imageMessage.mimetype || 'image/jpeg').split('/')[1]?.split(';')[0] || 'jpg';
        const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const savedRelPath = saveBase64(buffer.toString('base64'), m.imageMessage.mimetype || 'image/jpeg', filename);
        media = { filename, path: savedRelPath, mimetype: m.imageMessage.mimetype || 'image/jpeg' };
      }
    } catch (e) {
      console.warn('Failed to download image media:', e.message);
    }
  } else if (m.videoMessage) {
    type = 'video';
    body = m.videoMessage.caption || '';
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer) {
        const ext = (m.videoMessage.mimetype || 'video/mp4').split('/')[1]?.split(';')[0] || 'mp4';
        const filename = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const savedRelPath = saveBase64(buffer.toString('base64'), m.videoMessage.mimetype || 'video/mp4', filename);
        media = { filename, path: savedRelPath, mimetype: m.videoMessage.mimetype || 'video/mp4' };
      }
    } catch (e) {
      console.warn('Failed to download video media:', e.message);
    }
  } else if (m.audioMessage) {
    type = 'audio';
    body = '';
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer) {
        const ext = (m.audioMessage.mimetype || 'audio/ogg').split('/')[1]?.split(';')[0] || 'ogg';
        const filename = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const savedRelPath = saveBase64(buffer.toString('base64'), m.audioMessage.mimetype || 'audio/ogg', filename);
        media = { filename, path: savedRelPath, mimetype: m.audioMessage.mimetype || 'audio/ogg' };
      }
    } catch (e) {
      console.warn('Failed to download audio media:', e.message);
    }
  } else if (m.documentMessage) {
    type = 'document';
    body = m.documentMessage.caption || m.documentMessage.fileName || '';
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer) {
        const filename = m.documentMessage.fileName || `doc_${Date.now()}`;
        const savedRelPath = saveBase64(buffer.toString('base64'), m.documentMessage.mimetype || 'application/octet-stream', filename);
        media = { filename, path: savedRelPath, mimetype: m.documentMessage.mimetype || 'application/octet-stream' };
      }
    } catch (e) {
      console.warn('Failed to download document media:', e.message);
    }
  } else if (m.locationMessage) {
    type = 'location';
    body = m.locationMessage.name || m.locationMessage.address || `Location: ${m.locationMessage.degreesLatitude}, ${m.locationMessage.degreesLongitude}`;
  } else if (m.contactMessage) {
    type = 'contact';
    body = m.contactMessage.displayName || 'Shared contact';
  } else if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const poll = m.pollCreationMessage || m.pollCreationMessageV3;
    type = 'poll';
    body = `Poll: ${poll.name || 'Untitled'}`;
  }

  return { type, body, media };
}

async function getGroupName(sock, chatId) {
  if (!sock || !chatId) return null;
  try {
    const meta = await sock.groupMetadata(chatId);
    return meta?.subject || null;
  } catch {
    return null;
  }
}

// Cleanup and delete session files
export async function cleanupSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session?.sock) {
    try {
      session.sock.ev.removeAllListeners();
      await session.sock.logout().catch(() => {});
    } catch {}
  }
  activeSessions.delete(sessionId);
  const dir = getSessionDir(sessionId);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Could not remove session dir ${dir}:`, e.message);
    }
  }
}

// Stop session
export async function stopSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.status = 'stopped';
    if (session.sock) {
      try {
        session.sock.ev.removeAllListeners();
        session.sock.end(new Error('Session stopped by user'));
      } catch {}
    }
    activeSessions.delete(sessionId);
    broadcast('session', { sessionId, event: 'connection.update', status: 'stopped' });
  }
  return { sessionId, status: 'stopped' };
}

// Logout session
export async function logoutSession(sessionId) {
  await cleanupSession(sessionId);
  broadcast('session', { sessionId, event: 'connection.update', status: 'logged_out' });
  return { sessionId, status: 'logged_out' };
}

// Delete session
export async function deleteSession(sessionId) {
  await stopSession(sessionId);
  await cleanupSession(sessionId);
  return { sessionId, status: 'deleted' };
}

// Get QR code data
export async function getQr(sessionId) {
  let session = activeSessions.get(sessionId);
  if (!session) {
    const row = get('SELECT * FROM numbers WHERE session_id = ?', sessionId);
    if (row) {
      await startSession(sessionId);
      session = activeSessions.get(sessionId);
    }
  }
  if (!session) return { qrCode: null, status: 'unknown' };

  return {
    qrCode: session.qrCode,
    status: session.status || 'unknown',
  };
}

// Request pairing code using phone number
export async function pairingCode(sessionId, phoneNumber) {
  const session = activeSessions.get(sessionId);
  if (!session?.sock) throw new Error('Session not found or not connected');

  const clean = String(phoneNumber).replace(/[^0-9]/g, '');
  try {
    const code = await session.sock.requestPairingCode(clean);
    return { code };
  } catch (error) {
    console.error(`Error requesting pairing code for session ${sessionId}:`, error);
    throw error;
  }
}

// Send outbound message via Baileys
export async function sendMessageBaileys(sessionId, chatId, options = {}) {
  const session = activeSessions.get(sessionId);
  if (!session?.sock) throw new Error(`Session ${sessionId} is not connected`);

  const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
  let messagePayload = {};

  if (options.text) {
    messagePayload.text = options.text;
  }

  if (options.media) {
    const { kind, data, mimetype, filename } = options.media;
    let contentBuffer = null;
    if (Buffer.isBuffer(data)) {
      contentBuffer = data;
    } else if (typeof data === 'string') {
      if (data.startsWith('data:') || /^[A-Za-z0-9+/=]+$/.test(data.slice(0, 100))) {
        const base64Data = data.includes('base64,') ? data.split('base64,')[1] : data;
        contentBuffer = Buffer.from(base64Data, 'base64');
      } else if (/^https?:\/\//i.test(data)) {
        contentBuffer = { url: data };
      } else if (fs.existsSync(data)) {
        contentBuffer = fs.readFileSync(data);
      }
    }

    if (kind === 'image') {
      messagePayload.image = contentBuffer;
      if (options.text) messagePayload.caption = options.text;
    } else if (kind === 'video') {
      messagePayload.video = contentBuffer;
      if (options.text) messagePayload.caption = options.text;
    } else if (kind === 'audio' || kind === 'voice') {
      messagePayload.audio = contentBuffer;
      messagePayload.mimetype = mimetype || 'audio/mp4';
      if (kind === 'voice') messagePayload.ptt = true;
    } else if (kind === 'document') {
      messagePayload.document = contentBuffer;
      messagePayload.mimetype = mimetype || 'application/octet-stream';
      messagePayload.fileName = filename || 'document';
      if (options.text) messagePayload.caption = options.text;
    }
  }

  if (options.location) {
    messagePayload.location = {
      degreesLatitude: options.location.latitude,
      degreesLongitude: options.location.longitude,
      name: options.location.name,
      address: options.location.address,
    };
  }

  if (options.poll) {
    messagePayload.poll = {
      name: options.poll.name || options.text,
      values: options.poll.options || options.poll.values || [],
      selectableCount: options.poll.selectableCount || 1,
    };
  }

  const sentMessage = await session.sock.sendMessage(jid, messagePayload);

  return {
    id: sentMessage.key.id,
    messageId: sentMessage.key.id,
    waId: sentMessage.key.id,
    status: 'sent',
  };
}

// Presence/typing indicator
export async function typing(sessionId, chatId, state = 'typing') {
  const session = activeSessions.get(sessionId);
  if (!session?.sock) return { ok: false };
  const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
  try {
    await session.sock.sendPresenceUpdate(state, jid);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// Mark messages as read
export async function markRead(sessionId, chatId) {
  const session = activeSessions.get(sessionId);
  if (!session?.sock) return { ok: false };
  const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
  try {
    await session.sock.readMessages([{ remoteJid: jid, id: '', fromMe: false }]);
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// Check if a phone number is registered on WhatsApp
export async function checkNumber(sessionId, phone) {
  const session = activeSessions.get(sessionId);
  if (!session?.sock) throw new Error('Session not connected');

  const clean = String(phone).replace(/[^0-9]/g, '');
  const jid = `${clean}@s.whatsapp.net`;
  try {
    const results = await session.sock.onWhatsApp(jid);
    const first = Array.isArray(results) ? results[0] : results;
    return {
      exists: Boolean(first?.exists),
      whatsappId: first?.jid ? first.jid.split('@')[0] : null,
      jid: first?.jid || null,
    };
  } catch (error) {
    console.error(`Error checking number for session ${sessionId}:`, error);
    throw error;
  }
}

// Retrieve conversations for this session from SQLite
export async function chats(sessionId, limit = 50) {
  const rows = all(
    `SELECT chat_id AS id, name, last_message AS lastMessage, unread AS unreadCount,
            last_at AS lastAt
     FROM conversations
     WHERE session_id = ?
     ORDER BY last_at DESC LIMIT ?`,
    sessionId,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lastMessage: r.lastMessage,
    unreadCount: r.unreadCount || 0,
    timestamp: r.lastAt ? Math.floor(new Date(r.lastAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
  }));
}

// Retrieve participating groups from socket
export async function groups(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session?.sock) return [];

  try {
    const chats = await session.sock.groupFetchAllParticipating();
    return Object.values(chats).map((group) => ({
      id: group.id,
      name: group.subject,
      participants: (group.participants || []).map((p) => p.id),
      createdAt: group.creation,
      owner: group.owner,
    }));
  } catch (error) {
    console.warn(`Error getting groups for session ${sessionId}:`, error.message);
    return [];
  }
}

// Proxy configuration stub
export async function setProxy(sessionId, proxyUrl) {
  return { sessionId, proxyUrl: proxyUrl || null };
}

// Auto-restore stored sessions on server boot
export async function initializeSessions() {
  try {
    const sessions = all('SELECT session_id, label FROM numbers');
    for (const { session_id, label } of sessions) {
      if (!session_id || session_id === 'meta-cloud') continue;
      const sDir = getSessionDir(session_id);
      if (fs.existsSync(sDir) && fs.readdirSync(sDir).length > 0) {
        try {
          console.log(`[Baileys] Restoring session "${label || session_id}" (${session_id})...`);
          await startSession(session_id);
        } catch (error) {
          console.warn(`[Baileys] Failed to restore session ${session_id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.warn('[Baileys] Error in initializeSessions:', error.message);
  }
}