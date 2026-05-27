import express from 'express';
import db from '../db.js';
import { payPeriodFor, previousPayPeriodFor, calendarMonthFor, daysBetween } from '../services/periods.js';

const router = express.Router();

router.get('/', (req, res) => {
  // Inactive/archived employees and their data are scoped to the Employees
  // menu only. Every dashboard surface joins through `employees.status =
  // 'active'` so totals, trend lines and recent lists reflect only the
  // current workforce.
  const allEmployees = db.prepare('SELECT * FROM employees').all();
  const employees = allEmployees.filter(e => e.status === 'active');
  const allSlips = db.prepare(`SELECT p.*, e.first_name, e.last_name, e.position FROM payslips p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.status = 'active'
    ORDER BY p.pay_date DESC`).all();
  const recentDocs = db.prepare(`SELECT d.*, e.first_name, e.last_name FROM documents d
    JOIN employees e ON e.id = d.employee_id
    WHERE e.status = 'active'
    ORDER BY d.uploaded_at DESC LIMIT 8`).all();
  const activity = db.prepare(`SELECT a.*, e.first_name, e.last_name FROM activity a
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE e.id IS NULL OR e.status = 'active'
    ORDER BY a.created_at DESC LIMIT 12`).all();

  let totalYTD = 0, currentPeriod = 0;
  const activeCount = employees.length;
  const ytdByEmployee = {};
  for (const e of employees) {
    const empSlips = allSlips.filter(s => s.employee_id === e.id);
    const ytdSlips = empSlips.reduce((a, p) => a + (p.gross || 0), 0);
    const ytd = (e.initial_ytd || 0) + ytdSlips;
    totalYTD += ytd;
    ytdByEmployee[e.id] = ytd;
    if (empSlips[0]) currentPeriod += empSlips[0].gross;
  }

  // Monthly trend for last 8 months from pay_date.
  const months = [];
  const today = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      value: 0,
    });
  }
  for (const p of allSlips) {
    const key = (p.pay_date || '').slice(0, 7);
    const m = months.find(x => x.key === key);
    if (m) m.value += p.gross;
  }

  // Period totals (current month, active employees only)
  const curKey = months[months.length - 1].key;
  const periodAtt = db.prepare(`SELECT a.* FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE substr(a.date, 1, 7) = ? AND e.status = 'active'`).all(curKey);
  const hoursBreakdown = { normal: 0, overtime: 0, holiday: 0, publicHoliday: 0, sick: 0, leave: 0 };
  for (const a of periodAtt) {
    if (a.type === 'normal') {
      hoursBreakdown.normal += a.hours || 0;
      hoursBreakdown.overtime += a.overtime || 0;
    } else if (a.type === 'sunday' || a.type === 'holiday' || a.type === 'holiday_worked') {
      hoursBreakdown.holiday += a.hours || 0;
    } else if (a.type === 'holiday_paid' || a.type === 'public_holiday') {
      hoursBreakdown.publicHoliday += a.hours || 0;
    } else if (a.type === 'sick') {
      hoursBreakdown.sick += a.hours || 0;
    } else if (a.type === 'annual' || a.type === 'unpaid') {
      hoursBreakdown.leave += a.hours || 0;
    }
  }

  // Anniversaries within 60 days
  const anniv = employees.map(e => {
    const d = new Date(e.date_employed);
    if (isNaN(d)) return null;
    const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next.setFullYear(next.getFullYear() + 1);
    const daysAway = Math.round((next - today) / 86400000);
    return {
      employee_id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      date_employed: e.date_employed,
      next: next.toISOString().slice(0, 10),
      yearsAtCompany: next.getFullYear() - d.getFullYear(),
      daysAway,
    };
  }).filter(Boolean).sort((a, b) => a.daysAway - b.daysAway);

  res.json({
    stats: { activeCount, totalCount: allEmployees.length, totalYTD, currentPeriod },
    months,
    hoursBreakdown,
    recentPayslips: allSlips.slice(0, 6),
    recentDocs,
    activity,
    anniversaries: anniv,
    ytdByEmployee,
  });
});

