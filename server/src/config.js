import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || './data');
const uploadsDir = path.join(dataDir, 'uploads');
const timesheetsDir = path.join(dataDir, 'timesheets');
const payslipsDir = path.join(dataDir, 'payslips');
const backupsDir = path.join(dataDir, 'backups');
const dbPath = path.join(dataDir, 'ems.db');

for (const dir of [dataDir, uploadsDir, timesheetsDir, payslipsDir, backupsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const config = {
  port: Number(process.env.PORT || 4180),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map(s => s.trim()).filter(Boolean),
  projectRoot,
  dataDir,
  uploadsDir,
  timesheetsDir,
  payslipsDir,
  backupsDir,
  dbPath,
  clientBuildDir: path.join(projectRoot, 'client', 'dist'),
};

export default config;
