// Captures high-resolution WaBridge screenshots from the demo instance for the website.
// node tools/capture.mjs <puppeteer-module-path> <base-url> <email> <password> <out-dir>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [modPath, base, email, password, out] = process.argv.slice(2);
const require = createRequire(path.join(modPath, 'package.json'));
const puppeteer = require('puppeteer');
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'] });
let page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
await page.evaluate(async (e, p) => {
  localStorage.setItem('wb-theme', 'light');
  await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
}, email, password);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.env.ONLY || '').split(',').filter(Boolean);
async function shot(route, name, { width = 1440, height = 900, scale = 2, before } = {}) {
  if (only.length && !only.includes(name)) return;
  await page.close();
  page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('header')?.innerText.includes('Live'), { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  if (before) await before();
  await sleep(500);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('captured', name);
}

await shot('/', 'app-overview');
await shot('/inbox/1', 'app-inbox');
await shot('/campaigns/1', 'app-campaign');
await shot('/automations', 'app-automations');
await shot('/contacts', 'app-contacts');
await shot('/numbers', 'app-numbers');
await shot('/campaigns/new', 'app-campaign-editor', {
  before: async () => {
    await page.type('input', 'Diwali festive offer');
    await page.select('select', 'demo-sales');
    const click = (t) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(t))?.click(), t);
    await click('Continue');
    await sleep(700);
    await click('diwali-2026');
    await sleep(700);
    await click('Continue');
    await sleep(700);
    await page.type('textarea', '{Hi|Hello} {{first_name}} 🪔\n\nOur *Diwali collection* is here — 20% off on sarees and kurta sets till Sunday.\n\nReply STOP to unsubscribe.');
    await sleep(900);
  },
});
await shot('/inbox/1', 'app-inbox-mobile', { width: 390, height: 844, scale: 3 });
await browser.close();
