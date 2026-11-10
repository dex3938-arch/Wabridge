export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function chatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

export function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function phonePretty(p) {
  if (!p) return '';
  const s = String(p).replace(/\D/g, '');
  if (s.startsWith('91') && s.length === 12) return `+91 ${s.slice(2, 7)} ${s.slice(7)}`;
  return `+${s}`;
}

export const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

export function duration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export const SESSION_STATUS = {
  ready: { label: 'Connected', tone: 'green' },
  qr_ready: { label: 'Scan QR', tone: 'amber' },
  authenticating: { label: 'Linking…', tone: 'blue' },
  initializing: { label: 'Starting…', tone: 'blue' },
  created: { label: 'Not started', tone: 'slate' },
  disconnected: { label: 'Disconnected', tone: 'red' },
  action_required: { label: 'Needs action', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
};

export const CAMPAIGN_STATUS = {
  draft: { label: 'Draft', tone: 'slate' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  running: { label: 'Sending', tone: 'green' },
  paused: { label: 'Paused', tone: 'amber' },
  completed: { label: 'Completed', tone: 'brand' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export function initials(name = '') {
  const parts = String(name).replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

const AVATAR_COLORS = [
  'from-indigo-500 to-violet-500',
  'from-sky-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-fuchsia-500 to-purple-500',
  'from-blue-500 to-indigo-500',
];
export function avatarColor(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// RFC-4180-ish CSV parser (handles quotes, commas and newlines inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
