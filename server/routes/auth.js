import { Router } from 'express';
import { get, run, saveSettings, getSettings, logActivity } from '../db.js';
import { hashPassword, verifyPassword, issueSession, clearSession, currentUser, requireUser } from '../auth.js';

const r = Router();
const usersCount = () => get('SELECT COUNT(*) AS n FROM users').n;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function validate({ name, email, password }) {
  if (!name?.trim()) throw bad('Name is required.');
  if (!/^\S+@\S+\.\S+$/.test(email || '')) throw bad('Enter a valid email address.');
  if (!password || password.length < 8) throw bad('Password must be at least 8 characters.');
}

r.get('/state', (req, res) => {
  const user = currentUser(req);
  res.json({ setupRequired: usersCount() === 0, allowRegistration: Boolean(getSettings('general').allowRegistration), user });
});

// First run: create the owner account.
r.post('/setup', (req, res) => {
  if (usersCount() > 0) throw bad('Setup is already complete. Please sign in.', 409);
  const { name, email, password, businessName } = req.body || {};
  validate({ name, email, password });
  run("INSERT INTO users(name, email, password_hash, role) VALUES(?, ?, ?, 'admin')", name.trim(), email.trim(), hashPassword(password));
  if (businessName?.trim()) saveSettings('general', { businessName: businessName.trim() });
  const user = get('SELECT id, name, email, role FROM users WHERE email = ?', email.trim());
  issueSession(res, user);
  logActivity('auth.setup', `Workspace created by ${user.name}`, { userId: user.id });
  res.json({ user });
});

// General registration — open when public sign-ups are enabled (first user becomes admin if workspace is empty).
r.post('/register', (req, res) => {
  const isFirstUser = usersCount() === 0;
  if (!isFirstUser && !getSettings('general').allowRegistration) {
    throw bad('Sign-ups are not open. Ask an admin to enable them.', 403);
  }
  const { name, email, password, businessName } = req.body || {};
  validate({ name, email, password });
  if (get('SELECT 1 FROM users WHERE email = ?', email.trim())) throw bad('That email is already on the team.', 409);
  const role = isFirstUser ? 'admin' : 'agent';
  run('INSERT INTO users(name, email, password_hash, role) VALUES(?, ?, ?, ?)', name.trim(), email.trim(), hashPassword(password), role);
  if (isFirstUser && businessName?.trim()) saveSettings('general', { businessName: businessName.trim() });
  const user = get('SELECT id, name, email, role FROM users WHERE email = ?', email.trim());
  issueSession(res, user);
  logActivity(
    isFirstUser ? 'auth.setup' : 'auth.registered',
    isFirstUser ? `Workspace created by ${user.name}` : `New user registered: ${user.name}`,
    { userId: user.id },
  );
  res.json({ user });
});

r.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const row = get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
  if (!row || !row.active || !verifyPassword(String(password || ''), row.password_hash)) {
    throw bad('Wrong email or password.', 401);
  }
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  issueSession(res, user);
  res.json({ user });
});

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', requireUser, (req, res) => res.json({ user: req.user }));

r.post('/password', requireUser, (req, res) => {
  const { current, next } = req.body || {};
  const row = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(current || ''), row.password_hash)) throw bad('Current password is wrong.', 401);
  if (!next || next.length < 8) throw bad('New password must be at least 8 characters.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  res.json({ ok: true });
});

export default r;
