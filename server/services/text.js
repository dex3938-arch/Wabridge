import { getSettings } from '../db.js';

// ---------- phone numbers & chat ids ----------
export function normalizePhone(input, countryCode) {
  let digits = String(input ?? '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits.slice(1).replace(/\D/g, '');
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  const cc = countryCode ?? getSettings('general').defaultCountryCode ?? '';
  // A bare 10-digit local number (e.g. Indian mobile) gets the default country code.
  if (cc && digits.length === 10) return cc + digits;
  if (cc && digits.length === 11 && digits.startsWith('0')) return cc + digits.slice(1);
  return digits;
}

export const toChatId = (phone) => (String(phone).includes('@') ? String(phone) : `${phone}@c.us`);

export function phoneFromChatId(chatId) {
  const s = String(chatId || '');
  if (s.endsWith('@c.us') || s.endsWith('@s.whatsapp.net')) return s.split('@')[0].split(':')[0];
  return null;
}

export const isGroupChat = (chatId) => String(chatId || '').endsWith('@g.us');

// ---------- message personalisation ----------
// {Hi|Hello|Hey} picks one option at random — small variations make bulk sends look less robotic.
export function spin(text) {
  let out = String(text ?? '');
  for (let i = 0; i < 20 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group) => {
      const opts = group.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  }
  return out;
}

// {{name}}, {{first_name}}, {{phone}}, {{business}} and any custom field ({{city}}, …).
export function renderTemplate(text, contact = {}, extra = {}) {
  const general = getSettings('general');
  const name = (contact.name || '').trim();
  const vars = {
    name: name || 'there',
    first_name: name ? name.split(/\s+/)[0] : 'there',
    phone: contact.phone || '',
    business: general.businessName || '',
    ...(contact.fields || {}),
    ...extra,
  };
  return String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : '',
  );
}

export const personalise = (text, contact, extra) => spin(renderTemplate(text, contact, extra));

export function splitList(s) {
  return String(s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export const randomBetween = (min, max) => {
  const lo = Math.max(0, Number(min) || 0);
  const hi = Math.max(lo, Number(max) || lo);
  return lo + Math.random() * (hi - lo);
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- time helpers (business hours, quiet hours) ----------
export function localParts(timezone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  const hour = Number(parts.hour) % 24;
  return { day: dayIndex, minutes: hour * 60 + Number(parts.minute) };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function withinWindow(start, end, minutes) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

export function isBusinessOpen() {
  const bh = getSettings('businessHours');
  if (!bh.enabled) return true;
  const { day, minutes } = localParts(getSettings('general').timezone);
  if (!bh.days.includes(day)) return false;
  return withinWindow(bh.start, bh.end, minutes);
}

export function preview(text, n = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
