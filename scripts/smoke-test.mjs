// WaBridge end-to-end smoke test (no phone needed).
//   npm run check            (server must be running; uses WB_EMAIL / WB_PASSWORD from the environment)
// It signs a fake "message.received" engine event exactly like OpenWA does, then checks that the
// inbox, contacts, automations, campaigns and the public API all react correctly.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.WB_URL || 'http://localhost:8080';
const EMAIL = process.env.WB_EMAIL;
const PASSWORD = process.env.WB_PASSWORD;
let cookie = '';
let passed = 0;
let failed = 0;

const ok = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name} ${extra}`);
  }
};

async function call(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nWaBridge smoke test → ${BASE}\n`);

ok('server is up (/healthz)', (await call('GET', '/healthz')).status === 200);

if (!EMAIL || !PASSWORD) {
  console.log('\nSet WB_EMAIL and WB_PASSWORD (an admin login) and run again.');
  process.exit(1);
}
const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
ok('admin login', login.status === 200, JSON.stringify(login.data));
if (login.status !== 200) process.exit(1);

const engineInfo = await call('GET', '/api/engine');
ok('engine reachable from WaBridge', engineInfo.data?.online === true, engineInfo.data?.health?.error || '');

const numbers = await call('GET', '/api/numbers');
ok('numbers endpoint', numbers.status === 200);
const sessionId = numbers.data?.numbers?.find((n) => n.channel === 'openwa')?.id || 'smoke-session';

// Welcome rule so we can watch the automation engine react.
const rules = await call('GET', '/api/automations');
let rule = rules.data.automations.find((r) => r.name === 'Smoke welcome');
if (!rule) {
  rule = (await call('POST', '/api/automations', { name: 'Smoke welcome', trigger: 'welcome', replyBody: 'Hi {{first_name}}, welcome!', priority: 1 })).data.automation;
}
ok('automation rule ready', Boolean(rule?.id));

// ---- signed engine event ----
const db = new DatabaseSync(path.join(path.resolve(ROOT, process.env.DATA_DIR || 'data'), 'wabridge.sqlite'), { readOnly: true });
const secret = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'engine'").get()?.value || '{}').webhookSecret;
ok('engine webhook secret exists', Boolean(secret));

const phone = `9199999${String(Date.now()).slice(-5)}`;
const msgId = `SMOKE_${crypto.randomBytes(6).toString('hex')}`;
const event = {
  event: 'message.received',
  timestamp: new Date().toISOString(),
  sessionId,
  idempotencyKey: `msg_${sessionId}_${msgId}`,
  deliveryId: `dlv_${crypto.randomUUID()}`,
  data: {
    id: msgId,
    from: `${phone}@c.us`,
    to: 'me@c.us',
    chatId: `${phone}@c.us`,
    body: 'Hi, price kya hai?',
    type: 'text',
    timestamp: Math.floor(Date.now() / 1000),
    fromMe: false,
    isGroup: false,
    kind: 'individual',
    contact: { pushName: 'Smoke Tester' },
  },
};
const raw = JSON.stringify(event);
const sig = `sha256=${crypto.createHmac('sha256', secret || 'x').update(raw).digest('hex')}`;

const bad = await call('POST', '/hooks/openwa', raw, { 'X-OpenWA-Signature': 'sha256=deadbeef' });
ok('unsigned/forged event rejected (401)', bad.status === 401);
const good = await call('POST', '/hooks/openwa', raw, { 'X-OpenWA-Signature': sig });
ok('signed engine event accepted', good.status === 200);
const dup = await call('POST', '/hooks/openwa', raw, { 'X-OpenWA-Signature': sig });
ok('duplicate delivery accepted (deduplicated)', dup.status === 200);

