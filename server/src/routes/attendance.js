import express from 'express';
import db from '../db.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();

// All attendance for an employee (optionally bounded by date range).
router.get('/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  const { from, to } = req.query;
  let sql = 'SELECT * FROM attendance WHERE employee_id = ?';
  const params = [employeeId];
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to)   { sql += ' AND date <= ?'; params.push(to); }
  sql += ' ORDER BY date ASC';
  res.json(db.prepare(sql).all(...params));
});

// Upsert a single day.
router.put('/:employeeId/:date', requirePermission('attendance:edit'), (req, res) => {
  const { employeeId, date } = req.params;
  const b = req.body || {};
  const row = {
    employee_id: employeeId,
    date,
    type: b.type || 'normal',
    start_time: b.start_time ?? b.start ?? null,
    end_time: b.end_time ?? b.end ?? null,
    break_min: Number(b.break_min ?? b.breakMin ?? 0),
    hours: Number(b.hours ?? 0),
    overtime: Number(b.overtime ?? 0),
    note: b.note ?? null,
  };
  db.prepare(`INSERT INTO attendance (employee_id, date, type, start_time, end_time, break_min, hours, overtime, note)
    VALUES (@employee_id, @date, @type, @start_time, @end_time, @break_min, @hours, @overtime, @note)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      type = excluded.type,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      break_min = excluded.break_min,
      hours = excluded.hours,
      overtime = excluded.overtime,
      note = excluded.note,
      updated_at = datetime('now')`).run(row);
  const saved = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employeeId, date);
  res.json(saved);
});

// Bulk replace within a date range.
router.post('/:employeeId/bulk', requirePermission('attendance:edit'), (req, res) => {
  const { employeeId } = req.params;
  const entries = req.body?.entries || [];
  const range = req.body?.range || null;
  const tx = db.transaction(() => {
    if (range?.from && range?.to) {
      db.prepare('DELETE FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?')
        .run(employeeId, range.from, range.to);
    }
    const stmt = db.prepare(`INSERT OR REPLACE INTO attendance
      (employee_id, date, type, start_time, end_time, break_min, hours, overtime, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of entries) {
      stmt.run(
        employeeId, e.date, e.type || 'normal',
        e.start_time ?? e.start ?? null,
        e.end_time ?? e.end ?? null,
        Number(e.break_min ?? e.breakMin ?? 0),
        Number(e.hours ?? 0),
        Number(e.overtime ?? 0),
        e.note ?? null,
      );
    }
  });
  tx();
  res.json({ ok: true, count: entries.length });
});

router.delete('/:employeeId/:date', requirePermission('attendance:edit'), (req, res) => {
  const r = db.prepare('DELETE FROM attendance WHERE employee_id = ? AND date = ?')
    .run(req.params.employeeId, req.params.date);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
