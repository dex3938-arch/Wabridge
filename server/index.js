import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { logActivity } from './db.js';
import { requireUser } from './auth.js';
import { sseHandler } from './services/events.js';
import { MEDIA_DIR } from './services/media.js';
import { startMonitor } from './services/monitor.js';
import { startCampaignRunner } from './services/campaigns.js';
import authRoutes from './routes/auth.js';
import numbersRoutes from './routes/numbers.js';
import inboxRoutes from './routes/inbox.js';
import contactsRoutes from './routes/contacts.js';
import campaignsRoutes from './routes/campaigns.js';
import overviewRoutes from './routes/overview.js';
import publicRoutes from './routes/public.js';
import hooksRoutes from './routes/hooks.js';
import leadRoutes from './routes/leads.js';
import { templates, automations, ai } from './routes/library.js';
import { settings, engineRoutes, integrations, team, activity, explorer } from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');

// Webhook receivers need the raw body, so they are mounted before the JSON parser.
app.use('/hooks', hooksRoutes);
// Public website lead form (own 10 kB body limit, CORS allow-list) — mounted before the big JSON parser.
app.use('/api/public/leads', leadRoutes);
app.use(express.json({ limit: '30mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, service: 'wabridge' }));

app.use('/api/auth', authRoutes);
app.use('/api/v1', publicRoutes);

const api = express.Router();
api.use(requireUser);
api.get('/events', sseHandler);
api.use('/overview', overviewRoutes);
api.use('/numbers', numbersRoutes);
api.use('/conversations', inboxRoutes);
api.use('/contacts', contactsRoutes);
api.use('/campaigns', campaignsRoutes);
api.use('/templates', templates);
api.use('/automations', automations);
api.use('/ai', ai);
api.use('/settings', settings);
api.use('/engine', engineRoutes);
api.use('/integrations', integrations);
api.use('/team', team);
api.use('/activity', activity);
api.use('/explorer', explorer);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Saved chat media (signed-in users only).
app.use('/media', requireUser, express.static(MEDIA_DIR, { maxAge: '7d', fallthrough: false }));

// Marketing landing pages + built dashboard SPA.
const bundle = path.join(ROOT, 'dist_bundle');
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(path.join(bundle, 'app.html'))) {
  app.use(express.static(bundle, { extensions: ['html'], maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(bundle, 'app.html')));
} else if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.type('text').send('WaBridge API is running. Build the dashboard with "npm run build", or use "npm run dev".'),
  );
}

// Errors → JSON with a friendly message.
app.use((err, req, res, _next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500 && status !== 503) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong', details: err.body || undefined });
});

if (process.env.VERCEL !== '1') {
  app.listen(config.port, config.host, () => {
    console.log(`WaBridge running on http://localhost:${config.port}`);
    if (process.env.USE_EXTERNAL_OPENWA === 'true' || process.env.USE_EXTERNAL_OPENWA === '1') {
      console.log(`  engine: external OpenWA at ${config.openwaUrl} (key ${config.openwaKey ? 'set' : 'MISSING'})`);
    } else {
      console.log(`  engine: embedded Baileys (pure-JS in-process WhatsApp Web engine)`);
      import('./services/baileys.js')
        .then((m) => m.initializeSessions?.())
        .catch((e) => console.warn('Failed to auto-initialize Baileys sessions:', e.message));
    }
    console.log(`  engine → WaBridge events: ${config.publicUrl}/hooks/openwa`);
    logActivity('system.start', 'WaBridge started');
    startMonitor();
    startCampaignRunner();
  });
}

export default app;
