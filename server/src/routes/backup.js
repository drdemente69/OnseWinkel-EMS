import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { exportSnapshot, writeBackupFile, importSnapshot } from '../services/backup.js';
import config from '../config.js';
import { requirePermission } from '../services/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

router.get('/export', (req, res) => {
  const snap = exportSnapshot();
  const filename = `onsewinkel-ems-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(snap, null, 2));
});

router.post('/save', requirePermission('settings:edit'), (req, res) => {
  const info = writeBackupFile();
  res.json(info);
});

router.get('/', (req, res) => {
  if (!fs.existsSync(config.backupsDir)) return res.json([]);
  const files = fs.readdirSync(config.backupsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(config.backupsDir, f));
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

router.post('/import', requirePermission('settings:edit'), upload.single('file'), (req, res) => {
  try {
    let snap;
    if (req.file) {
      snap = JSON.parse(req.file.buffer.toString('utf8'));
    } else if (req.body && Object.keys(req.body).length > 0) {
      snap = req.body;
    } else {
      return res.status(400).json({ error: 'No backup payload provided' });
    }
    const result = importSnapshot(snap);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
