import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (req, res) => {
  const employees = db.prepare('SELECT * FROM employees').all();
  const allSlips = db.prepare(`SELECT p.*, e.first_name, e.last_name, e.position FROM payslips p
    JOIN employees e ON e.id = p.employee_id ORDER BY p.pay_date DESC`).all();
  const recentDocs = db.prepare(`SELECT d.*, e.first_name, e.last_name FROM documents d
    JOIN employees e ON e.id = d.employee_id ORDER BY d.uploaded_at DESC LIMIT 8`).all();
  const activity = db.prepare(`SELECT a.*, e.first_name, e.last_name FROM activity a
    LEFT JOIN employees e ON e.id = a.employee_id ORDER BY a.created_at DESC LIMIT 12`).all();

  let totalYTD = 0, currentPeriod = 0, activeCount = 0;
  const ytdByEmployee = {};
  for (const e of employees) {
    if (e.status === 'active') activeCount++;
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

  // Period totals (current month)
  const curKey = months[months.length - 1].key;
  const periodAtt = db.prepare(`SELECT * FROM attendance WHERE substr(date, 1, 7) = ?`).all(curKey);
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
    stats: { activeCount, totalCount: employees.length, totalYTD, currentPeriod },
    months,
    hoursBreakdown,
    recentPayslips: allSlips.slice(0, 6),
    recentDocs,
    activity,
    anniversaries: anniv,
    ytdByEmployee,
  });
});

// Global search
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const emps = db.prepare(`SELECT * FROM employees
    WHERE lower(first_name||' '||last_name) LIKE ? OR lower(position) LIKE ? OR lower(email) LIKE ? OR employee_no LIKE ?`)
    .all(like, like, like, like).map(e => ({
      kind: 'Employee', label: `${e.first_name} ${e.last_name}`, sub: e.position,
      go: `#/employees/${e.id}`,
    }));
  const docs = db.prepare(`SELECT d.*, e.first_name, e.last_name FROM documents d
    JOIN employees e ON e.id = d.employee_id
    WHERE lower(d.name) LIKE ? OR lower(d.tag) LIKE ?`).all(like, like).map(d => ({
      kind: 'Document', label: d.name, sub: `${d.first_name} ${d.last_name} · ${d.tag}`,
      go: `#/employees/${d.employee_id}/documents`,
    }));
  const slips = db.prepare(`SELECT p.*, e.first_name, e.last_name FROM payslips p
    JOIN employees e ON e.id = p.employee_id
    WHERE lower(p.period_label) LIKE ? OR lower(e.first_name||' '||e.last_name) LIKE ?`).all(like, like).map(p => ({
      kind: 'Payslip', label: p.period_label, sub: `${p.first_name} ${p.last_name} · R${p.gross.toFixed(2)}`,
      go: `#/payslips/view/${p.employee_id}/${p.id}`,
    }));
  res.json([...emps, ...docs, ...slips].slice(0, 24));
});

export default router;
