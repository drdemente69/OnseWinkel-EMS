import express from 'express';
import { PassThrough } from 'node:stream';
import db from '../db.js';
import { requirePermission } from '../services/auth.js';
import { generateAttendancePDF } from '../services/attendance-pdf.js';
import { payPeriodFor, previousPayPeriodFor, calendarMonthFor, daysBetween } from '../services/periods.js';

const router = express.Router();

function getCompany() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'company'`).get();
  return row ? JSON.parse(row.value) : null;
}

function resolveAttendancePeriod({ preset, from, to, label }) {
  if (from && to) return { startISO: String(from), endISO: String(to), label: label || `${from} → ${to}` };
  if (preset === 'last')  return previousPayPeriodFor(new Date());
  if (preset === 'month') return calendarMonthFor(new Date());
  return payPeriodFor(new Date());
}

// Build one row per day in the period: real entry if present in DB, otherwise
// a "blank" placeholder so the PDF shows every weekday even when nothing was
// logged for it.
function rowsForEmployee(employee, periodInfo) {
  const real = db.prepare(`SELECT * FROM attendance
    WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
    .all(employee.id, periodInfo.startISO, periodInfo.endISO);
  const byDate = new Map(real.map(r => [r.date, { ...r, hasEntry: true }]));
  return daysBetween(periodInfo.startISO, periodInfo.endISO).map(date =>
    byDate.get(date) || {
      date, type: '', start_time: null, end_time: null,
      break_min: 0, hours: 0, overtime: 0, hasEntry: false,
    },
  );
}

// All attendance for an employee (optionally bounded by date range).
// Attendance PDF — must be declared BEFORE the /:employeeId route so the
// `pdf` segment isn't swallowed as an employee id.
//
//   /api/attendance/pdf?employeeId=all|<id>
//                      &preset=current|last|month  (optional)
//                      &from=YYYY-MM-DD&to=YYYY-MM-DD  (overrides preset)
//                      &label=…
router.get('/pdf', async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || 'all');
    const periodInfo = resolveAttendancePeriod(req.query);

    // employeeId=all → only active employees end up in the combined PDF.
    // Inactive/archived attendance is still reachable by passing a specific
    // employee id (e.g. from the Employees menu).
    const employees = employeeId === 'all'
      ? db.prepare(`SELECT * FROM employees WHERE status = 'active' ORDER BY first_name, last_name`).all()
      : [db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId)].filter(Boolean);
    if (employees.length === 0) {
      return res.status(404).json({ error: 'No employees match the request' });
    }
    const entries = employees.map(e => ({ employee: e, rows: rowsForEmployee(e, periodInfo) }));

    const filename = `attendance-${periodInfo.startISO}_${periodInfo.endISO}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    await generateAttendancePDF({
      outStream: res,
      company: getCompany(),
      period: periodInfo,
      entries,
    });
  } catch (e) {
    console.error('[attendance/pdf]', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

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

// Upsert a single day. Accepts the new lunch_start / lunch_end pair alongside
// break_min — they're stored together so the UI can show "lunch from 12:00 to
// 13:00" instead of only the raw minute count.
router.put('/:employeeId/:date', requirePermission('attendance:edit'), (req, res) => {
  const { employeeId, date } = req.params;
  const b = req.body || {};
  const row = {
    employee_id: employeeId,
    date,
    type: b.type || 'normal',
    start_time: b.start_time ?? b.start ?? null,
    end_time:   b.end_time   ?? b.end   ?? null,
    break_min:  Number(b.break_min ?? b.breakMin ?? 0),
    lunch_start: b.lunch_start ?? b.lunchStart ?? null,
    lunch_end:   b.lunch_end   ?? b.lunchEnd   ?? null,
    hours:    Number(b.hours    ?? 0),
    overtime: Number(b.overtime ?? 0),
    note: b.note ?? null,
  };
  db.prepare(`INSERT INTO attendance (
      employee_id, date, type, start_time, end_time, break_min,
      lunch_start, lunch_end, hours, overtime, note)
    VALUES (
      @employee_id, @date, @type, @start_time, @end_time, @break_min,
      @lunch_start, @lunch_end, @hours, @overtime, @note)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      type        = excluded.type,
      start_time  = excluded.start_time,
      end_time    = excluded.end_time,
      break_min   = excluded.break_min,
      lunch_start = excluded.lunch_start,
      lunch_end   = excluded.lunch_end,
      hours       = excluded.hours,
      overtime    = excluded.overtime,
      note        = excluded.note,
      updated_at  = datetime('now')`).run(row);

  // Reverse sync: if the operator marked this day as a leave type without
  // going through Leave Approval, create a pending request so the owner can
  // review it. Approving it later keeps the attendance row; rejecting rolls
  // it back. We skip when the row was already written by Leave Approval
  // (note already begins with "Leave#") to avoid duplicates.
  reverseSyncLeaveRequest(employeeId, date, row);

  const saved = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employeeId, date);
  res.json(saved);
});

// Inspect a freshly-saved attendance row and, if it's a leave-typed entry
// that isn't already tied to a leave request, file a pending leave_request
// for the owner to review.
function reverseSyncLeaveRequest(employeeId, date, row) {
  const reverseMap = {
    annual: 'annual',
    sick: 'sick',
    unpaid: 'unpaid',
  };
  const targetLeaveType = reverseMap[row.type];
  if (!targetLeaveType) return;
  if (row.note && row.note.startsWith('Leave#')) return;     // already linked

  // Is there already a leave_request covering this date for this employee?
  const existing = db.prepare(`SELECT id FROM leave_requests
    WHERE employee_id = ?
      AND status != 'rejected'
      AND start_date <= ? AND end_date >= ?`).get(employeeId, date, date);
  if (existing) return;                                       // nothing to do

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO leave_requests
      (employee_id, leave_type, start_date, end_date, days_requested, days_count,
       status, reason, attendance_written)
      VALUES (?, ?, ?, ?, 1, 1, 'pending', ?, 1)`)
      .run(employeeId, targetLeaveType, date, date,
           `Auto-created from attendance entry on ${date} — please confirm.`);
    const id = info.lastInsertRowid;
    // Tag the attendance row so the leave's rollback can find it later.
    db.prepare(`UPDATE attendance SET note = ? WHERE employee_id = ? AND date = ?`)
      .run(`Leave#${id}: ${targetLeaveType} (auto · pending review)`, employeeId, date);
    db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'leave', ?, ?)`)
      .run(employeeId, `Leave entry needs review (${targetLeaveType})`, date);
  });
  tx();
}

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
      (employee_id, date, type, start_time, end_time, break_min,
       lunch_start, lunch_end, hours, overtime, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of entries) {
      stmt.run(
        employeeId, e.date, e.type || 'normal',
        e.start_time ?? e.start ?? null,
        e.end_time   ?? e.end   ?? null,
        Number(e.break_min ?? e.breakMin ?? 0),
        e.lunch_start ?? e.lunchStart ?? null,
        e.lunch_end   ?? e.lunchEnd   ?? null,
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
