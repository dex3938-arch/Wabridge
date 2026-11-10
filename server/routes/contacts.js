import { Router } from 'express';
import { all, get, run, tx, parseJson, logActivity } from '../db.js';
import { normalizePhone } from '../services/text.js';

const r = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const view = (c) => c && { ...c, tags: parseJson(c.tags, []), fields: parseJson(c.fields, {}) };
const cleanTags = (tags) =>
  [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(/[,;|]/)).map((t) => String(t).trim()).filter(Boolean))];

r.get('/', (req, res) => {
  const { q, tag, status, page = 1 } = req.query;
  const where = [];
  const p = [];
  if (q) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)');
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (tag) {
    where.push('tags LIKE ?');
    p.push(`%"${String(tag).replace(/"/g, '')}"%`);
  }
  if (status === 'opted_in') where.push('opted_in = 1 AND opted_out = 0');
  if (status === 'opted_out') where.push('opted_out = 1');
  if (status === 'no_consent') where.push('opted_in = 0 AND opted_out = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = 50;
  const offset = (Math.max(1, Number(page)) - 1) * size;
  const rows = all(`SELECT * FROM contacts ${w} ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ? OFFSET ?`, ...p, size, offset);
  const total = get(`SELECT COUNT(*) AS n FROM contacts ${w}`, ...p).n;
  res.json({ contacts: rows.map(view), total, page: Number(page), pageSize: size });
});

r.get('/tags', (req, res) => {
  const counts = {};
  for (const row of all('SELECT tags FROM contacts')) {
    for (const t of parseJson(row.tags, [])) counts[t] = (counts[t] || 0) + 1;
  }
  res.json({ tags: Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) });
});

r.get('/stats', (req, res) => {
  res.json(
    get(`SELECT COUNT(*) AS total, SUM(opted_in = 1 AND opted_out = 0) AS optedIn, SUM(opted_out = 1) AS optedOut,
                SUM(on_whatsapp = 1) AS onWhatsapp FROM contacts`),
  );
});

r.post('/', (req, res) => {
  const { phone, name, email, tags, notes, optedIn, fields } = req.body || {};
  const p = normalizePhone(phone);
  if (!p || p.length < 8) throw bad('Enter a valid phone number with country code.');
  if (get('SELECT 1 FROM contacts WHERE phone = ?', p)) throw bad('A contact with this number already exists.', 409);
  run(
    'INSERT INTO contacts(phone, name, email, tags, notes, opted_in, fields, source) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
    p,
    name || null,
    email || null,
    JSON.stringify(cleanTags(tags)),
    notes || null,
    optedIn ? 1 : 0,
    JSON.stringify(fields || {}),
    'manual',
  );
  res.json({ contact: view(get('SELECT * FROM contacts WHERE phone = ?', p)) });
});

r.patch('/:id', (req, res) => {
  const c = get('SELECT * FROM contacts WHERE id = ?', req.params.id);
  if (!c) throw bad('Contact not found.', 404);
  const { name, email, tags, notes, optedIn, optedOut, fields } = req.body || {};
  if (name !== undefined) run('UPDATE contacts SET name = ? WHERE id = ?', name || null, c.id);
  if (email !== undefined) run('UPDATE contacts SET email = ? WHERE id = ?', email || null, c.id);
  if (tags !== undefined) run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify(cleanTags(tags)), c.id);
  if (notes !== undefined) run('UPDATE contacts SET notes = ? WHERE id = ?', notes || null, c.id);
  if (fields !== undefined) run('UPDATE contacts SET fields = ? WHERE id = ?', JSON.stringify(fields || {}), c.id);
  if (optedIn !== undefined) run('UPDATE contacts SET opted_in = ?, opted_out = CASE WHEN ? THEN 0 ELSE opted_out END WHERE id = ?', optedIn ? 1 : 0, optedIn ? 1 : 0, c.id);
  if (optedOut !== undefined) run('UPDATE contacts SET opted_out = ?, opted_in = CASE WHEN ? THEN 0 ELSE opted_in END WHERE id = ?', optedOut ? 1 : 0, optedOut ? 1 : 0, c.id);
  if (name !== undefined) run('UPDATE conversations SET name = ? WHERE phone = ? AND is_group = 0', name || null, c.phone);
  res.json({ contact: view(get('SELECT * FROM contacts WHERE id = ?', c.id)) });
});

