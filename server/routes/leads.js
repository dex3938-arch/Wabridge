import express, { Router } from 'express';
import { get, run, parseJson, logActivity, nowIso } from '../db.js';
import { emitOutbound } from '../services/outbound.js';
import { upsertContact } from '../services/messaging.js';
import { normalizePhone } from '../services/text.js';

// Public lead capture for your marketing website's contact form → WaBridge Contacts.
// Disabled unless LEAD_FORM_ORIGINS lists the website origin(s), e.g. https://www.example.com
const r = Router();
const origins = () =>
  String(process.env.LEAD_FORM_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

// Small in-memory rate limiter: 5 leads per IP per 10 minutes, 200 per hour overall.
const perIp = new Map();
let globalWindow = { start: Date.now(), count: 0 };
function limited(ip) {
  const now = Date.now();
  if (now - globalWindow.start > 3600000) globalWindow = { start: now, count: 0 };
  if (++globalWindow.count > 200) return true;
  const hits = (perIp.get(ip) || []).filter((t) => now - t < 600000);
  hits.push(now);
  perIp.set(ip, hits);
  if (perIp.size > 5000) perIp.clear();
  return hits.length > 5;
}

function cors(req, res) {
  const origin = String(req.headers.origin || '');
  const allowed = origins();
  if (!allowed.length || !allowed.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

r.options('/', (req, res) => (cors(req, res) ? res.sendStatus(204) : res.sendStatus(403)));

r.post('/', express.json({ limit: '10kb' }), (req, res) => {
  if (!cors(req, res)) return res.status(403).json({ error: 'This website is not allowed to send leads.' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'JSON only.' });
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many messages. Please try again later.' });

  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot: pretend success to bots
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const phone = normalizePhone(String(b.phone || '').slice(0, 25));
  const email = String(b.email || '').trim().slice(0, 254);
  const topic = String(b.topic || '').trim().slice(0, 80);
  const message = String(b.message || '').trim().slice(0, 2000);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!phone || phone.length < 10 || phone.length > 15) return res.status(400).json({ error: 'Please enter a valid WhatsApp number with country code.' });
  if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email)) return res.status(400).json({ error: 'That e-mail address does not look right.' });
  if (message.length < 10) return res.status(400).json({ error: 'Please write a slightly longer message.' });
  if (b.consent !== true) return res.status(400).json({ error: 'Consent is required so we can reply.' });

  const contact = upsertContact(phone, name, 'website');
  const tags = new Set(parseJson(contact.tags, []));
  tags.add('website-lead');
  const stamp = nowIso().slice(0, 16).replace('T', ' ');
  const note = `[${stamp}] Website enquiry${topic ? ` (${topic})` : ''}: ${message}`;
  run(
    'UPDATE contacts SET tags = ?, email = COALESCE(NULLIF(?, \'\'), email), opted_in = 1, opted_out = 0, notes = CASE WHEN notes IS NULL OR notes = \'\' THEN ? ELSE notes || char(10) || ? END WHERE id = ?',
    JSON.stringify([...tags]),
    email,
    note,
    note,
    contact.id,
  );
  logActivity('lead.website', `New website enquiry from ${name} (${phone})${topic ? ` — ${topic}` : ''}`, { meta: { phone } });
  emitOutbound('lead.created', { name, phone, email, topic, message, page: String(b.page || '').slice(0, 200) });
  res.status(201).json({ ok: true, id: get('SELECT id FROM contacts WHERE phone = ?', phone)?.id });
});

export default r;
