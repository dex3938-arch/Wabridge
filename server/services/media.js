import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';

export const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

// Saves base64 media under data/media and returns the dashboard URL ("/media/<file>").
export function saveBase64(base64, mimetype = 'application/octet-stream', filename = '') {
  if (!base64) return null;
  const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  const mime = String(mimetype).split(';')[0].trim();
  const fromName = path.extname(filename || '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = EXT[mime] || fromName || 'bin';
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), Buffer.from(clean, 'base64'));
  return `/media/${name}`;
}
