import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import db from '../db.js';
import config from '../config.js';
import { makeUploader, relPath, absFromStorage } from '../services/storage.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();
const upload = makeUploader('employees');

// Global list (across all active employees).
// Documents belonging to inactive/archived employees stay reachable through
// the Employees → Profile → Documents tab, but never surface in this global
// vault list.
router.get('/', (req, res) => {
  const { q, tag, employeeId } = req.query;
  let sql = `SELECT d.*, e.first_name, e.last_name FROM documents d
             JOIN employees e ON e.id = d.employee_id`;
  const where = [`e.status = 'active'`];
  const params = {};
  if (employeeId) { where.push('d.employee_id = @employeeId'); params.employeeId = employeeId; }
  if (tag && tag !== 'all') { where.push('d.tag = @tag'); params.tag = tag; }
  if (q) {
    where.push('(d.name LIKE @q OR d.tag LIKE @q OR e.first_name LIKE @q OR e.last_name LIKE @q)');
    params.q = `%${q}%`;
  }
  sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY d.uploaded_at DESC';
  res.json(db.prepare(sql).all(params));
});

router.post('/:employeeId', requirePermission('documents:upload'), upload.single('file'), (req, res) => {
  const { employeeId } = req.params;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
  if (!emp) {
    fs.unlinkSync(file.path);
    return res.status(404).json({ error: 'Employee not found' });
  }

  const id = `doc-${crypto.randomBytes(4).toString('hex')}`;
  const tag = req.body.tag || 'HR';
  const displayName = req.body.name || file.originalname;
  const storage_path = relPath(file.path);

  // Determine version: count existing docs with same display name.
  const sameName = db.prepare('SELECT COUNT(*) AS c FROM documents WHERE employee_id = ? AND name = ?')
    .get(employeeId, displayName);
  const version = sameName.c + 1;

  db.prepare(`INSERT INTO documents (id, employee_id, name, tag, storage_path, size, mime, version, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
    id, employeeId, displayName, tag, storage_path, file.size, file.mimetype, version,
  );
  db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'document', ?, ?)`)
    .run(employeeId, `${displayName} uploaded`, tag);
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
});

router.patch('/:id', requirePermission('documents:upload'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name','tag'];
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (Object.keys(updates).length === 0) return res.json(doc);
  const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE documents SET ${sets} WHERE id = @id`).run({ ...updates, id: doc.id });
  res.json(db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id));
});

router.get('/:id/file', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const abs = absFromStorage(doc.storage_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
  if (doc.mime) res.setHeader('Content-Type', doc.mime);
  fs.createReadStream(abs).pipe(res);
});

router.delete('/:id', requirePermission('documents:delete'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const abs = absFromStorage(doc.storage_path);
  try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  res.status(204).end();
});

export default router;
