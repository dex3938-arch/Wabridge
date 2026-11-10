// Stand-in OpenWA engine used ONLY to take marketing screenshots of WaBridge with a "connected" number.
// node tools/mock-engine.mjs  → http://localhost:2799
import http from 'node:http';

const sessions = [
  { id: 'demo-sales', name: 'sales', status: 'ready', phone: '919811122233', pushName: 'GreenLeaf Store', connectedAt: new Date(Date.now() - 9 * 86400000).toISOString(), lastActive: new Date().toISOString(), createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), updatedAt: new Date().toISOString(), lastError: null, engineLoaded: true },
  { id: 'demo-support', name: 'support', status: 'ready', phone: '919811144455', pushName: 'GreenLeaf Support', connectedAt: new Date(Date.now() - 23 * 86400000).toISOString(), lastActive: new Date().toISOString(), createdAt: new Date(Date.now() - 23 * 86400000).toISOString(), updatedAt: new Date().toISOString(), lastError: null, engineLoaded: true },
];
let hookId = 0;

http
  .createServer((req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/api/health') return json(200, { status: 'ok', version: 'demo' });
    if (p === '/api/sessions') return json(200, sessions);
    if (p === '/api/infra/engines/current') return json(200, { engine: 'whatsapp-web.js' });
    if (/\/webhooks$/.test(p)) return req.method === 'GET' ? json(200, []) : json(201, { id: `hook-${++hookId}` });
    if (/\/webhooks\//.test(p)) return json(200, { ok: true });
    if (/\/messages\/send-/.test(p)) return json(201, { messageId: `demo_${Date.now()}`, timestamp: Math.floor(Date.now() / 1000) });
    if (/\/messages$/.test(p)) return json(200, { messages: [], total: 0 });
    if (/\/chats/.test(p)) return json(200, { ok: true });
    const m = p.match(/^\/api\/sessions\/([^/]+)$/);
    if (m) return json(200, sessions.find((s) => s.id === m[1]) || sessions[0]);
    json(200, {});
  })
  .listen(2799, () => console.log('mock engine on :2799'));
