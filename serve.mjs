// Local preview server for the built site, with the same security headers used in production.
//   node build.mjs && node serve.mjs      → http://localhost:4173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 4173;
// Re-read on every request so a rebuild takes effect without restarting the preview.
function loadHeaders() {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, '.headers.json'), 'utf8'));
  // Local preview runs on plain http: HSTS / upgrade-insecure-requests only make sense on a real HTTPS host.
  delete h['Strict-Transport-Security'];
  h['Content-Security-Policy'] = h['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
  return h;
}
let headers = loadHeaders();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESS = new Set(['.html', '.css', '.js', '.json', '.svg', '.xml', '.txt', '.webmanifest']);
const HIDDEN = new Set(['.headers.json', '_headers', 'vercel.json', '.htaccess']);

function send(res, status, file, req) {
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  const h = { ...headers, 'Content-Type': TYPES[ext] || 'application/octet-stream' };
  h['Cache-Control'] = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    h['Content-Encoding'] = 'gzip';
    h.Vary = 'Accept-Encoding';
    res.writeHead(status, h);
    return res.end(zlib.gzipSync(body));
  }
  res.writeHead(status, h);
  res.end(body);
}

http
  .createServer((req, res) => {
    headers = loadHeaders();
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      return res.end();
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400, headers);
      return res.end();
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(ROOT, pathname));
    const base = path.basename(file);
    const hiddenDot = base.startsWith('.') && !pathname.startsWith('/.well-known/');
    if (!file.startsWith(ROOT + path.sep) || HIDDEN.has(base) || hiddenDot || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, path.join(ROOT, '404.html'), req);
    }
    send(res, 200, file, req);
  })
  .listen(PORT, () => console.log(`WaBridge site preview → http://localhost:${PORT}`));
