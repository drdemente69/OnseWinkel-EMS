import express from 'express';
import db from '../db.js';
import {
  hashPassword, verifyPassword, generateToken,
  requireOwner, verifyOwnerSecret,
} from '../services/auth.js';
import { PERMS, normalisePermissions } from '../permissions.js';

const router = express.Router();

const usernameOK = (s) => /^[a-z0-9._-]{3,32}$/.test(s);

function publicUser(row) {
  if (!row) return null;
  let perms = {};
  try { perms = row.permissions ? JSON.parse(row.permissions) : {}; } catch {}
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    is_owner: row.is_owner === 1,
    permissions: normalisePermissions(perms),
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

// ===== Auth =====

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user_id, user_agent) VALUES (?, ?, ?)').run(token, user.id, req.headers['user-agent'] || null);
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.status(204).end();
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.user_id);
  res.json(publicUser(row));
});

router.post('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.user_id);
  if (!user || !verifyPassword(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  // Invalidate every other session belonging to this user.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, req.token);
  res.json({ ok: true });
});

// ===== Permission catalogue (any signed-in user) =====
router.get('/permissions', (req, res) => res.json(PERMS));

// ===== User management — owner only =====

router.get('/users', requireOwner, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY is_owner DESC, username').all();
  res.json(rows.map(publicUser));
});

router.post('/users', requireOwner, (req, res) => {
  const { username, name, password, permissions, ownerPassword } = req.body || {};
  if (!verifyOwnerSecret(ownerPassword)) {
    return res.status(403).json({ error: 'Owner confirmation password is incorrect' });
  }
  if (!username || !usernameOK(String(username).toLowerCase())) {
    return res.status(400).json({ error: 'Username must be 3-32 chars (letters, digits, dot, dash, underscore)' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const lower = String(username).toLowerCase().trim();
  const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(lower);
  if (dup) return res.status(409).json({ error: 'Username already exists' });
  const perms = normalisePermissions(permissions);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, is_owner, permissions)
    VALUES (?, ?, ?, 'staff', 0, ?)`).run(
      lower, hashPassword(password), name || lower, JSON.stringify(perms),
    );
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(publicUser(created));
});

router.patch('/users/:id', requireOwner, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_owner === 1) return res.status(400).json({ error: 'The owner account is not editable here' });

  const updates = {};
  if (typeof req.body?.name === 'string') updates.name = req.body.name;
  if (req.body?.permissions && typeof req.body.permissions === 'object') {
    updates.permissions = JSON.stringify(normalisePermissions(req.body.permissions));
  }
  if (Object.keys(updates).length === 0) return res.json(publicUser(target));
  const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${sets} WHERE id = @id`).run({ ...updates, id: target.id });
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)));
});

router.post('/users/:id/reset-password', requireOwner, (req, res) => {
  const { newPassword, ownerPassword } = req.body || {};
  if (!verifyOwnerSecret(ownerPassword)) {
    return res.status(403).json({ error: 'Owner confirmation password is incorrect' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_owner === 1 && target.id !== req.user.user_id) {
    return res.status(403).json({ error: 'Cannot reset another owner account' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), target.id);
  // Force re-login on this user's other devices.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  res.json({ ok: true });
});

router.delete('/users/:id', requireOwner, (req, res) => {
  const { ownerPassword } = req.body || {};
  if (!verifyOwnerSecret(ownerPassword)) {
    return res.status(403).json({ error: 'Owner confirmation password is incorrect' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_owner === 1) return res.status(400).json({ error: 'Cannot delete an owner account' });
  if (target.id === req.user.user_id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.status(204).end();
});

// Change the owner confirmation password (owner only, must know current one).
router.post('/owner-secret', requireOwner, (req, res) => {
  const { current, next: nextSecret } = req.body || {};
  if (!verifyOwnerSecret(current)) {
    return res.status(403).json({ error: 'Current owner password is incorrect' });
  }
  if (!nextSecret || nextSecret.length < 6) {
    return res.status(400).json({ error: 'New owner password must be at least 6 characters' });
  }
  db.prepare(`INSERT INTO settings (key, value) VALUES ('owner_password', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    JSON.stringify({ hash: hashPassword(nextSecret) }),
  );
  res.json({ ok: true });
});

export default router;
