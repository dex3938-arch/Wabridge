import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// Minimal .env loader (no dependency). Real environment variables win over the file.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const isServerless = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

export const DATA_DIR = isServerless
  ? path.join(os.tmpdir(), 'wabridge-data')
  : path.resolve(ROOT, env('DATA_DIR', './data'));

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* ignore on restricted environments */
}

// A stable secret for signing login tokens. Generated once and kept in data/ when not provided.
function resolveSecret() {
  const fromEnv = env('WABRIDGE_SECRET');
  if (fromEnv) return fromEnv;
  const file = path.join(DATA_DIR, '.secret');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch {
    return 'wabridge_default_secret_' + (process.env.VERCEL_GIT_COMMIT_SHA || 'temporary_secret_key_123');
  }
}

const port = Number(env('PORT', '8080')) || 8080;

export const config = {
  port,
  host: env('HOST', '0.0.0.0'),
  secret: resolveSecret(),
  openwaUrl: env('OPENWA_URL', 'http://localhost:2785').replace(/\/+$/, ''),
  openwaKey: env('OPENWA_API_KEY'),
  // Address the OpenWA engine uses to reach WaBridge's webhook receiver.
  publicUrl: env('WABRIDGE_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
  meta: {
    phoneNumberId: env('META_PHONE_NUMBER_ID'),
    wabaId: env('META_WABA_ID'),
    accessToken: env('META_ACCESS_TOKEN'),
    appSecret: env('META_APP_SECRET'),
    verifyToken: env('META_VERIFY_TOKEN'),
    graphVersion: env('META_GRAPH_VERSION', 'v23.0'),
  },
};
