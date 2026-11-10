// Zero-dependency static site builder for the WaBridge website.
//   node build.mjs        → writes ./dist (upload this folder to any web host)
// Edit site.config.json for your domain, e-mail, WhatsApp number and lead endpoint, then rebuild.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
// Optional overrides for test builds, e.g. LEAD_ENDPOINT=http://localhost:8080/api/public/leads node build.mjs
for (const [env, key] of [['SITE_URL', 'siteUrl'], ['LEAD_ENDPOINT', 'leadEndpoint']]) if (process.env[env] !== undefined) cfg[key] = process.env[env];
const siteUrl = cfg.siteUrl.replace(/\/+$/, '');
const today = new Date().toISOString().slice(0, 10);
const imgManifest = JSON.parse(fs.readFileSync(path.join(SRC, 'assets/img/manifest.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- assets with content hashes (long-term caching) ----------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const copyDir = (from, to, filter = () => true) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, filter);
    else if (filter(e.name)) fs.copyFileSync(a, b);
  }
};
copyDir(path.join(SRC, 'assets/img'), path.join(DIST, 'assets/img'), (n) => n !== 'manifest.json');
copyDir(path.join(SRC, 'assets/fonts'), path.join(DIST, 'assets/fonts'));
copyDir(path.join(SRC, 'static'), DIST);

const minifyCss = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
const hashed = (rel, content) => {
  const h = crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
  const out = rel.replace(/(\.[a-z]+)$/, `.${h}$1`);
  fs.mkdirSync(path.dirname(path.join(DIST, out)), { recursive: true });
  fs.writeFileSync(path.join(DIST, out), content);
  return out;
};
const cssPath = hashed('assets/css/main.css', minifyCss(fs.readFileSync(path.join(SRC, 'assets/css/main.css'), 'utf8')));
const jsPath = hashed('assets/js/main.js', fs.readFileSync(path.join(SRC, 'assets/js/main.js'), 'utf8'));

// ---------- security headers / CSP ----------
const leadOrigin = cfg.leadEndpoint ? new URL(cfg.leadEndpoint).origin : '';
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${leadOrigin ? ` ${leadOrigin}` : ''}`,
  "form-action 'self' mailto:",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');
const metaCsp = csp.replace("; frame-ancestors 'none'", ''); // not allowed in <meta>
const headers = {
  'Content-Security-Policy': csp,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

// ---------- partials ----------
const sprite = fs.readFileSync(path.join(SRC, 'partials/icons.svg'), 'utf8');
const headerTpl = fs.readFileSync(path.join(SRC, 'partials/header.html'), 'utf8');
const footerTpl = fs.readFileSync(path.join(SRC, 'partials/footer.html'), 'utf8');

const NAV = [
  ['index.html', 'Home'],
  ['features.html', 'Features'],
  ['how-it-works.html', 'How it works'],
  ['use-cases.html', 'Use cases'],
  ['contact.html', 'Contact'],
];

const waDigits = String(cfg.whatsapp || '').replace(/\D/g, '');
const vars = {
  siteUrl,
  siteName: cfg.siteName,
  publisher: cfg.publisher || cfg.siteName,
  email: cfg.email || '',
  whatsapp: waDigits,
  whatsappLink: waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent('Hi, I would like to know more about WaBridge.')}` : '',
  appUrl: cfg.appUrl || '',
  leadEndpoint: cfg.leadEndpoint || '',
  year: String(new Date().getFullYear()),
  updated: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
};

