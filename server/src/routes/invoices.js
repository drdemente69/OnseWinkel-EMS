import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db.js';
import config from '../config.js';
import { requirePermission } from '../services/auth.js';
import { generateInvoicePDF } from '../services/invoice-pdf.js';

const router = express.Router();

function getCompany() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'company'`).get();
  return row ? JSON.parse(row.value) : null;
}

// Default banking block (overridable per document). Mirrors the company's real
// FNB account so a fresh quote/invoice is ready to send.
const DEFAULT_BANK = {
  bank_name: 'First National Bank (FNB)',
  bank_account_name: 'Onse Winkel (Pty) Ltd',
  bank_account_no: '63006015209',
  bank_branch: '250655',
};

const VAT_RATE = 0.15;

// Compute VAT-inclusive totals. For products the grand total is the sum of the
// line amounts (qty × unit price); for services the caller supplies the total.
function computeTotals({ mode, items, servicesTotal, vatEnabled }) {
  let grand;
  const normItems = (items || []).map((it) => {
    const out = { title: (it.title || '').trim(), description: (it.description || '').trim() };
    if (mode === 'products') {
      const qty = Number(it.qty) || 0;
      const unit = Number(it.unitPrice) || 0;
      out.qty = qty;
      out.unitPrice = unit;
      out.amount = Math.round(qty * unit * 100) / 100;
    }
    return out;
  });
  if (mode === 'products') {
    grand = normItems.reduce((a, it) => a + (it.amount || 0), 0);
  } else {
    grand = Number(servicesTotal) || 0;
  }
  grand = Math.round(grand * 100) / 100;
  const vat = vatEnabled ? Math.round((grand - grand / (1 + VAT_RATE)) * 100) / 100 : 0;
  return { items: normItems, grand_total: grand, subtotal: grand, vat_amount: vat };
}

function suggestNumber(docType) {
  const year = new Date().getFullYear();
  const prefix = docType === 'invoice' ? `INV-${year}-` : `OW-${year}-`;
  const rows = db.prepare(
    `SELECT number FROM invoices WHERE doc_type = ? AND number LIKE ? ORDER BY number DESC`,
  ).all(docType, `${prefix}%`);
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)\s*$/.exec(r.number);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ---- List
router.get('/', (req, res) => {
  const { type } = req.query;
  let rows;
  if (type === 'quotation' || type === 'invoice') {
    rows = db.prepare('SELECT * FROM invoices WHERE doc_type = ? ORDER BY created_at DESC').all(type);
  } else {
    rows = db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all();
  }
  res.json(rows.map(hydrate));
});

// ---- Suggest the next document number
router.get('/next-number', (req, res) => {
  const docType = req.query.type === 'invoice' ? 'invoice' : 'quotation';
  res.json({ number: suggestNumber(docType) });
});

// ---- Banking defaults (for prefilling a fresh document)
router.get('/defaults', (req, res) => {
  res.json({ bank: DEFAULT_BANK });
});

// ---- Get one
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(hydrate(row));
});

// ---- Create
router.post('/', requirePermission('invoices:manage'), async (req, res) => {
  try {
    const b = req.body || {};
    const docType = b.docType === 'invoice' ? 'invoice' : 'quotation';
    const mode = b.mode === 'products' ? 'products' : 'services';
    const { items, grand_total, subtotal, vat_amount } = computeTotals({
      mode, items: b.items, servicesTotal: b.servicesTotal, vatEnabled: b.vatEnabled !== false,
    });

    const id = `inv-${Date.now()}`;
    const number = (b.number && String(b.number).trim()) || suggestNumber(docType);
    const row = {
      id,
      doc_type: docType,
      mode,
      number,
      doc_date: b.docDate || new Date().toISOString().slice(0, 10),
      secondary_date: b.secondaryDate || null,
      client_name: b.clientName || '',
      client_address: b.clientAddress || '',
      scope_description: b.scopeDescription || '',
      route_from: b.routeFrom || '',
      route_from_sub: b.routeFromSub || '',
      route_to: b.routeTo || '',
      route_to_sub: b.routeToSub || '',
      items_heading: b.itemsHeading || (mode === 'products' ? 'Description' : 'Services Included'),
      items: JSON.stringify(items),
      vat_enabled: b.vatEnabled === false ? 0 : 1,
      subtotal,
      vat_amount,
      grand_total,
      bank_name: b.bankName ?? DEFAULT_BANK.bank_name,
      bank_account_name: b.bankAccountName ?? DEFAULT_BANK.bank_account_name,
      bank_account_no: b.bankAccountNo ?? DEFAULT_BANK.bank_account_no,
      bank_branch: b.bankBranch ?? DEFAULT_BANK.bank_branch,
      terms: JSON.stringify(Array.isArray(b.terms) ? b.terms.filter(t => String(t).trim()) : []),
      thanks_title: b.thanksTitle || 'Thank you for your business',
      thanks_sub: b.thanksSub || '',
      notes: b.notes || '',
      pdf_path: null,
    };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO invoices (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);

    await buildPdf(id);
    res.status(201).json(hydrate(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)));
  } catch (e) {
    console.error('[invoices/create]', e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Update
router.put('/:id', requirePermission('invoices:manage'), async (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const docType = b.docType === 'invoice' ? 'invoice' : (b.docType === 'quotation' ? 'quotation' : existing.doc_type);
    const mode = b.mode === 'products' ? 'products' : (b.mode === 'services' ? 'services' : existing.mode);
    const vatEnabled = b.vatEnabled !== undefined ? b.vatEnabled !== false : !!existing.vat_enabled;
    const { items, grand_total, subtotal, vat_amount } = computeTotals({
      mode, items: b.items, servicesTotal: b.servicesTotal, vatEnabled,
    });

    const row = {
      doc_type: docType,
      mode,
      number: (b.number && String(b.number).trim()) || existing.number,
      doc_date: b.docDate || existing.doc_date,
      secondary_date: b.secondaryDate ?? existing.secondary_date,
      client_name: b.clientName ?? existing.client_name,
      client_address: b.clientAddress ?? existing.client_address,
      scope_description: b.scopeDescription ?? existing.scope_description,
      route_from: b.routeFrom ?? existing.route_from,
      route_from_sub: b.routeFromSub ?? existing.route_from_sub,
      route_to: b.routeTo ?? existing.route_to,
      route_to_sub: b.routeToSub ?? existing.route_to_sub,
      items_heading: b.itemsHeading || existing.items_heading,
      items: JSON.stringify(items),
      vat_enabled: vatEnabled ? 1 : 0,
      subtotal, vat_amount, grand_total,
      bank_name: b.bankName ?? existing.bank_name,
      bank_account_name: b.bankAccountName ?? existing.bank_account_name,
      bank_account_no: b.bankAccountNo ?? existing.bank_account_no,
      bank_branch: b.bankBranch ?? existing.bank_branch,
      terms: JSON.stringify(Array.isArray(b.terms) ? b.terms.filter(t => String(t).trim()) : JSON.parse(existing.terms || '[]')),
      thanks_title: b.thanksTitle ?? existing.thanks_title,
      thanks_sub: b.thanksSub ?? existing.thanks_sub,
      notes: b.notes ?? existing.notes,
      updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      id: req.params.id,
    };
    const setClause = Object.keys(row).filter(k => k !== 'id').map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE invoices SET ${setClause} WHERE id = @id`).run(row);

    await buildPdf(req.params.id);
    res.json(hydrate(db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)));
  } catch (e) {
    console.error('[invoices/update]', e);
    res.status(500).json({ error: e.message });
  }
});

