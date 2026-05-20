import crypto from 'node:crypto';
import db from '../db.js';
import { userCan, normalisePermissions } from '../permissions.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  if (!password || typeof password !== 'string') throw new Error('Password required');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  try {
    const test = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const want = Buffer.from(hash, 'hex');
    if (test.length !== want.length) return false;
    return crypto.timingSafeEqual(want, test);
  } catch {
    return false;
  }
}

export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function findSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.created_at, s.last_seen,
           u.id AS user_id, u.username, u.name, u.role,
           u.is_owner, u.permissions
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`).get(token);
  if (!row) return null;
  let parsed = {};
  try { parsed = row.permissions ? JSON.parse(row.permissions) : {}; } catch { parsed = {}; }
  row.permissions = normalisePermissions(parsed);
  row.is_owner = row.is_owner === 1;
  return row;
}

export function touchSession(token) {
  db.prepare(`UPDATE sessions SET last_seen = datetime('now') WHERE token = ?`).run(token);
}

// Auth gate. Allows `openPaths` through unauthenticated; everything else needs
// a valid token. Tokens are read from either:
//   • `Authorization: Bearer <token>` header (preferred — used by fetch calls)
//   • `?token=<token>` query parameter (fallback — used by direct browser
//     navigation, <a href>, <iframe src>, which cannot attach headers)
export function requireAuth(openPaths = []) {
  return (req, res, next) => {
    const path = req.path;
    if (openPaths.some(p => path === p || path.startsWith(p + '/'))) return next();
    const auth = req.headers.authorization || '';
    let token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token && req.query?.token) token = String(req.query.token);
    const session = findSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthenticated' });
    touchSession(token);
    req.user = session;
    req.token = token;
    next();
  };
}

// Express middleware: deny unless req.user has the given permission (or is owner).
export function requirePermission(permId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (userCan(req.user, permId)) return next();
    return res.status(403).json({ error: `Forbidden — missing permission '${permId}'` });
  };
}

// Express middleware: only the owner account may proceed.
export function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (!req.user.is_owner) return res.status(403).json({ error: 'Forbidden — owner account required' });
  next();
}

// The "owner confirmation password" is stored hashed under the
// `owner_password` settings key. Verifies a plaintext attempt against it.
export function verifyOwnerSecret(plain) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'owner_password'`).get();
  if (!row) return false;
  let stored;
  try { stored = JSON.parse(row.value); } catch { return false; }
  return verifyPassword(plain || '', stored?.hash || '');
}
