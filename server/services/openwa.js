import { config } from '../config.js';

// Thin client for the OpenWA engine REST API, with built-in transparent fallback to the embedded Baileys engine.
// When USE_EXTERNAL_OPENWA is not set, Baileys is used in-process so no Docker or external service is required.

export class EngineError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function errorMessage(body, status) {
  if (!body) return `Engine returned HTTP ${status}`;
  const m = body.message;
  if (Array.isArray(m)) return m.join('; ');
  return m || body.error || `Engine returned HTTP ${status}`;
}

export async function request(method, path, { body, query, timeoutMs = 30000, raw = false } = {}) {
  const url = new URL(config.openwaUrl + (path.startsWith('/') ? path : `/${path}`));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: 'application/json' };
  if (config.openwaKey) headers['X-API-Key'] = config.openwaKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = e?.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
    throw new EngineError(`WhatsApp engine ${reason} at ${config.openwaUrl}`, 503, null);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (raw) return { status: res.status, headers: Object.fromEntries(res.headers), data };
  if (!res.ok) throw new EngineError(errorMessage(data, res.status), res.status, data);
  return data;
}

const enc = encodeURIComponent;

// Lazy dynamic import of Baileys to prevent top-level await circular dependencies
let baileysModulePromise = null;
async function getBaileys() {
  if (process.env.USE_EXTERNAL_OPENWA === 'true' || process.env.USE_EXTERNAL_OPENWA === '1') {
    return null;
  }
  if (!baileysModulePromise) {
    baileysModulePromise = import('./baileys.js').catch((err) => {
      console.warn('Embedded Baileys engine could not be loaded:', err.message);
      return null;
    });
  }
  return baileysModulePromise;
}

