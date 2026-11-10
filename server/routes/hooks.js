import express, { Router } from 'express';
import { logActivity } from '../db.js';
import { verifyEngineSignature, handleEngineEvent, handleMetaEvent } from '../services/inbound.js';
import { metaConfig, verifyMetaSignature } from '../services/meta.js';

// Event receivers. Raw bodies are kept so HMAC signatures can be checked byte-for-byte.
const r = Router();
const raw = express.raw({ type: '*/*', limit: '30mb' });

let badSignatures = 0;
r.post('/openwa', raw, (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifyEngineSignature(body, req.headers['x-openwa-signature'])) {
    if (++badSignatures % 20 === 1) {
      logActivity('webhook.rejected', 'Rejected an engine event with a bad signature', { level: 'warn' });
    }
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  res.json({ ok: true });
  handleEngineEvent(payload).catch((e) => logActivity('webhook.error', `Event processing failed: ${e.message}`, { level: 'error' }));
});

// Meta webhook verification handshake (Meta App → WhatsApp → Configuration → Webhook).
r.get('/meta', (req, res) => {
  const { verifyToken } = metaConfig();
  if (req.query['hub.mode'] === 'subscribe' && verifyToken && req.query['hub.verify_token'] === verifyToken) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

r.post('/meta', raw, (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifyMetaSignature(body, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
  res.sendStatus(200);
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return;
  }
  handleMetaEvent(payload).catch((e) => logActivity('webhook.error', `Meta event failed: ${e.message}`, { level: 'error' }));
});

export default r;
