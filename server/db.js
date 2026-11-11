import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {}

export const db = new DatabaseSync(path.join(DATA_DIR, 'wabridge.sqlite'));
const isServerless = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isServerless) {
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {}
}
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS numbers (
  session_id TEXT PRIMARY KEY,
  label TEXT,
  color TEXT,
  warmup_started_at TEXT,
  daily_limit INTEGER,
  webhook_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  opted_in INTEGER NOT NULL DEFAULT 0,
  opted_out INTEGER NOT NULL DEFAULT 0,
  on_whatsapp INTEGER,
  source TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'openwa',
  session_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  phone TEXT,
  name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_direction TEXT,
  last_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bot_paused INTEGER NOT NULL DEFAULT 0,
  last_inbound_at TEXT,
  last_human_reply_at TEXT,
  backfilled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, chat_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  wa_id TEXT,
  direction TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_name TEXT,
  media_path TEXT,
  media_mime TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  author TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(conversation_id, wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_wa_only ON messages(wa_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  shortcut TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'openwa',
  session_id TEXT,
  body TEXT,
  media TEXT,
  meta_template TEXT,
  audience TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  schedule_at TEXT,
  min_delay INTEGER NOT NULL DEFAULT 20,
  max_delay INTEGER NOT NULL DEFAULT 60,
  daily_cap INTEGER NOT NULL DEFAULT 100,
  quiet_start TEXT,
  quiet_end TEXT,
  stop_after_failures INTEGER NOT NULL DEFAULT 5,
  require_opt_in INTEGER NOT NULL DEFAULT 1,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_send_at TEXT,
  last_error TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER,
  phone TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  wa_id TEXT,
  sent_at TEXT,
  UNIQUE(campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_recipients ON campaign_recipients(campaign_id, status);
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  session_id TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'keyword',
  match_type TEXT NOT NULL DEFAULT 'contains',
  keywords TEXT NOT NULL DEFAULT '',
  reply_type TEXT NOT NULL DEFAULT 'text',
  reply_body TEXT,
  add_tag TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  include_groups INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automation_hits (
  automation_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  hit_at TEXT NOT NULL,
  PRIMARY KEY (automation_id, conversation_id)
);
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["*"]',
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_status INTEGER,
  last_error TEXT,
  last_at TEXT,
  deliveries INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'full',
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  meta TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
CREATE TABLE IF NOT EXISTS seen_events (
  key TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- tiny query helpers ----------
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
export const all = (sql, ...p) => stmt(sql).all(...p);
export const get = (sql, ...p) => stmt(sql).get(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
export const parseJson = (v, d) => {
  if (v == null || v === '') return d;
  try {
    return JSON.parse(v);
  } catch {
    return d;
  }
};

// ---------- settings (JSON values, merged over defaults) ----------
export const DEFAULT_SETTINGS = {
  general: {
    businessName: 'My Business',
    timezone: 'Asia/Kolkata',
    defaultCountryCode: '91',
    allowRegistration: true,
  },
  businessHours: {
    enabled: false,
    days: [1, 2, 3, 4, 5, 6],
    start: '09:00',
    end: '19:00',
  },
  safety: {
    optOutKeywords: 'STOP, UNSUBSCRIBE, CANCEL, BAND KARO',
    optInKeywords: 'START, SUBSCRIBE',
    optOutReply: 'You have been unsubscribed. Reply START to subscribe again.',
    optInReply: 'You are subscribed again. Reply STOP any time to unsubscribe.',
    humanTakeoverMinutes: 30,
    replyDelayMin: 2,
    replyDelayMax: 6,
    defaultMinDelay: 25,
    defaultMaxDelay: 70,
    defaultDailyCap: 80,
  },
  ai: {
    enabled: false,
    apiKey: '',
    model: 'claude-opus-5-5',
    effort: 'low',
    persona:
      'You are a friendly, concise customer-support assistant for our business on WhatsApp. Reply in the same language the customer uses (English, Hindi or Hinglish). Keep replies short (1-4 sentences). If you do not know something, say a team member will follow up.',
    knowledge: '',
    handoffKeywords: 'agent, human, talk to person, call me',
    maxPerHour: 30,
  },
  meta: {
    enabled: false,
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
    appSecret: '',
    verifyToken: '',
    graphVersion: 'v23.0',
  },
  engine: {
    webhookSecret: '',
  },
  alerts: {
    notifyOnDisconnect: true,
  },
};

export function getSettings(section) {
  const row = get('SELECT value FROM settings WHERE key = ?', section);
  return { ...(DEFAULT_SETTINGS[section] || {}), ...parseJson(row?.value, {}) };
}
export function saveSettings(section, patch) {
  const next = { ...getSettings(section), ...patch };
  run(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    section,
    JSON.stringify(next),
  );
  return next;
}

export function logActivity(type, message, { level = 'info', meta = null, userId = null } = {}) {
  run(
    'INSERT INTO activity(type, level, message, meta, user_id) VALUES(?, ?, ?, ?, ?)',
    type,
    level,
    message,
    meta ? JSON.stringify(meta) : null,
    userId,
  );
}

// Keep the dedupe table and activity log bounded.
export function housekeeping() {
  run("DELETE FROM seen_events WHERE seen_at < datetime('now', '-3 days')");
  run("DELETE FROM activity WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')");
}
