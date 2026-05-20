import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();

const empCols = ['id','employee_no','first_name','last_name','photo_path','position','department','phone','email','address','date_employed','hourly_wage','initial_ytd','status','payment_method','bank','bank_account','id_number','tax_code','notes'];

function hydrate(emp) {
  if (!emp) return null;
  const attendance = db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date ASC').all(emp.id);
  const documents = db.prepare('SELECT * FROM documents WHERE employee_id = ? ORDER BY uploaded_at DESC').all(emp.id);
  const payslips = db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY pay_date DESC').all(emp.id);
  return { ...emp, attendance, documents, payslips };
}

router.get('/', (req, res) => {
  const { status, q } = req.query;
  let sql = 'SELECT * FROM employees';
  const where = [];
  const params = {};
  if (status) { where.push('status = @status'); params.status = status; }
  if (q) {
    where.push('(first_name LIKE @q OR last_name LIKE @q OR email LIKE @q OR position LIKE @q OR employee_no LIKE @q)');
    params.q = `%${q}%`;
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY first_name, last_name';
  const rows = db.prepare(sql).all(params);
  res.json(rows.map(hydrate));
});

router.get('/:id', (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  res.json(hydrate(emp));
});

router.post('/', requirePermission('employees:create'), (req, res) => {
  const body = req.body || {};
  const id = body.id || `emp-${crypto.randomBytes(4).toString('hex')}`;
  if (!body.first_name || !body.last_name) {
    return res.status(400).json({ error: 'first_name and last_name required' });
  }
  const row = {
    id,
    employee_no: body.employee_no || String(Math.floor(100000 + Math.random() * 900000)),
    first_name: body.first_name,
    last_name: body.last_name,
    photo_path: body.photo_path || null,
    position: body.position || '',
    department: body.department || '',
    phone: body.phone || '',
    email: body.email || '',
    address: body.address || '',
    date_employed: body.date_employed || new Date().toISOString().slice(0, 10),
    hourly_wage: Number(body.hourly_wage) || 0,
    initial_ytd: Number(body.initial_ytd) || 0,
    status: body.status || 'active',
    payment_method: body.payment_method || 'EFT',
    bank: body.bank || '',
    bank_account: body.bank_account || '',
    id_number: body.id_number || '',
    tax_code: body.tax_code || '',
    notes: body.notes || '',
  };
  db.prepare(`INSERT INTO employees (${empCols.join(',')}) VALUES (${empCols.map(c => '@'+c).join(',')})`).run(row);
  db.prepare(`INSERT INTO activity (employee_id, kind, title) VALUES (?, 'employee', ?)`).run(id, `Employee profile created`);
  res.status(201).json(hydrate(db.prepare('SELECT * FROM employees WHERE id = ?').get(id)));
});

router.patch('/:id', requirePermission('employees:edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const allowed = empCols.filter(c => c !== 'id');
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (Object.keys(updates).length === 0) return res.json(hydrate(existing));
  const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE employees SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: existing.id });
  res.json(hydrate(db.prepare('SELECT * FROM employees WHERE id = ?').get(existing.id)));
});

router.delete('/:id', requirePermission('employees:delete'), (req, res) => {
  const r = db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
