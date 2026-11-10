import crypto from 'node:crypto';
import { getSettings } from '../db.js';
import { config } from '../config.js';

// Optional official channel: Meta WhatsApp Cloud API. Credentials come from Settings → Official API
// (stored in the local database) and fall back to META_* environment variables.

export function metaConfig() {
  const s = getSettings('meta');
  const pick = (k) => s[k] || config.meta[k] || '';
  return {
    enabled: Boolean(s.enabled),
    phoneNumberId: pick('phoneNumberId'),
    wabaId: pick('wabaId'),
    accessToken: pick('accessToken'),
    appSecret: pick('appSecret'),
    verifyToken: pick('verifyToken'),
    graphVersion: pick('graphVersion') || 'v23.0',
  };
}

export const metaReady = () => {
  const c = metaConfig();
  return c.enabled && Boolean(c.phoneNumberId && c.accessToken);
};

export const META_SESSION = 'meta-cloud';

async function graph(method, path, body) {
  const c = metaConfig();
  if (!c.accessToken) throw Object.assign(new Error('Meta access token is not configured.'), { status: 400 });
  const res = await fetch(`https://graph.facebook.com/${c.graphVersion}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.error_user_msg || data?.error?.message || `Meta API HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, body: data });
  }
  return data;
}

export async function metaSendText(to, text) {
  const c = metaConfig();
  const data = await graph('POST', `${c.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: true, body: text },
  });
  return { messageId: data?.messages?.[0]?.id };
}

// Approved template. `params` fill {{1}}, {{2}}, … in the template body.
export async function metaSendTemplate(to, name, language = 'en', params = []) {
  const c = metaConfig();
  const template = { name, language: { code: language } };
  if (params.length) {
    template.components = [
      { type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) },
    ];
  }
  const data = await graph('POST', `${c.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template,
  });
  return { messageId: data?.messages?.[0]?.id };
}

export async function metaSendMedia(to, kind, link, caption, filename) {
  const c = metaConfig();
  const type = { image: 'image', video: 'video', document: 'document', audio: 'audio' }[kind] || 'document';
  const media = { link };
  if (caption && type !== 'audio') media.caption = caption;
  if (filename && type === 'document') media.filename = filename;
  const data = await graph('POST', `${c.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type,
    [type]: media,
  });
  return { messageId: data?.messages?.[0]?.id };
}

export async function metaPhoneInfo() {
  const c = metaConfig();
  return graph('GET', `${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`);
}

export async function metaTemplates() {
  const c = metaConfig();
  if (!c.wabaId) throw Object.assign(new Error('WABA ID is required to list templates.'), { status: 400 });
  const data = await graph('GET', `${c.wabaId}/message_templates?fields=name,status,language,category,components&limit=100`);
  return data?.data || [];
}

export function verifyMetaSignature(rawBody, header) {
  const { appSecret } = metaConfig();
  if (!appSecret) return true; // signature check is enabled once an App Secret is saved
  if (!header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