export const engine = {
  health: async () => {
    const b = await getBaileys();
    if (b) return { status: 'ok', engine: 'baileys', version: 'embedded' };
    return request('GET', '/api/health', { timeoutMs: 5000 });
  },

  currentEngine: async () => {
    const b = await getBaileys();
    if (b) return { engine: 'baileys', status: 'embedded', name: 'Baileys' };
    return request('GET', '/api/infra/engines/current');
  },

  listSessions: async () => {
    const b = await getBaileys();
    if (b) {
      const active = Array.from(b.activeSessions.values());
      const { all } = await import('../db.js');
      const dbNumbers = all('SELECT session_id, label FROM numbers WHERE session_id != ?', 'meta-cloud');
      const seen = new Set();
      const list = [];

      for (const s of active) {
        const sid = s.id || s.sessionId;
        seen.add(sid);
        list.push({
          id: sid,
          name: s.name || s.label || s.phone || sid,
          status: s.status || 'unknown',
          phone: s.phone || null,
          pushName: s.pushName || null,
          connectedAt: s.connectedAt || null,
          lastActive: s.connectedAt || null,
          restriction: null,
          channel: 'baileys',
        });
      }

      for (const row of dbNumbers) {
        if (!seen.has(row.session_id)) {
          list.push({
            id: row.session_id,
            name: row.label || row.session_id,
            status: 'stopped',
            phone: null,
            pushName: null,
            connectedAt: null,
            lastActive: null,
            restriction: null,
            channel: 'baileys',
          });
        }
      }

      return list;
    }
    return request('GET', '/api/sessions');
  },

  getSession: async (id) => {
    const b = await getBaileys();
    if (b) {
      if (b.activeSessions.has(id)) {
        const s = b.activeSessions.get(id);
        return {
          id,
          name: s.name || s.label || s.phone || id,
          status: s.status || 'unknown',
          phone: s.phone || null,
          pushName: s.pushName || null,
          connectedAt: s.connectedAt || null,
          lastActive: s.connectedAt || null,
          restriction: null,
          channel: 'baileys',
        };
      }
      const { get } = await import('../db.js');
      const row = get('SELECT * FROM numbers WHERE session_id = ?', id);
      if (row) {
        return {
          id,
          name: row.label || id,
          status: 'stopped',
          phone: null,
          pushName: null,
          connectedAt: null,
          lastActive: null,
          restriction: null,
          channel: 'baileys',
        };
      }
      return null;
    }
    return request('GET', `/api/sessions/${enc(id)}`);
  },

  createSession: async (name, proxyUrl) => {
    const b = await getBaileys();
    if (b) {
      const sessionId = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
      const { run } = await import('../db.js');
      run('INSERT OR REPLACE INTO numbers(session_id, label) VALUES(?, ?)', sessionId, name);
      await b.startSession(sessionId);
      return { id: sessionId, name, status: 'connecting', channel: 'baileys' };
    }
    return request('POST', '/api/sessions', { body: proxyUrl ? { name, proxyUrl } : { name } });
  },

  startSession: async (id) => {
    const b = await getBaileys();
    if (b) {
      return await b.startSession(id);
    }
    return request('POST', `/api/sessions/${enc(id)}/start`);
  },

  stopSession: async (id) => {
    const b = await getBaileys();
    if (b) {
      return await b.stopSession(id);
    }
    return request('POST', `/api/sessions/${enc(id)}/stop`);
  },

  logoutSession: async (id) => {
    const b = await getBaileys();
    if (b) {
      return await b.logoutSession(id);
    }
    return request('POST', `/api/sessions/${enc(id)}/logout`);
  },

  deleteSession: async (id) => {
    const b = await getBaileys();
    if (b) {
      await b.deleteSession(id);
      const { run } = await import('../db.js');
      run('DELETE FROM numbers WHERE session_id = ?', id);
      return { id, status: 'deleted', channel: 'baileys' };
    }
    return request('DELETE', `/api/sessions/${enc(id)}`);
  },

  getQr: async (id) => {
    const b = await getBaileys();
    if (b) {
      return await b.getQr(id);
    }
    return request('GET', `/api/sessions/${enc(id)}/qr`, { timeoutMs: 10000 });
  },

  pairingCode: async (id, phoneNumber) => {
    const b = await getBaileys();
    if (b) {
      return await b.pairingCode(id, phoneNumber);
    }
    return request('POST', `/api/sessions/${enc(id)}/pairing-code`, { body: { phoneNumber } });
  },

  setProxy: async (id, proxyUrl) => {
    const b = await getBaileys();
    if (b) {
      return await b.setProxy(id, proxyUrl);
    }
    return request('PATCH', `/api/sessions/${enc(id)}/proxy`, { body: { proxyUrl } });
  },

  chats: async (id, limit = 50) => {
    const b = await getBaileys();
    if (b) {
      return await b.chats(id, limit);
    }
    return request('GET', `/api/sessions/${enc(id)}/chats`, { query: { limit } });
  },

  groups: async (id) => {
    const b = await getBaileys();
    if (b) {
      return await b.groups(id);
    }
    return request('GET', `/api/sessions/${enc(id)}/groups`);
  },

  storedMessages: async (id, chatId, limit = 50) => {
    const b = await getBaileys();
    if (b) {
      const { all } = await import('../db.js');
      return all(
        `SELECT m.* FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.session_id = ? AND c.chat_id = ?
         ORDER BY m.created_at DESC LIMIT ?`,
        id, chatId, limit
      );
    }
    return request('GET', `/api/sessions/${enc(id)}/messages`, {
      query: { chatId, limit, orderBy: 'timestamp', direction: 'desc' },
    });
  },

  history: async (id, chatId, limit = 50) => {
    const b = await getBaileys();
    if (b) {
      const { all } = await import('../db.js');
      return all(
        `SELECT m.* FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.session_id = ? AND c.chat_id = ?
         ORDER BY m.created_at DESC LIMIT ?`,
        id, chatId, limit
      );
    }
    return request('GET', `/api/sessions/${enc(id)}/messages/${enc(chatId)}/history`, { query: { limit } });
  },

  checkNumber: async (id, number) => {
    const b = await getBaileys();
    if (b) {
      return await b.checkNumber(id, number);
    }
    return request('GET', `/api/sessions/${enc(id)}/contacts/check/${enc(number)}`);
  },

  markRead: async (id, chatId) => {
    const b = await getBaileys();
    if (b) {
      await b.markRead(id, chatId);
      return { ok: true };
    }
    return request('POST', `/api/sessions/${enc(id)}/chats/read`, { body: { chatId } });
  },

  typing: async (id, chatId, state = 'typing') => {
    const b = await getBaileys();
    if (b) {
      await b.typing(id, chatId, state);
      return { ok: true };
    }
    return request('POST', `/api/sessions/${enc(id)}/chats/typing`, { body: { chatId, state } });
  },

  sendText: async (id, body) => {
    const b = await getBaileys();
    if (b) {
      return await b.sendMessageBaileys(id, body.chatId, { text: body.text });
    }
    return request('POST', `/api/sessions/${enc(id)}/messages/send-text`, { body });
  },

  sendMedia: async (id, kind, body) => {
    const b = await getBaileys();
    if (b) {
      return await b.sendMessageBaileys(id, body.chatId, {
        text: body.caption || body.text,
        media: {
          kind,
          data: body.base64 || body.url || body.data,
          mimetype: body.mimetype,
          filename: body.filename,
        },
      });
    }
    return request('POST', `/api/sessions/${enc(id)}/messages/send-${kind}`, { body, timeoutMs: 120000 });
  },

  sendLocation: async (id, body) => {
    const b = await getBaileys();
    if (b) {
      return await b.sendMessageBaileys(id, body.chatId, {
        text: body.text,
        location: body.location,
      });
    }
    return request('POST', `/api/sessions/${enc(id)}/messages/send-location`, { body });
  },

  sendPoll: async (id, body) => {
    const b = await getBaileys();
    if (b) {
      return await b.sendMessageBaileys(id, body.chatId, {
        text: body.text,
        poll: body.poll,
      });
    }
    return request('POST', `/api/sessions/${enc(id)}/messages/send-poll`, { body });
  },

  listWebhooks: async (id) => {
    const b = await getBaileys();
    if (b) return [];
    return request('GET', `/api/sessions/${enc(id)}/webhooks`);
  },

  createWebhook: async (id, body) => {
    const b = await getBaileys();
    if (b) return { id: `baileys_${id}`, url: body.url };
    return request('POST', `/api/sessions/${enc(id)}/webhooks`, { body });
  },

  updateWebhook: async (id, hookId, body) => {
    const b = await getBaileys();
    if (b) return { id: hookId, updated: true };
    return request('PUT', `/api/sessions/${enc(id)}/webhooks/${enc(hookId)}`, { body });
  },

  deleteWebhook: async (id, hookId) => {
    const b = await getBaileys();
    if (b) return { id: hookId, deleted: true };
    return request('DELETE', `/api/sessions/${enc(id)}/webhooks/${enc(hookId)}`);
  },

  statsOverview: async () => {
    const b = await getBaileys();
    if (b) {
      return {
        engine: 'baileys',
        activeSessions: b.activeSessions.size,
        uptime: process.uptime(),
      };
    }
    return request('GET', '/api/stats/overview');
  },
};