// ---- PDF (stream; regenerate if missing)
router.get('/:id/pdf', async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  let abs = inv.pdf_path ? path.join(config.dataDir, inv.pdf_path) : null;
  if (!abs || !fs.existsSync(abs)) abs = await buildPdf(inv.id);
  res.setHeader('Content-Type', 'application/pdf');
  const safe = (inv.number || inv.id).replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Disposition', `inline; filename="${inv.doc_type}-${safe}.pdf"`);
  fs.createReadStream(abs).pipe(res);
});

// ---- Delete
router.delete('/:id', requirePermission('invoices:manage'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (inv.pdf_path) {
    const abs = path.join(config.dataDir, inv.pdf_path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- helpers ----
function hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    items: JSON.parse(row.items || '[]'),
    terms: JSON.parse(row.terms || '[]'),
  };
}

async function buildPdf(id) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const invoicesDir = path.join(config.dataDir, 'invoices');
  fs.mkdirSync(invoicesDir, { recursive: true });
  const outPath = path.join(invoicesDir, `${id}.pdf`);
  await generateInvoicePDF({
    outPath,
    invoice: { ...row, items: JSON.parse(row.items || '[]'), terms: JSON.parse(row.terms || '[]') },
    company: getCompany(),
  });
  db.prepare('UPDATE invoices SET pdf_path = ? WHERE id = ?').run(path.relative(config.dataDir, outPath), id);
  return outPath;
}

export default router;
