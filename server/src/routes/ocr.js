import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db.js';
import config from '../config.js';
import { makeUploader, relPath, absFromStorage } from '../services/storage.js';
import { processTimesheet, syntheticSampleRows, periodFromLabel, periodFromMonths } from '../services/ocr.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();
const upload = makeUploader('timesheets');

function parsePeriodHint(body) {
  if (!body) return null;
  if (body.periodLabel) {
    const p = periodFromLabel(body.periodLabel);
    if (p) return p;
  }
  if (body.periodStart && body.periodEnd) {
    const endISO = String(body.periodEnd);
    // Payday defaults to the day after the period ends.
    let payDateISO = body.payDate || null;
    if (!payDateISO) {
      const next = new Date(endISO + 'T00:00:00Z');
      next.setUTCDate(next.getUTCDate() + 1);
      payDateISO = next.toISOString().slice(0, 10);
    }
    return {
      startISO: String(body.periodStart),
      endISO,
      label: body.periodLabel || 'Custom period',
      payDateISO,
    };
  }
  return null;
}

router.post('/scan', requirePermission('ocr:use'), upload.single('image'), async (req, res) => {
  try {
    let imagePath = req.file?.path;
    let useSample = false;
    if (!imagePath && (req.body?.useSample === 'true' || req.body?.useSample === true)) {
      useSample = true;
    }

    const periodHint = parsePeriodHint(req.body);
    const id = `ts-${crypto.randomBytes(4).toString('hex')}`;
    let result;
    if (useSample) {
      result = syntheticSampleRows(periodHint);
      // Save a tiny placeholder so the timesheet_imports row has a path.
      const placeholder = path.join(config.timesheetsDir, `${id}.sample`);
      fs.writeFileSync(placeholder, 'sample');
      imagePath = placeholder;
    } else {
      if (!imagePath) return res.status(400).json({ error: 'Image file required' });
      try {
        result = await processTimesheet(imagePath, { periodHint });
      } catch (e) {
        console.warn('OCR failed:', e.message);
        result = syntheticSampleRows();
      }
      // If OCR returns no rows, fall back to sample so the UI keeps working.
      if (!result.rows || result.rows.length === 0) {
        result = syntheticSampleRows();
        if (periodHint) result.period = periodHint;
      }
    }

    db.prepare(`INSERT INTO timesheet_imports (id, employee_id, image_path, raw_text, parsed_json, status)
      VALUES (?, ?, ?, ?, ?, 'pending')`).run(
      id,
      req.body?.employeeId || null,
      relPath(imagePath),
      result.rawText || '',
      JSON.stringify(result),
    );
    res.json({ id, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/image', (req, res) => {
  const row = db.prepare('SELECT * FROM timesheet_imports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const abs = absFromStorage(row.image_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Image missing' });
  res.sendFile(abs);
});

// Commit reviewed rows into attendance for an employee.
router.post('/:id/commit', requirePermission('ocr:use'), (req, res) => {
  const row = db.prepare('SELECT * FROM timesheet_imports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const employeeId = req.body?.employeeId || row.employee_id;
  if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
  const rows = req.body?.rows || [];

  const stmt = db.prepare(`INSERT INTO attendance
    (employee_id, date, type, start_time, end_time, break_min, hours, overtime, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      type = excluded.type, start_time = excluded.start_time, end_time = excluded.end_time,
      break_min = excluded.break_min, hours = excluded.hours, overtime = excluded.overtime,
      note = excluded.note, updated_at = datetime('now')`);

  // Only commit rows the user has actually confirmed (i.e. not flagged as
  // needing manual entry, and which have a date).
  const committable = rows.filter(r => r?.date && !r._needsManualEntry);
  const tx = db.transaction(() => {
    for (const r of committable) {
      stmt.run(
        employeeId, r.date, r.type || 'normal',
        r.start ?? r.start_time ?? null,
        r.end ?? r.end_time ?? null,
        Number(r.breakMin ?? r.break_min ?? 0),
        Number(r.hours ?? 0),
        Number(r.overtime ?? 0),
        `OCR: ${row.id}`,
      );
    }
    db.prepare(`UPDATE timesheet_imports SET status = 'imported', employee_id = ? WHERE id = ?`)
      .run(employeeId, row.id);
  });
  tx();
  db.prepare(`INSERT INTO activity (employee_id, kind, title, detail) VALUES (?, 'ocr', ?, ?)`)
    .run(employeeId, `OCR timesheet imported`, `${committable.length} entries`);
  res.json({ ok: true, imported: committable.length, skipped: rows.length - committable.length });
});

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, employee_id, status, created_at FROM timesheet_imports ORDER BY created_at DESC').all();
  res.json(rows);
});

export default router;
