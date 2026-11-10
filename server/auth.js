import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run, nowIso } from './db.js';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const COOKIE = 'wb_session';

// ---------- passwords (scrypt, no native deps) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- signed session tokens ----------
const b64 = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueSession(res, user) {
  const token = sign({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS });
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
  run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), user.id);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function currentUser(req) {
  const payload = unsign(readCookie(req, COOKIE));
  if (!payload) return null;
  const user = get('SELECT id, name, email, role, active FROM users WHERE id = ?', payload.uid);
  if (!user || !user.active) return null;
  return user;
}

export function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

// ---------- public API keys ----------
export const hashKey = (key) => crypto.createHmac('sha256', config.secret).update(key).digest('hex');

export function createApiKey() {
  const key = `wb_live_${crypto.randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 14), hash: hashKey(key) };
}

export function requireApiKey(req, res, next) {
  const raw =
    req.headers['x-wabridge-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    '';
  if (!raw) return res.status(401).json({ error: 'Missing X-WaBridge-Key header.' });
  const row = get('SELECT id, name, scope, revoked FROM api_keys WHERE key_hash = ?', hashKey(String(raw)));
  if (!row || row.revoked) return res.status(401).json({ error: 'Invalid or revoked API key.' });
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', nowIso(), row.id);
  req.apiKey = row;
  next();
}
