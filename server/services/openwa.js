import { config } from '../config.js';

// Thin client for the OpenWA engine REST API. Every engine feature stays reachable through
// `request()` (used by the API Explorer and the public passthrough), while the helpers below
// cover what WaBridge itself needs.

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

export const engine = {
  health: () => request('GET', '/api/health', { timeoutMs: 5000 }),
  listSessions: () => request('GET', '/api/sessions'),
  getSession: (id) => request('GET', `/api/sessions/${enc(id)}`),
  createSession: (name, proxyUrl) =>
    request('POST', '/api/sessions', { body: proxyUrl ? { name, proxyUrl } : { name } }),
  startSession: (id) => request('POST', `/api/sessions/${enc(id)}/start`),
  stopSession: (id) => request('POST', `/api/sessions/${enc(id)}/stop`),
  logoutSession: (id) => request('POST', `/api/sessions/${enc(id)}/logout`),
  deleteSession: (id) => request('DELETE', `/api/sessions/${enc(id)}`),
  getQr: (id) => request('GET', `/api/sessions/${enc(id)}/qr`, { timeoutMs: 10000 }),
  pairingCode: (id, phoneNumber) =>
    request('POST', `/api/sessions/${enc(id)}/pairing-code`, { body: { phoneNumber } }),
  setProxy: (id, proxyUrl) => request('PATCH', `/api/sessions/${enc(id)}/proxy`, { body: { proxyUrl } }),
  chats: (id, limit = 100) => request('GET', `/api/sessions/${enc(id)}/chats`, { query: { limit } }),
  groups: (id) => request('GET', `/api/sessions/${enc(id)}/groups`),
  storedMessages: (id, chatId, limit = 50) =>
    request('GET', `/api/sessions/${enc(id)}/messages`, {
      query: { chatId, limit, orderBy: 'timestamp', direction: 'desc' },
    }),
  history: (id, chatId, limit = 50) =>
    request('GET', `/api/sessions/${enc(id)}/messages/${enc(chatId)}/history`, { query: { limit } }),
  checkNumber: (id, number) => request('GET', `/api/sessions/${enc(id)}/contacts/check/${enc(number)}`),
  markRead: (id, chatId) => request('POST', `/api/sessions/${enc(id)}/chats/read`, { body: { chatId } }),
  typing: (id, chatId, state = 'typing') =>
    request('POST', `/api/sessions/${enc(id)}/chats/typing`, { body: { chatId, state } }),
  sendText: (id, body) => request('POST', `/api/sessions/${enc(id)}/messages/send-text`, { body }),
  sendMedia: (id, kind, body) =>
    request('POST', `/api/sessions/${enc(id)}/messages/send-${kind}`, { body, timeoutMs: 120000 }),
  sendLocation: (id, body) => request('POST', `/api/sessions/${enc(id)}/messages/send-location`, { body }),
  sendPoll: (id, body) => request('POST', `/api/sessions/${enc(id)}/messages/send-poll`, { body }),
  listWebhooks: (id) => request('GET', `/api/sessions/${enc(id)}/webhooks`),
  createWebhook: (id, body) => request('POST', `/api/sessions/${enc(id)}/webhooks`, { body }),
  updateWebhook: (id, hookId, body) =>
    request('PUT', `/api/sessions/${enc(id)}/webhooks/${enc(hookId)}`, { body }),
  deleteWebhook: (id, hookId) => request('DELETE', `/api/sessions/${enc(id)}/webhooks/${enc(hookId)}`),
  statsOverview: () => request('GET', '/api/stats/overview'),
  currentEngine: () => request('GET', '/api/infra/engines/current'),
};