// Filterable hours breakdown + daily trend.
//   ?employeeId=all|<id>   (default: all)
//   ?preset=current|last|month  (resolves the period for you)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (custom range — overrides preset)
//   ?label=…  (echoed back so the client can label the chart)
router.get('/hours-breakdown', (req, res) => {
  let { employeeId, preset, from, to, label } = req.query;
  let periodInfo;
  if (from && to) {
    periodInfo = { startISO: String(from), endISO: String(to), label: label || `${from} → ${to}` };
  } else if (preset === 'last') {
    periodInfo = previousPayPeriodFor(new Date());
  } else if (preset === 'month') {
    periodInfo = calendarMonthFor(new Date());
  } else {
    periodInfo = payPeriodFor(new Date());
  }

  // Filter through employees → status so inactive/archived employees never
  // appear in the dashboard breakdown, even under employeeId=all.
  let sql = `SELECT a.* FROM attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.date BETWEEN ? AND ?`;
  const params = [periodInfo.startISO, periodInfo.endISO];
  if (employeeId && employeeId !== 'all') {
    sql += ' AND a.employee_id = ?';
    params.push(employeeId);
  } else {
    sql += ` AND e.status = 'active'`;
  }
  sql += ' ORDER BY a.date';
  const rows = db.prepare(sql).all(...params);

  const buckets = { normal: 0, overtime: 0, holiday: 0, publicHoliday: 0, sick: 0, leave: 0 };
  const byDate = new Map();
  for (const a of rows) {
    const h = Number(a.hours) || 0;
    const ot = Number(a.overtime) || 0;
    if (!byDate.has(a.date)) byDate.set(a.date, { date: a.date, normal: 0, overtime: 0, holiday: 0, publicHoliday: 0, sick: 0, leave: 0, total: 0 });
    const day = byDate.get(a.date);

    if (a.type === 'normal') {
      buckets.normal += h; buckets.overtime += ot;
      day.normal += h;     day.overtime += ot;
    } else if (a.type === 'sunday' || a.type === 'holiday' || a.type === 'holiday_worked') {
      buckets.holiday += h;
      day.holiday += h;
    } else if (a.type === 'holiday_paid' || a.type === 'public_holiday') {
      buckets.publicHoliday += h;
      day.publicHoliday += h;
    } else if (a.type === 'sick') {
      buckets.sick += h;
      day.sick += h;
    } else if (a.type === 'annual' || a.type === 'unpaid') {
      buckets.leave += h;
      day.leave += h;
    }
    day.total = day.normal + day.overtime + day.holiday + day.publicHoliday + day.sick + day.leave;
  }

  // Fill in every day in the period so the trend chart has continuous bars.
  const dailyTrend = daysBetween(periodInfo.startISO, periodInfo.endISO).map(date =>
    byDate.get(date) || { date, normal: 0, overtime: 0, holiday: 0, publicHoliday: 0, sick: 0, leave: 0, total: 0 }
  );

  res.json({
    period: periodInfo,
    employeeId: employeeId || 'all',
    hoursBreakdown: {
      normal: round1(buckets.normal),
      overtime: round1(buckets.overtime),
      holiday: round1(buckets.holiday),
      publicHoliday: round1(buckets.publicHoliday),
      sick: round1(buckets.sick),
      leave: round1(buckets.leave),
      total: round1(buckets.normal + buckets.overtime + buckets.holiday + buckets.publicHoliday + buckets.sick + buckets.leave),
    },
    dailyTrend,
  });
});

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Global search
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  // Search results scope to active employees only — inactive/archived
  // profiles, their documents and payslips are hidden everywhere except
  // inside the Employees menu itself.
  const emps = db.prepare(`SELECT * FROM employees
    WHERE status = 'active'
      AND (lower(first_name||' '||last_name) LIKE ? OR lower(position) LIKE ? OR lower(email) LIKE ? OR employee_no LIKE ?)`)
    .all(like, like, like, like).map(e => ({
      kind: 'Employee', label: `${e.first_name} ${e.last_name}`, sub: e.position,
      go: `#/employees/${e.id}`,
    }));
  const docs = db.prepare(`SELECT d.*, e.first_name, e.last_name FROM documents d
    JOIN employees e ON e.id = d.employee_id
    WHERE e.status = 'active' AND (lower(d.name) LIKE ? OR lower(d.tag) LIKE ?)`).all(like, like).map(d => ({
      kind: 'Document', label: d.name, sub: `${d.first_name} ${d.last_name} · ${d.tag}`,
      go: `#/employees/${d.employee_id}/documents`,
    }));
  const slips = db.prepare(`SELECT p.*, e.first_name, e.last_name FROM payslips p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.status = 'active' AND (lower(p.period_label) LIKE ? OR lower(e.first_name||' '||e.last_name) LIKE ?)`).all(like, like).map(p => ({
      kind: 'Payslip', label: p.period_label, sub: `${p.first_name} ${p.last_name} · R${p.gross.toFixed(2)}`,
      go: `#/payslips/view/${p.employee_id}/${p.id}`,
    }));
  res.json([...emps, ...docs, ...slips].slice(0, 24));
});

export default router;
