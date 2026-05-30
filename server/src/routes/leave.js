import express from 'express';
import db from '../db.js';
import { requirePermission } from '../services/auth.js';
import {
  LEAVE_TYPES, ATTENDANCE_WRITING_TYPES,
  getEntitlements, classifyRange,
  writeAttendanceForLeave, rollbackAttendanceForLeave,
  computeBalancesFor, serialiseBalances,
} from '../services/leave.js';

const router = express.Router();

function getRequest(id) {
  return db.prepare(`SELECT lr.*, e.first_name, e.last_name, e.employee_no, e.status AS employee_status,
                            u.name AS decided_by_name
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    LEFT JOIN users u ON u.id = lr.decided_by
    WHERE lr.id = ?`).get(id);
}

// ===== Reference data =====
router.get('/types', (req, res) => res.json(LEAVE_TYPES));
router.get('/entitlements', (req, res) => res.json(getEntitlements()));

// ===== List =====
router.get('/', (req, res) => {
  const { status, employeeId, type, from, to } = req.query;
  let sql = `SELECT lr.*, e.first_name, e.last_name, e.employee_no, e.status AS employee_status,
                    u.name AS decided_by_name
             FROM leave_requests lr
             JOIN employees e ON e.id = lr.employee_id
             LEFT JOIN users u ON u.id = lr.decided_by`;
  const where = [], params = {};
  if (status)     { where.push('lr.status = @status');           params.status = status; }
  if (employeeId) { where.push('lr.employee_id = @employeeId');  params.employeeId = employeeId; }
  if (type)       { where.push('lr.leave_type = @type');         params.type = type; }
  if (from)       { where.push('lr.end_date >= @from');          params.from = from; }
  if (to)         { where.push('lr.start_date <= @to');          params.to = to; }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY
    CASE lr.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
    lr.start_date DESC`;
  res.json(db.prepare(sql).all(params));
});

router.get('/balances', (req, res) => {
  const status = req.query.employeeStatus || 'active';
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM employees ORDER BY first_name, last_name').all()
    : db.prepare(`SELECT * FROM employees WHERE status = ? ORDER BY first_name, last_name`).all(status);
  res.json(rows.map(e => ({
    employee: { id: e.id, first_name: e.first_name, last_name: e.last_name, status: e.status, date_employed: e.date_employed },
    balances: serialiseBalances(computeBalancesFor(e)),
  })));
});

router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = today.slice(0, 8) + '01';

  const onLeaveToday = db.prepare(`SELECT lr.*, e.first_name, e.last_name
    FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
    WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
    ORDER BY e.first_name`).all(today, today);

  const approvedThisMonth = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(days_count),0) AS d
    FROM leave_requests WHERE status = 'approved' AND start_date >= ?`).get(startOfMonth);

  const pendingCount = db.prepare(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'`).get().n;

  // Leaves by type (year-to-date)
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const byTypeRows = db.prepare(`SELECT leave_type, COALESCE(SUM(days_count),0) AS d, COUNT(*) AS n
    FROM leave_requests
    WHERE status = 'approved' AND start_date >= ?
    GROUP BY leave_type`).all(yearStart);
  const byType = Object.fromEntries(LEAVE_TYPES.map(t => [t, { days: 0, count: 0 }]));
  for (const r of byTypeRows) {
    if (byType[r.leave_type]) {
      byType[r.leave_type].days = Number(r.d);
      byType[r.leave_type].count = Number(r.n);
    }
  }

  const recent = db.prepare(`SELECT lr.*, e.first_name, e.last_name, u.name AS decided_by_name
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    LEFT JOIN users u ON u.id = lr.decided_by
    WHERE lr.status IN ('approved','rejected')
    ORDER BY COALESCE(lr.decided_at, lr.created_at) DESC LIMIT 8`).all();

  res.json({
    onLeaveToday,
    stats: {
      approvedThisMonth: { count: Number(approvedThisMonth.n), days: Number(approvedThisMonth.d) },
      pendingCount,
      annualUsedYTD: byType.annual.days,
      annualAllowedTotal: db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE status='active'`).get().n
                          * (getEntitlements().annual_days || 15),
    },
    byType,
    recent,
  });
});

router.get('/:id', (req, res) => {
  const row = getRequest(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Preview the "what happens on approval" classification without saving.
router.post('/preview', requirePermission('leave:create'), (req, res) => {
  const { employeeId, startDate, endDate } = req.body || {};
  if (!employeeId || !startDate || !endDate) {
    return res.status(400).json({ error: 'employeeId, startDate, endDate are required' });
  }
  if (endDate < startDate) {
    return res.status(400).json({ error: 'endDate must be on or after startDate' });
  }
  const cls = classifyRange(employeeId, startDate, endDate);
  res.json({
    applicable: cls.applicable,
    skipped: cls.skipped,
    daysApplied: cls.applicable.length,
    daysRequested: cls.applicable.length + cls.skipped.sundays.length + cls.skipped.holidays.length + cls.skipped.worked.length,
  });
});

// ===== Create =====
router.post('/', requirePermission('leave:create'), (req, res) => {
  const b = req.body || {};
  if (!b.employeeId || !b.leaveType || !b.startDate || !b.endDate) {
    return res.status(400).json({ error: 'employeeId, leaveType, startDate, endDate are required' });
  }
  if (!LEAVE_TYPES.includes(b.leaveType)) return res.status(400).json({ error: 'Invalid leaveType' });
  if (b.endDate < b.startDate) return res.status(400).json({ error: 'endDate must be on or after startDate' });
  if (b.leaveType === 'family' && !b.subReason) {
    return res.status(400).json({ error: 'Family responsibility leave requires a sub_reason' });
  }

  const requestedStatus = (b.status === 'approved' || b.status === 'rejected') ? b.status : 'pending';
  if (requestedStatus !== 'pending' && !req.user?.is_owner && !req.user?.permissions?.['leave:decide']) {
    return res.status(403).json({ error: 'You do not have permission to decide leave at creation; save as pending instead.' });
  }

  // Initial days_requested = calendar days; days_count finalised at approval.
  const start = new Date(b.startDate + 'T00:00:00Z'), end = new Date(b.endDate + 'T00:00:00Z');
  const daysRequested = Math.round((end - start) / 86400000) + 1;

  const info = db.prepare(`INSERT INTO leave_requests
    (employee_id, leave_type, sub_reason, start_date, end_date, days_requested, days_count, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
    b.employeeId, b.leaveType, b.subReason ?? null,
    b.startDate, b.endDate, daysRequested,
    b.reason ?? null, requestedStatus,
  );
  const id = info.lastInsertRowid;

  // If created already in a decided state, apply the side effects now.
  if (requestedStatus === 'approved') applyApproval(id, req.user);
  if (requestedStatus === 'rejected') applyRejection(id, req.user);

  db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'leave', ?, ?)`)
    .run(b.employeeId, `Leave request created (${b.leaveType})`, `${b.startDate} → ${b.endDate}`);

  res.status(201).json(getRequest(id));
});

// ===== Update / change status =====
router.patch('/:id', requirePermission('leave:create'), (req, res) => {
  const cur = getRequest(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};

  const editable = {};
  for (const k of ['leave_type', 'sub_reason', 'start_date', 'end_date', 'reason']) {
    if (k in b) editable[k] = b[k];
  }
  // Reject editing decided requests' fields unless explicitly bringing it back to pending.
  if (cur.status !== 'pending' && Object.keys(editable).length && b.status !== 'pending') {
    return res.status(400).json({ error: 'Move the request back to pending before editing its details.' });
  }
  if (Object.keys(editable).length) {
    const sets = Object.keys(editable).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE leave_requests SET ${sets} WHERE id = @id`).run({ ...editable, id: cur.id });
  }

  // Status transition
  if (b.status && b.status !== cur.status) {
    if (!['pending', 'approved', 'rejected'].includes(b.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (b.status !== 'pending' && !req.user?.is_owner && !req.user?.permissions?.['leave:decide']) {
      return res.status(403).json({ error: 'You do not have permission to approve or reject leave.' });
    }
    if (b.status === 'approved') applyApproval(cur.id, req.user);
    else if (b.status === 'rejected') applyRejection(cur.id, req.user);
    else if (b.status === 'pending') {
      // Reverting a decision: roll back any attendance writes.
      rollbackAttendanceForLeave(cur.id);
      db.prepare(`UPDATE leave_requests SET status='pending', decided_by=NULL, decided_at=NULL WHERE id=?`).run(cur.id);
    }
  }
  res.json(getRequest(cur.id));
});

router.delete('/:id', requirePermission('leave:create'), (req, res) => {
  const cur = getRequest(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  rollbackAttendanceForLeave(cur.id);
  db.prepare('DELETE FROM leave_requests WHERE id = ?').run(cur.id);
  res.status(204).end();
});

// ===== Internal helpers =====

function applyApproval(id, user) {
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!row) return;
  // Stamp the decision first so writeAttendanceForLeave can set days_count.
  db.prepare(`UPDATE leave_requests
    SET status='approved', decided_by=?, decided_at=datetime('now')
    WHERE id = ?`).run(user?.user_id || null, id);
  writeAttendanceForLeave(db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id));
  db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'leave', ?, ?)`)
    .run(row.employee_id, `Leave approved (${row.leave_type})`, `${row.start_date} → ${row.end_date}`);
}

function applyRejection(id, user) {
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!row) return;
  rollbackAttendanceForLeave(id);
  db.prepare(`UPDATE leave_requests
    SET status='rejected', decided_by=?, decided_at=datetime('now'), days_count=0
    WHERE id = ?`).run(user?.user_id || null, id);
  db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'leave', ?, ?)`)
    .run(row.employee_id, `Leave rejected (${row.leave_type})`, `${row.start_date} → ${row.end_date}`);
}

export default router;
