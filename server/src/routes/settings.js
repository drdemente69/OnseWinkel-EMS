import express from 'express';
import db from '../db.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();

function getAll() {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key != 'owner_password'`).all();
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
}

router.get('/', (req, res) => {
  res.json(getAll());
});

router.put('/:key', requirePermission('settings:edit'), (req, res) => {
  // The owner confirmation password is managed via /api/auth/owner-secret and
  // must not be writable here.
  if (req.params.key === 'owner_password') {
    return res.status(400).json({ error: 'Use /api/auth/owner-secret to change the owner password' });
  }
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(req.params.key, JSON.stringify(req.body || {}));
  res.json({ [req.params.key]: req.body });
});

export default router;
