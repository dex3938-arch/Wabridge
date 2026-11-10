import { Router } from 'express';
import { all, get, getSettings } from '../db.js';
import { engineState } from '../services/monitor.js';

const r = Router();

r.get('/', (req, res) => {
  const today = "strftime('%Y-%m-%dT00:00:00Z','now')";
  const msgs = get(
    `SELECT SUM(direction = 'in') AS received, SUM(direction = 'out' AND status != 'failed') AS sent,
            SUM(direction = 'out' AND status = 'failed') AS failed,
            SUM(direction = 'out' AND author IN ('bot','ai')) AS automated
       FROM messages WHERE created_at >= ${today}`,
  );
  const reads = get(
    `SELECT SUM(status IN ('delivered','read')) AS delivered, SUM(status = 'read') AS read, COUNT(*) AS total
       FROM messages WHERE direction = 'out' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`,
  );
  const convs = get(
    `SELECT SUM(status = 'open') AS open, SUM(status = 'pending') AS pending,
            SUM(assigned_to IS NULL AND status != 'closed') AS unassigned, SUM(unread > 0) AS unread
       FROM conversations`,
  );
  const contacts = get('SELECT COUNT(*) AS total, SUM(opted_out = 1) AS optedOut, SUM(opted_in = 1) AS optedIn FROM contacts');
  const campaigns = get(
    "SELECT SUM(status = 'running') AS running, SUM(status = 'scheduled') AS scheduled, SUM(status = 'completed') AS completed FROM campaigns",
  );

  // 14-day series, bucketed by UTC day.
  const rows = all(
    `SELECT substr(created_at, 1, 10) AS day, direction, COUNT(*) AS n FROM messages
      WHERE created_at >= strftime('%Y-%m-%dT00:00:00Z','now','-13 days')
      GROUP BY day, direction`,
  );
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    series.push({
      day: d,
      in: rows.find((x) => x.day === d && x.direction === 'in')?.n || 0,
      out: rows.find((x) => x.day === d && x.direction === 'out')?.n || 0,
    });
  }

  // Median first-response time over the last 7 days (customer message → next agent/bot reply).
  const pairs = all(
    `SELECT m.conversation_id, m.created_at AS asked,
            (SELECT MIN(o.created_at) FROM messages o WHERE o.conversation_id = m.conversation_id
               AND o.direction = 'out' AND o.created_at > m.created_at) AS answered
       FROM messages m
      WHERE m.direction = 'in' AND m.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
      LIMIT 2000`,
  )
    .filter((p) => p.answered)
    .map((p) => (Date.parse(p.answered) - Date.parse(p.asked)) / 1000)
    .sort((a, b) => a - b);
  const medianResponse = pairs.length ? pairs[Math.floor(pairs.length / 2)] : null;

  const sessions = engineState.sessions || [];
  res.json({
    businessName: getSettings('general').businessName,
    engine: { online: engineState.online, error: engineState.error },
    numbers: {
      total: sessions.length,
      ready: sessions.filter((s) => s.status === 'ready').length,
      list: sessions.map((s) => ({ id: s.id, name: s.name, status: s.status, phone: s.phone })),
    },
    messages: {
      received: msgs.received || 0,
      sent: msgs.sent || 0,
      failed: msgs.failed || 0,
      automated: msgs.automated || 0,
      deliveryRate: reads.total ? Math.round(((reads.delivered || 0) / reads.total) * 100) : null,
      readRate: reads.total ? Math.round(((reads.read || 0) / reads.total) * 100) : null,
    },
    conversations: {
      open: convs.open || 0,
      pending: convs.pending || 0,
      unassigned: convs.unassigned || 0,
      unread: convs.unread || 0,
    },
    contacts: { total: contacts.total || 0, optedOut: contacts.optedOut || 0, optedIn: contacts.optedIn || 0 },
    campaigns: { running: campaigns.running || 0, scheduled: campaigns.scheduled || 0, completed: campaigns.completed || 0 },
    medianResponseSeconds: medianResponse,
    series,
    topRules: all('SELECT id, name, hits FROM automations WHERE hits > 0 ORDER BY hits DESC LIMIT 5'),
    activity: all('SELECT * FROM activity ORDER BY id DESC LIMIT 12'),
  });
});

export default r;
