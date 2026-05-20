import fs from 'node:fs';
import path from 'node:path';
import db from '../db.js';
import config from '../config.js';

export function exportSnapshot() {
  const employees = db.prepare('SELECT * FROM employees').all();
  const attendance = db.prepare('SELECT * FROM attendance').all();
  const documents = db.prepare('SELECT * FROM documents').all();
  const payslips = db.prepare('SELECT * FROM payslips').all();
  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, JSON.parse(r.value)]),
  );
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings,
    employees,
    attendance,
    documents,
    payslips,
  };
}

export function writeBackupFile() {
  const snap = exportSnapshot();
  const filename = `onsewinkel-ems-backup-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
  const filepath = path.join(config.backupsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(snap, null, 2), 'utf8');
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('preferences', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify({
    ...(JSON.parse(db.prepare(`SELECT value FROM settings WHERE key='preferences'`).get()?.value || '{}')),
    lastBackup: new Date().toISOString(),
  }));
  return { filename, filepath, size: fs.statSync(filepath).size };
}

export function importSnapshot(snap) {
  if (!snap || !Array.isArray(snap.employees)) {
    throw new Error('Invalid snapshot file');
  }
  const replace = db.transaction(() => {
    db.exec('DELETE FROM activity; DELETE FROM payslips; DELETE FROM documents; DELETE FROM attendance; DELETE FROM timesheet_imports; DELETE FROM employees; DELETE FROM settings;');

    for (const [k, v] of Object.entries(snap.settings || {})) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
    }
    const empCols = ['id','employee_no','first_name','last_name','photo_path','position','department','phone','email','address','date_employed','hourly_wage','initial_ytd','status','payment_method','bank','bank_account','id_number','tax_code','notes'];
    const empStmt = db.prepare(`INSERT INTO employees (${empCols.join(',')}) VALUES (${empCols.map(c => '@'+c).join(',')})`);
    for (const e of snap.employees) {
      empStmt.run(Object.fromEntries(empCols.map(c => [c, e[c] ?? null])));
    }
    const attCols = ['employee_id','date','type','start_time','end_time','break_min','hours','overtime','note'];
    const attStmt = db.prepare(`INSERT INTO attendance (${attCols.join(',')}) VALUES (${attCols.map(c => '@'+c).join(',')})`);
    for (const a of snap.attendance || []) {
      attStmt.run(Object.fromEntries(attCols.map(c => [c, a[c] ?? null])));
    }
    const docCols = ['id','employee_id','name','tag','storage_path','size','mime','version','uploaded_at'];
    const docStmt = db.prepare(`INSERT INTO documents (${docCols.join(',')}) VALUES (${docCols.map(c => '@'+c).join(',')})`);
    for (const d of snap.documents || []) {
      docStmt.run(Object.fromEntries(docCols.map(c => [c, d[c] ?? null])));
    }
    const psCols = ['id','employee_id','period_label','period_start','period_end','pay_date','normal_hours','overtime_hours','holiday_hours','sick_hours','leave_hours','normal_pay','overtime_pay','holiday_pay','sick_pay','commission','bonus','other_earnings','hourly_wage','gross','uif','paye','other_deductions','net','pdf_path'];
    const psStmt = db.prepare(`INSERT INTO payslips (${psCols.join(',')}) VALUES (${psCols.map(c => '@'+c).join(',')})`);
    for (const p of snap.payslips || []) {
      psStmt.run(Object.fromEntries(psCols.map(c => [c, p[c] ?? null])));
    }
  });
  replace();
  return { restored: true, employees: (snap.employees || []).length };
}
