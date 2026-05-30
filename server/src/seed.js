import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import config from './config.js';
import { generatePayslipPDF } from './services/pdf.js';
import { hashPassword } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Onse Winkel PTY LTD',
  address: 'Valkaan 17, Sanddrift, Alexander Bay, Northern Cape 8290',
  phone: '+27 74 350 0122',
  email: 'onsewinkel22@gmail.com',
  contact: 'Rahat Baig',
  contactPhone: '0743500122',
  logoPath: 'logo.jpg',
};

const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const insertEmp = db.prepare(`INSERT OR REPLACE INTO employees
  (id, employee_no, first_name, last_name, position, department, phone, email, address,
   date_employed, hourly_wage, initial_ytd, status, payment_method, bank, bank_account,
   id_number, tax_code, notes)
  VALUES (@id, @employee_no, @first_name, @last_name, @position, @department, @phone, @email, @address,
          @date_employed, @hourly_wage, @initial_ytd, @status, @payment_method, @bank, @bank_account,
          @id_number, @tax_code, @notes)`);

const insertAtt = db.prepare(`INSERT OR REPLACE INTO attendance
  (employee_id, date, type, start_time, end_time, break_min, hours, overtime, note)
  VALUES (@employee_id, @date, @type, @start_time, @end_time, @break_min, @hours, @overtime, @note)`);

const insertDoc = db.prepare(`INSERT OR REPLACE INTO documents
  (id, employee_id, name, tag, storage_path, size, mime, version, uploaded_at)
  VALUES (@id, @employee_id, @name, @tag, @storage_path, @size, @mime, @version, @uploaded_at)`);

const insertPs = db.prepare(`INSERT OR REPLACE INTO payslips
  (id, employee_id, period_label, period_start, period_end, pay_date,
   normal_hours, overtime_hours, holiday_hours, sick_hours, leave_hours,
   normal_pay, overtime_pay, holiday_pay, sick_pay, commission, bonus, other_earnings,
   hourly_wage, gross, uif, paye, other_deductions, net, pdf_path)
  VALUES (@id, @employee_id, @period_label, @period_start, @period_end, @pay_date,
          @normal_hours, @overtime_hours, @holiday_hours, @sick_hours, @leave_hours,
          @normal_pay, @overtime_pay, @holiday_pay, @sick_pay, @commission, @bonus, @other_earnings,
          @hourly_wage, @gross, @uif, @paye, @other_deductions, @net, @pdf_path)`);

const insertActivity = db.prepare(`INSERT INTO activity (employee_id, kind, title, detail, created_at)
  VALUES (@employee_id, @kind, @title, @detail, @created_at)`);

function buildCedrickAttendance() {
  // Pay cycle: 21st of one month → 20th of the next. Seed two consecutive
  // periods so the calendar has data on either side of the current period.
  // Range covered: 2026-02-21 → 2026-05-20 (89 days).
  const out = [];
  const start = new Date(Date.UTC(2026, 1, 21));   // Feb 21 2026
  const end   = new Date(Date.UTC(2026, 4, 20));   // May 20 2026
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0) {
      out.push({ date: iso, type: 'sunday', start_time: '08:00', end_time: '17:00', break_min: 60, hours: 8, overtime: 0 });
    } else if (dow === 6) {
      out.push({ date: iso, type: 'normal', start_time: '08:00', end_time: '13:00', break_min: 0, hours: 5, overtime: 0 });
    } else {
      out.push({ date: iso, type: 'normal', start_time: '08:00', end_time: '17:00', break_min: 60, hours: 8, overtime: 0 });
    }
  }
  // Public holiday on Good Friday (Apr 3 2026) and overtime on Apr 2.
  const apr3 = out.find(d => d.date === '2026-04-03');
  if (apr3) { apr3.type = 'holiday'; apr3.hours = 8; }
  const apr2 = out.find(d => d.date === '2026-04-02');
  if (apr2) apr2.overtime = 4;
  return out;
}

function placeLogoFromDesign() {
  const candidate = path.resolve(__dirname, '..', '..', '..', 'OnseWinkel-EMS-design', 'logo.jpg');
  const dest = path.join(config.dataDir, 'logo.jpg');
  if (fs.existsSync(candidate) && !fs.existsSync(dest)) {
    fs.copyFileSync(candidate, dest);
  }
  const fallback = path.resolve('/tmp/onse_design/uploads/logo-1778884641784.jpg');
  if (!fs.existsSync(dest) && fs.existsSync(fallback)) {
    fs.copyFileSync(fallback, dest);
  }
  return fs.existsSync(dest) ? dest : null;
}