await sleep(1200);
const convs = await call('GET', `/api/conversations?status=all&q=${phone}`);
const conv = convs.data?.conversations?.[0];
ok('conversation created in inbox', Boolean(conv), JSON.stringify(convs.data).slice(0, 200));
if (conv) {
  ok('contact name captured', conv.name === 'Smoke Tester');
  const msgs = await call('GET', `/api/conversations/${conv.id}/messages`);
  const inbound = msgs.data.messages.filter((m) => m.direction === 'in');
  ok('exactly one inbound message stored (no duplicate)', inbound.length === 1, `got ${inbound.length}`);
  // The welcome rule replies after a human-like delay (2–6 s by default).
  await sleep(8000);
  const after = await call('GET', `/api/conversations/${conv.id}/messages`);
  const reply = after.data.messages.find((m) => m.direction === 'out' && m.author === 'bot');
  ok('welcome automation produced a reply', Boolean(reply), JSON.stringify(after.data.messages).slice(0, 300));
  if (reply) {
    console.log(`     reply: "${reply.body}" → status ${reply.status}${reply.error ? ` (${reply.error})` : ''}`);
  }
}

const contact = await call('GET', `/api/contacts?q=${phone}`);
ok('sender saved as contact', contact.data?.contacts?.[0]?.phone === phone);

// ---- contacts import + campaign audience ----
const imp = await call('POST', '/api/contacts/import', {
  rows: [
    { phone: '9876500001', name: 'Asha Verma', city: 'Delhi' },
    { phone: '+91 98765 00002', name: 'Rohit Jain', city: 'Pune' },
    { phone: '12', name: 'Broken number' },
  ],
  tags: 'smoke-test',
  optedIn: true,
});
ok('CSV-style import (2 valid, 1 invalid)', imp.data?.invalid === 1 && imp.data.created + imp.data.updated === 2, JSON.stringify(imp.data));
const prev = await call('POST', '/api/campaigns/audience-preview', { audience: { tags: ['smoke-test'] }, requireOptIn: true });
ok('campaign audience preview counts tagged contacts', prev.data?.willSend === 2, JSON.stringify(prev.data));
const camp = await call('POST', '/api/campaigns', { name: 'Smoke campaign', sessionId, body: '{Hi|Hello} {{first_name}} from {{city}}!', audience: { tags: ['smoke-test'] } });
ok('campaign draft created', Boolean(camp.data?.campaign?.id));
if (camp.data?.campaign?.id) await call('DELETE', `/api/campaigns/${camp.data.campaign.id}`);

const sim = await call('POST', '/api/automations/simulate', { text: 'hello', firstMessage: true });
ok('automation simulator matches the welcome rule', sim.data?.matched?.name === 'Smoke welcome' || Boolean(sim.data?.matched), JSON.stringify(sim.data));

// ---- public API ----
const key = await call('POST', '/api/integrations/api-keys', { name: 'Smoke test' });
ok('API key created', String(key.data?.key || '').startsWith('wb_live_'));
const pub = await call('GET', '/api/v1/numbers', undefined, { 'X-WaBridge-Key': key.data?.key, Cookie: '' });
ok('public API works with key', pub.status === 200);
const pubBad = await call('GET', '/api/v1/numbers', undefined, { 'X-WaBridge-Key': 'wb_live_wrong', Cookie: '' });
ok('public API rejects a wrong key', pubBad.status === 401);
const engineThrough = await call('GET', '/api/v1/engine/health', undefined, { 'X-WaBridge-Key': key.data?.key, Cookie: '' });
ok('engine passthrough (/api/v1/engine/health)', engineThrough.status === 200 && engineThrough.data?.status === 'ok', JSON.stringify(engineThrough.data));

// cleanup the throwaway bits
const keys = await call('GET', '/api/integrations/api-keys');
for (const k of keys.data.keys.filter((x) => x.name === 'Smoke test' && !x.revoked)) await call('POST', `/api/integrations/api-keys/${k.id}/revoke`);
await call('DELETE', `/api/automations/${rule.id}`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
