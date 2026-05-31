import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db.js';
import config from '../config.js';
import { requirePermission } from '../services/auth.js';
import { TEMPLATES, findTemplate, generateTemplatePDF } from '../services/document-templates.js';

const router = express.Router();

function getCompany() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'company'`).get();
  return row ? JSON.parse(row.value) : null;
}

// List available templates (no PDF generators returned — just metadata).
router.get('/', (req, res) => {
  res.json(TEMPLATES.map(t => ({
    id: t.id,
    label: t.label,
    description: t.description,
    tag: t.tag,
    fields: t.fields,
  })));
});

// Generate a PDF from a template, save it as a document for the employee,
// and return the new documents row.
router.post('/generate', requirePermission('documents:upload'), async (req, res) => {
  try {
    const { templateId, employeeId, fields = {} } = req.body || {};
    if (!templateId || !employeeId) return res.status(400).json({ error: 'templateId and employeeId required' });

    const template = findTemplate(templateId);
    if (!template) return res.status(404).json({ error: 'Unknown template' });

    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const company = getCompany();

    // Write the PDF to disk.
    const id = `doc-${crypto.randomBytes(4).toString('hex')}`;
    const filename = template.filenameFor(employee);
    const empDir = path.join(config.uploadsDir, employee.id);
    fs.mkdirSync(empDir, { recursive: true });
    const safeFilename = filename.replace(/[\/\\:*?"<>|]/g, '_');
    const storedName = `${Date.now()}-${id}-${safeFilename}`;
    const absPath = path.join(empDir, storedName);

    const outStream = fs.createWriteStream(absPath);
    await generateTemplatePDF({ template, outStream, company, employee, fields });

    const size = fs.statSync(absPath).size;
    const storage_path = path.relative(config.dataDir, absPath);

    // Version = (previous count with same display name) + 1.
    const same = db.prepare('SELECT COUNT(*) AS c FROM documents WHERE employee_id = ? AND name = ?')
      .get(employee.id, filename);
    const version = (same?.c || 0) + 1;

    db.prepare(`INSERT INTO documents (id, employee_id, name, tag, storage_path, size, mime, version, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, datetime('now'))`).run(
      id, employee.id, filename, template.tag, storage_path, size, version,
    );
    db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'document', ?, ?)`)
      .run(employee.id, `Generated ${template.label}`, template.tag);

    res.status(201).json(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
  } catch (e) {
    console.error('[document-templates/generate]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