async function run() {
  // Default owner account (idempotent — only inserted if no users exist yet).
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    db.prepare(`INSERT INTO users (username, password_hash, name, role, is_owner, permissions) VALUES (?, ?, ?, 'admin', 1, '{}')`)
      .run('admin', hashPassword('onsewinkel'), 'Rahat Baig');
    console.log('  ✓ created owner account (username: admin, password: onsewinkel)');
  } else {
    // Make sure there is always at least one owner. If none, promote `admin`.
    const ownerCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_owner = 1').get().c;
    if (ownerCount === 0) {
      const admin = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
      if (admin) {
        db.prepare('UPDATE users SET is_owner = 1 WHERE id = ?').run(admin.id);
        console.log('  · promoted existing admin account to owner');
      }
    } else {
      console.log('  · users table already populated — leaving accounts untouched');
    }
  }

  // Owner confirmation password — required when creating new accounts or
  // resetting another user's password. Stored hashed.
  const existingOwnerPw = db.prepare(`SELECT value FROM settings WHERE key = 'owner_password'`).get();
  if (!existingOwnerPw) {
    setSetting.run('owner_password', JSON.stringify({ hash: hashPassword('usamabaig454') }));
    console.log('  ✓ seeded owner confirmation password (default: usamabaig454)');
  }

  // Leave entitlements — Onse Winkel defaults (≥ SA BCEA statutory minimums).
  const existingLeaveCfg = db.prepare(`SELECT value FROM settings WHERE key = 'leave_entitlements'`).get();
  if (!existingLeaveCfg) {
    setSetting.run('leave_entitlements', JSON.stringify({
      annual_days:          18,   // Company policy (BCEA § 20 minimum is 15)
      sick_days_per_year:   10,   // 30 / 3-year cycle averaged
      sick_cycle_years:     3,    // BCEA § 22
      family_days:          3,    // BCEA § 27
      parental_days:        10,   // BCEA § 25A
      maternity_months:     4,    // BCEA § 25 (employee claims UIF)
      compassionate_days:   3,
      study_days:           0,
    }));
    console.log('  ✓ seeded leave entitlements (18 annual + SA BCEA defaults)');
  } else {
    // Back-fill: if the live setting still has annual_days = 15 (the old
    // default) and the owner hasn't touched anything else past defaults,
    // bump it to 18 so existing installs match the new policy.
    try {
      const cur = JSON.parse(existingLeaveCfg.value);
      if (Number(cur.annual_days) === 15) {
        cur.annual_days = 18;
        setSetting.run('leave_entitlements', JSON.stringify(cur));
        console.log('  ✓ back-filled annual_days 15 → 18 in leave_entitlements');
      }
    } catch {}
  }

  // Already seeded?
  const existing = db.prepare('SELECT COUNT(*) AS c FROM employees').get();
  if (existing.c > 0) {
    console.log('  · employees already exist — clearing and reseeding');
    db.exec('DELETE FROM activity; DELETE FROM payslips; DELETE FROM documents; DELETE FROM attendance; DELETE FROM timesheet_imports; DELETE FROM employees;');
  }

  const logoPath = placeLogoFromDesign();
  setSetting.run('company', JSON.stringify({ ...COMPANY, logoPath: logoPath || '' }));
  setSetting.run('payroll_rules', JSON.stringify({
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    sundayMultiplier: 2.0,
    uifRate: 0.01,
    payeMode: 'manual',
    sickPay: 'avgDaily',
  }));
  setSetting.run('preferences', JSON.stringify({
    currency: 'ZAR',
    dateFormat: 'DD MMM YYYY',
    timezone: 'Africa/Johannesburg',
    autoBackup: true,
    lastBackup: '2026-05-15T22:00:00.000Z',
  }));

  const employeeId = 'emp-001';

  insertEmp.run({
    id: employeeId,
    employee_no: '423452',
    first_name: 'Cedrick',
    last_name: 'Fredericks',
    position: 'General Worker',
    department: 'Store Operations',
    phone: '+27 78 412 0931',
    email: 'cedrick.f@onsewinkel.co.za',
    address: '24 Hospital Road, Alexander Bay, 8290',
    date_employed: '2024-08-15',
    hourly_wage: 30.23,
    initial_ytd: 11017.50,
    status: 'active',
    payment_method: 'EFT',
    bank: 'Capitec',
    bank_account: '1483 9026 41',
    id_number: '——',
    tax_code: '——',
    notes: '',
  });

  for (const a of buildCedrickAttendance()) {
    insertAtt.run({ employee_id: employeeId, ...a, note: null });
  }

  const seedDocs = [
    { id: 'doc-1', name: 'Employment Contract – Cedrick Fredericks.pdf', tag: 'Contract', size: 184320, uploaded: '2024-08-15', version: 1 },
    { id: 'doc-2', name: 'ID Document.pdf',                              tag: 'HR',       size: 92160,  uploaded: '2024-08-15', version: 1 },
    { id: 'doc-3', name: 'Q4 2025 Performance Review.pdf',               tag: 'Performance', size: 145408, uploaded: '2025-12-12', version: 2 },
    { id: 'doc-4', name: 'Annual Leave Request – Dec 2025.pdf',          tag: 'Leave',    size: 51200,  uploaded: '2025-11-20', version: 1 },
    { id: 'doc-5', name: 'Medical Certificate – 18 Feb.jpg',             tag: 'Medical',  size: 268288, uploaded: '2026-02-18', version: 1 },
  ];
  // Materialise placeholder files so download/view endpoints work.
  const empUploads = path.join(config.uploadsDir, employeeId);
  fs.mkdirSync(empUploads, { recursive: true });
  for (const d of seedDocs) {
    const dest = path.join(empUploads, `${d.id}_${d.name}`);
    if (!fs.existsSync(dest)) {
      const pdfBytes = Buffer.from(
        d.name.endsWith('.pdf')
          ? '%PDF-1.3\n%fake-seed\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n100\n%%EOF\n'
          : 'seed placeholder',
      );
      fs.writeFileSync(dest, pdfBytes);
    }
    insertDoc.run({
      id: d.id,
      employee_id: employeeId,
      name: d.name,
      tag: d.tag,
      storage_path: path.relative(config.dataDir, dest),
      size: d.size,
      mime: d.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
      version: d.version,
      uploaded_at: d.uploaded,
    });
  }

  const seedSlips = [
    { id: 'ps-2026-02', period_label: 'Jan-Feb 26', period_start: '2026-01-21', period_end: '2026-02-20', pay_date: '2026-02-21', gross: 5571.20, normal_pay: 4080.00, overtime_pay: 200.00, holiday_pay: 1291.20 },
    { id: 'ps-2026-01', period_label: 'Dec-Jan 26', period_start: '2025-12-21', period_end: '2026-01-20', pay_date: '2026-01-21', gross: 5446.30, normal_pay: 4050.00, overtime_pay: 180.00, holiday_pay: 1216.30 },
  ];

  for (const s of seedSlips) {
    const uif = +(s.gross * 0.01).toFixed(2);
    insertPs.run({
      id: s.id,
      employee_id: employeeId,
      period_label: s.period_label,
      period_start: s.period_start,
      period_end: s.period_end,
      pay_date: s.pay_date,
      normal_hours: +(s.normal_pay / 30.23).toFixed(2),
      overtime_hours: +(s.overtime_pay / (30.23 * 1.5)).toFixed(2),
      holiday_hours: +(s.holiday_pay / (30.23 * 2)).toFixed(2),
      sick_hours: 0,
      leave_hours: 0,
      normal_pay: s.normal_pay,
      overtime_pay: s.overtime_pay,
      holiday_pay: s.holiday_pay,
      sick_pay: 0,
      commission: 0,
      bonus: 0,
      other_earnings: 0,
      hourly_wage: 30.23,
      gross: s.gross,
      uif,
      paye: 0,
      other_deductions: 0,
      net: +(s.gross - uif).toFixed(2),
      pdf_path: null,
    });
  }

  // Generate PDFs for the two seed payslips.
  const allEmp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  const slips = db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY pay_date ASC').all(employeeId);
  for (const slip of slips) {
    const pdfPath = path.join(config.payslipsDir, `${slip.id}.pdf`);
    if (!fs.existsSync(pdfPath)) {
      await generatePayslipPDF({
        outPath: pdfPath,
        employee: allEmp,
        payslip: slip,
        priorSlips: slips.filter(s => s.pay_date <= slip.pay_date),
        company: { ...COMPANY, logoPath },
      });
    }
    db.prepare('UPDATE payslips SET pdf_path = ? WHERE id = ?').run(
      path.relative(config.dataDir, pdfPath), slip.id,
    );
  }

  insertActivity.run({ employee_id: employeeId, kind: 'payslip', title: 'Mar payslip generated', detail: 'ps-2026-02', created_at: '2026-03-21T09:00:00.000Z' });
  insertActivity.run({ employee_id: employeeId, kind: 'document', title: 'Medical certificate uploaded', detail: 'doc-5', created_at: '2026-02-18T11:00:00.000Z' });
  insertActivity.run({ employee_id: employeeId, kind: 'payslip', title: 'Feb payslip generated', detail: 'ps-2026-01', created_at: '2026-02-21T09:00:00.000Z' });
  insertActivity.run({ employee_id: employeeId, kind: 'document', title: 'Performance review filed', detail: 'doc-3', created_at: '2025-12-12T10:00:00.000Z' });

  const attCount = db.prepare('SELECT COUNT(*) AS c FROM attendance').get().c;
  console.log(`  ✓ seeded 1 employee, ${attCount} attendance rows, 5 documents, 2 payslips`);
}

run().catch(err => { console.error(err); process.exit(1); });
