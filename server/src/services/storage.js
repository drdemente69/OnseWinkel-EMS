import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import config from '../config.js';
import crypto from 'node:crypto';

export function makeUploader(subdir, opts = {}) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const employeeId = req.params.employeeId || req.body.employeeId;
      const target = subdir === 'employees'
        ? path.join(config.uploadsDir, employeeId || '_unassigned')
        : subdir === 'timesheets'
        ? config.timesheetsDir
        : path.join(config.dataDir, subdir);
      fs.mkdirSync(target, { recursive: true });
      cb(null, target);
    },
    filename: (req, file, cb) => {
      const id = crypto.randomBytes(6).toString('hex');
      cb(null, `${Date.now()}-${id}-${file.originalname}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: opts.maxSize || 20 * 1024 * 1024 },
  });
}

export function relPath(absPath) {
  return path.relative(config.dataDir, absPath);
}

export function absFromStorage(rel) {
  return path.join(config.dataDir, rel);
}