r.delete('/:id', (req, res) => {
  run('DELETE FROM contacts WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// rows: [{ phone, name, email, tags, ...customFields }]
r.post('/import', (req, res) => {
  const { rows = [], tags = [], optedIn = false } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import.');
  if (rows.length > 20000) throw bad('Import at most 20,000 contacts at a time.');
  const extraTags = cleanTags(tags);
  let created = 0;
  let updated = 0;
  let invalid = 0;
  tx(() => {
    for (const row of rows) {
      const p = normalizePhone(row.phone);
      if (!p || p.length < 8 || p.length > 15) {
        invalid++;
        continue;
      }
      const { phone, name, email, tags: rowTags, ...fields } = row;
      const allTags = cleanTags([...cleanTags(rowTags), ...extraTags]);
      const existing = get('SELECT * FROM contacts WHERE phone = ?', p);
      if (existing) {
        const merged = cleanTags([...parseJson(existing.tags, []), ...allTags]);
        run(
          `UPDATE contacts SET name = COALESCE(?, name), email = COALESCE(?, email), tags = ?, fields = ?,
             opted_in = CASE WHEN ? THEN 1 ELSE opted_in END WHERE id = ?`,
          name || null,
          email || null,
          JSON.stringify(merged),
          JSON.stringify({ ...parseJson(existing.fields, {}), ...fields }),
          optedIn ? 1 : 0,
          existing.id,
        );
        updated++;
      } else {
        run(
          'INSERT INTO contacts(phone, name, email, tags, fields, opted_in, source) VALUES(?, ?, ?, ?, ?, ?, ?)',
          p,
          name || null,
          email || null,
          JSON.stringify(allTags),
          JSON.stringify(fields),
          optedIn ? 1 : 0,
          'import',
        );
        created++;
      }
    }
  });
  logActivity('contacts.import', `Imported contacts: ${created} new, ${updated} updated, ${invalid} invalid`, { userId: req.user.id });
  res.json({ created, updated, invalid });
});

r.post('/bulk', (req, res) => {
  const { ids = [], addTags = [], removeTags = [], optedIn, remove } = req.body || {};
  const add = cleanTags(addTags);
  const del = cleanTags(removeTags);
  tx(() => {
    for (const id of ids) {
      const c = get('SELECT * FROM contacts WHERE id = ?', id);
      if (!c) continue;
      if (remove) {
        run('DELETE FROM contacts WHERE id = ?', id);
        continue;
      }
      if (add.length || del.length) {
        const tags = parseJson(c.tags, []).filter((t) => !del.includes(t));
        run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify(cleanTags([...tags, ...add])), id);
      }
      if (optedIn !== undefined) run('UPDATE contacts SET opted_in = ?, opted_out = CASE WHEN ? THEN 0 ELSE opted_out END WHERE id = ?', optedIn ? 1 : 0, optedIn ? 1 : 0, id);
    }
  });
  res.json({ ok: true, count: ids.length });
});

r.get('/export.csv', (req, res) => {
  const rows = all('SELECT * FROM contacts ORDER BY id');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['phone,name,email,tags,opted_in,opted_out,on_whatsapp,created_at'];
  for (const c of rows) {
    lines.push([c.phone, c.name, c.email, parseJson(c.tags, []).join('|'), c.opted_in, c.opted_out, c.on_whatsapp ?? '', c.created_at].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wabridge-contacts.csv"');
  res.send(lines.join('\n'));
});

export default r;