function fill(html) {
  // {{#if key}} ... {{/if}} blocks disappear when the value is empty.
  html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k, inner) => (vars[k] ? inner : ''));
  html = html.replace(/\{\{#unless (\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_, k, inner) => (vars[k] ? '' : inner));
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
}

// <!--img slug="hero" alt="…" sizes="…" eager class="…"--> → responsive <picture>
function pictures(html) {
  return html.replace(/<!--img ([^>]*?)-->/g, (_, attrs) => {
    const a = Object.fromEntries([...attrs.matchAll(/(\w+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? true]));
    const info = imgManifest[a.slug];
    if (!info) throw new Error(`Unknown image slug: ${a.slug}`);
    const sizes = a.sizes || '100vw';
    const set = (ext) => info.widths.map((w) => `assets/img/${a.slug}-${w}.${ext} ${w}w`).join(', ');
    const largest = info.widths[info.widths.length - 1];
    const eager = a.eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    return `<picture><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}"><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}"><img src="assets/img/${a.slug}-${largest}.webp" alt="${esc(a.alt || '')}" width="${info.width}" height="${info.height}" ${eager} decoding="async"${a.class ? ` class="${a.class}"` : ''}></picture>`;
  });
}

function jsonLd(objects) {
  return objects.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
}

const org = {
  '@type': 'Organization',
  '@id': `${siteUrl}/#org`,
  name: vars.publisher,
  url: `${siteUrl}/`,
  logo: `${siteUrl}/assets/img/logo-512.png`,
  ...(cfg.email ? { email: cfg.email } : {}),
  ...(waDigits ? { contactPoint: { '@type': 'ContactPoint', telephone: `+${waDigits}`, contactType: 'customer support', areaServed: cfg.country || 'IN', availableLanguage: ['English', 'Hindi'] } } : {}),
};

function render(file) {
  const raw = fs.readFileSync(path.join(SRC, 'pages', file), 'utf8');
  const m = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file}: missing <!--meta {...}--> header`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const isRoot = file === 'index.html';
  const canonical = isRoot ? `${siteUrl}/` : `${siteUrl}/${file}`;
  const assetPrefix = file === '404.html' ? '/' : '';

  const ld = [];
  if (isRoot) {
    ld.push({ '@context': 'https://schema.org', '@graph': [org, { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: cfg.siteName, publisher: { '@id': `${siteUrl}/#org` }, inLanguage: 'en-IN' }] });
  }
  if (meta.software) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: cfg.siteName,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Windows, macOS, Linux (Docker)',
      description: meta.description,
      url: canonical,
      image: `${siteUrl}/assets/img/og-wabridge.jpg`,
      publisher: { '@id': `${siteUrl}/#org` },
      featureList: meta.software,
    });
  }
  if (!isRoot && file !== '404.html') {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: meta.crumb || meta.title, item: canonical },
      ],
    });
  }
  // FAQ schema straight from the visible <details class="faq-item"> markup (kept in sync automatically).
  const faqs = [...body.matchAll(/<details class="glass faq-item"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="answer">([\s\S]*?)<\/div>/g)];
  if (faqs.length) {
    const strip = (h) => fill(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: strip(f[1]), acceptedAnswer: { '@type': 'Answer', text: strip(f[2]) } })) });
  }
  if (meta.howto) ld.push({ '@context': 'https://schema.org', '@type': 'HowTo', name: meta.howto.name, totalTime: meta.howto.totalTime, step: meta.howto.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s[0], text: s[1] })) });

  const navLinks = NAV.map(([href, label]) => `<li><a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const mobileLinks = NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const header = headerTpl.replace('<!--nav-->', navLinks).replace('<!--mobile-nav-->', mobileLinks);

  const preload = meta.preload && imgManifest[meta.preload]
    ? `<link rel="preload" as="image" type="image/avif" imagesrcset="${imgManifest[meta.preload].widths.map((w) => `assets/img/${meta.preload}-${w}.avif ${w}w`).join(', ')}" imagesizes="${meta.preloadSizes || '100vw'}" fetchpriority="high">`
    : '';

  let html = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${metaCsp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="robots" content="${meta.robots || 'index, follow, max-image-preview:large'}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#059669">
<meta name="color-scheme" content="light">
<meta property="og:type" content="${isRoot ? 'website' : 'article'}">
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:title" content="${esc(meta.ogTitle || meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${siteUrl}/assets/img/og-wabridge.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="WaBridge — self-hosted WhatsApp team inbox and automation">
<meta property="og:locale" content="${cfg.locale || 'en_IN'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.ogTitle || meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${siteUrl}/assets/img/og-wabridge.jpg">
<link rel="icon" href="${assetPrefix}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${assetPrefix}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${assetPrefix}apple-touch-icon.png">
<link rel="manifest" href="${assetPrefix}site.webmanifest">
<link rel="preload" href="${assetPrefix}assets/fonts/plus-jakarta-sans-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
${preload}
<link rel="stylesheet" href="${assetPrefix}${cssPath}">
${jsonLd(ld)}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${sprite}
${header}
<main id="main">
${body}
</main>
${footerTpl}
<script src="${assetPrefix}${jsPath}" defer></script>
</body>
</html>
`;
  html = pictures(fill(html));
  if (assetPrefix) html = html.replace(/(src|srcset|href)="assets\//g, '$1="/assets/').replace(/ (assets\/img\/[^ ]+ \d+(?:w|x))/g, ' /$1').replace(/href="(index|features|how-it-works|use-cases|contact|privacy)\.html/g, 'href="/$1.html');
  // Collapse whitespace between tags (keeps <pre>/<textarea> content intact because those use explicit newlines inside).
  html = html.replace(/>\s{2,}</g, '>\n<');
  fs.writeFileSync(path.join(DIST, file), html);
  return { file, canonical, meta };
}

const pages = fs.readdirSync(path.join(SRC, 'pages')).filter((f) => f.endsWith('.html'));
const built = pages.map(render);

// ---------- sitemap, robots, manifest, security.txt, host configs ----------
const priority = { 'index.html': '1.0', 'features.html': '0.9', 'how-it-works.html': '0.8', 'use-cases.html': '0.8', 'contact.html': '0.7', 'privacy.html': '0.3' };
const urls = built.filter((p) => p.file !== '404.html' && !String(p.meta.robots || '').includes('noindex'));
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((p) => `  <url><loc>${p.canonical}</loc><lastmod>${today}</lastmod><priority>${priority[p.file] || '0.5'}</priority></url>`)
    .join('\n')}\n</urlset>\n`,
);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /404.html\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
fs.writeFileSync(
  path.join(DIST, 'site.webmanifest'),
  JSON.stringify({ name: cfg.siteName, short_name: cfg.siteName, start_url: '/', display: 'standalone', background_color: '#f2faf5', theme_color: '#059669', icons: [{ src: '/assets/img/logo-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/img/logo-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2),
);
fs.mkdirSync(path.join(DIST, '.well-known'), { recursive: true });
const expires = new Date(Date.now() + 365 * 86400000).toISOString();
fs.writeFileSync(path.join(DIST, '.well-known/security.txt'), `${cfg.email ? `Contact: mailto:${cfg.email}\n` : ''}Expires: ${expires}\nPreferred-Languages: en, hi\nCanonical: ${siteUrl}/.well-known/security.txt\n`);

const longCache = 'public, max-age=31536000, immutable';
const shortCache = 'public, max-age=600, must-revalidate';
// Netlify / Cloudflare Pages
fs.writeFileSync(
  path.join(DIST, '_headers'),
  `/*\n${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n  Cache-Control: ${shortCache}\n\n/assets/*\n  Cache-Control: ${longCache}\n`,
);
// Vercel
fs.writeFileSync(
  path.join(DIST, 'vercel.json'),
  JSON.stringify({ cleanUrls: false, trailingSlash: false, headers: [{ source: '/(.*)', headers: Object.entries(headers).map(([key, value]) => ({ key, value })) }, { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: longCache }] }] }, null, 2),
);
// Apache / cPanel / Hostinger
fs.writeFileSync(
  path.join(DIST, '.htaccess'),
  `# WaBridge site — security & caching (Apache, cPanel, Hostinger, …)
Options -Indexes
ErrorDocument 404 /404.html
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>
<IfModule mod_headers.c>
${Object.entries(headers).map(([k, v]) => `  Header always set ${k} "${v}"`).join('\n')}
  <FilesMatch "\\.(css|js|woff2|avif|webp|png|svg)$">
    Header set Cache-Control "${longCache}"
  </FilesMatch>
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript image/svg+xml application/json text/xml
</IfModule>
<FilesMatch "^(\\.|vercel\\.json|_headers)">
  Require all denied
</FilesMatch>
<Files ".htaccess">
  Require all denied
</Files>
`,
);
// Local preview server + nginx reuse the same values
fs.writeFileSync(path.join(DIST, '.headers.json'), JSON.stringify(headers, null, 2));
fs.writeFileSync(
  path.join(ROOT, 'deploy', 'nginx.conf'),
  `# nginx server block for the WaBridge site (generated by build.mjs)
server {
  listen 443 ssl http2;
  server_name ${new URL(siteUrl).hostname};
  root /var/www/wabridge-site;   # upload the dist/ folder here
  index index.html;
  server_tokens off;
  error_page 404 /404.html;
${Object.entries(headers).map(([k, v]) => `  add_header ${k} "${v}" always;`).join('\n')}
  location /assets/ { add_header Cache-Control "${longCache}"; ${Object.entries(headers).map(([k, v]) => `add_header ${k} "${v}" always;`).join(' ')} }
  location ~ /\\.(?!well-known) { deny all; }
  location = /vercel.json { deny all; }
  location = /_headers { deny all; }
  gzip on; gzip_types text/css application/javascript image/svg+xml application/json;
}
`,
);

const warn = siteUrl.includes('.example') ? '\n⚠  siteUrl in site.config.json is still the placeholder — set your real domain before going live.' : '';
console.log(`Built ${built.length} pages → dist/  (css ${cssPath}, js ${jsPath})${warn}`);
