import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db.js';
import config from '../config.js';
import { calcPayslip, ytdForEmployee } from '../services/payroll.js';
import { generatePayslipPDF } from '../services/pdf.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();

function getCompany() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'company'`).get();
  return row ? JSON.parse(row.value) : null;
}

function getRules() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'payroll_rules'`).get();
  return row ? JSON.parse(row.value) : { overtimeMultiplier: 1.5, holidayMultiplier: 2, uifRate: 0.01 };
}

// All payslips (joined with employee for list view).
//
// Historical payslips are FINANCIAL RECORDS — once generated, they should
// always show up in the Payslips section regardless of the employee's
// current status. The PayslipBuilder still scopes its employee picker to
// active employees (handled client-side), so you can't *generate* new
// payslips for inactive people, but the records you've already issued
// remain visible. `employee_status` is surfaced so the UI can show an
// "Inactive" badge alongside the name.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, e.first_name, e.last_name, e.employee_no, e.position,
           e.status AS employee_status
    FROM payslips p
    JOIN employees e ON e.id = p.employee_id
    ORDER BY p.pay_date DESC`).all();
  res.json(rows);
});

// Preview calculation (no persistence) — used by builder live preview.
router.post('/preview', (req, res) => {
  const { employeeId, periodStart, periodEnd, commission, bonus, otherEarnings, paye, otherDeductions } = req.body || {};
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const att = db.prepare(`SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
    .all(employeeId, periodStart, periodEnd);
  const rules = getRules();
  const calc = calcPayslip({
    hourlyWage: emp.hourly_wage,
    attendance: att,
    commission: Number(commission) || 0,
    bonus: Number(bonus) || 0,
    otherEarnings: Number(otherEarnings) || 0,
    paye: Number(paye) || 0,
    otherDeductions: Number(otherDeductions) || 0,
    uifRate: rules.uifRate,
    overtimeMultiplier: rules.overtimeMultiplier,
    holidayMultiplier: rules.holidayMultiplier,
  });
  const priorSlips = db.prepare('SELECT * FROM payslips WHERE employee_id = ? AND pay_date < ? ORDER BY pay_date').all(employeeId, periodEnd);
  const ytd = ytdForEmployee(emp, [...priorSlips, {
    gross: calc.gross, uif: calc.uif,
    normal_pay: calc.earnings.normalPay,
    overtime_pay: calc.earnings.overtimePay,
    holiday_pay: calc.earnings.holidayPay,
    sick_pay: calc.earnings.sickPay,
    commission: calc.earnings.commission,
    bonus: calc.earnings.bonus,
  }]);
  res.json({ calc, ytd, attendance: att });
});

// Generate + persist a payslip with PDF
router.post('/', requirePermission('payslips:create'), async (req, res) => {
  try {
    const b = req.body || {};
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(b.employeeId);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const att = db.prepare(`SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
      .all(b.employeeId, b.periodStart, b.periodEnd);
    const rules = getRules();
    const calc = calcPayslip({
      hourlyWage: emp.hourly_wage,
      attendance: att,
      commission: Number(b.commission) || 0,
      bonus: Number(b.bonus) || 0,
      otherEarnings: Number(b.otherEarnings) || 0,
      paye: Number(b.paye) || 0,
      otherDeductions: Number(b.otherDeductions) || 0,
      uifRate: rules.uifRate,
      overtimeMultiplier: rules.overtimeMultiplier,
      holidayMultiplier: rules.holidayMultiplier,
    });

    const id = b.id || `ps-${Date.now()}`;
    const row = {
      id,
      employee_id: emp.id,
      period_label: b.periodLabel || b.period_label || '—',
      period_start: b.periodStart,
      period_end: b.periodEnd,
      pay_date: b.payDate || b.pay_date || new Date().toISOString().slice(0, 10),
      normal_hours: calc.hours.normal,
      overtime_hours: calc.hours.overtime,
      holiday_hours: calc.hours.holiday,
      public_holiday_hours: calc.hours.publicHoliday,
      sick_hours: calc.hours.sick,
      leave_hours: calc.hours.leave,
      normal_pay: calc.earnings.normalPay,
      overtime_pay: calc.earnings.overtimePay,
      holiday_pay: calc.earnings.holidayPay,
      public_holiday_pay: calc.earnings.publicHolidayPay,
      sick_pay: calc.earnings.sickPay,
      commission: calc.earnings.commission,
      bonus: calc.earnings.bonus,
      other_earnings: calc.earnings.other,
      hourly_wage: emp.hourly_wage,
      gross: calc.gross,
      uif: calc.deductions.uif,
      paye: calc.deductions.paye,
      other_deductions: calc.deductions.other,
      net: calc.net,
      pdf_path: null,
    };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO payslips (${cols.join(',')}) VALUES (${cols.map(c => '@'+c).join(',')})`).run(row);

    // Build PDF (with YTD computed from this and earlier slips).
    const allSlips = db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY pay_date ASC').all(emp.id);
    const priorAndSelf = allSlips.filter(s => s.pay_date <= row.pay_date);
    const pdfPath = path.join(config.payslipsDir, `${id}.pdf`);
    await generatePayslipPDF({
      outPath: pdfPath,
      employee: emp,
      payslip: row,
      priorSlips: priorAndSelf,
      company: getCompany(),
    });
    db.prepare('UPDATE payslips SET pdf_path = ? WHERE id = ?').run(path.relative(config.dataDir, pdfPath), id);
    db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'payslip', ?, ?)`)
      .run(emp.id, `${row.period_label} payslip generated`, id);
    res.status(201).json(db.prepare('SELECT * FROM payslips WHERE id = ?').get(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT p.*, e.first_name, e.last_name, e.employee_no, e.position
    FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.get('/:id/pdf', async (req, res) => {
  const ps = db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  let abs = ps.pdf_path ? path.join(config.dataDir, ps.pdf_path) : null;

  // Regenerate if missing.
  if (!abs || !fs.existsSync(abs)) {
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(ps.employee_id);
    const allSlips = db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY pay_date ASC').all(ps.employee_id);
    abs = path.join(config.payslipsDir, `${ps.id}.pdf`);
    await generatePayslipPDF({
      outPath: abs,
      employee: emp,
      payslip: ps,
      priorSlips: allSlips.filter(s => s.pay_date <= ps.pay_date),
      company: getCompany(),
    });
    db.prepare('UPDATE payslips SET pdf_path = ? WHERE id = ?').run(path.relative(config.dataDir, abs), ps.id);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="payslip-${ps.id}.pdf"`);
  fs.createReadStream(abs).pipe(res);
});

router.delete('/:id', requirePermission('payslips:delete'), (req, res) => {
  const ps = db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (ps.pdf_path) {
    const abs = path.join(config.dataDir, ps.pdf_path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  db.prepare('DELETE FROM payslips WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
