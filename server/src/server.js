import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import config from './config.js';
import employeesRouter from './routes/employees.js';
import attendanceRouter from './routes/attendance.js';
import documentsRouter from './routes/documents.js';
import payslipsRouter from './routes/payslips.js';
import ocrRouter from './routes/ocr.js';
import backupRouter from './routes/backup.js';
import settingsRouter from './routes/settings.js';
import dashboardRouter from './routes/dashboard.js';
import authRouter from './routes/auth.js';
import leaveRouter from './routes/leave.js';
import docTemplatesRouter from './routes/document-templates.js';
import { requireAuth } from './services/auth.js';

const app = express();

app.use(morgan('dev'));
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// All /api/* endpoints below require a valid Bearer token, except /auth/login
// and /auth/logout (logout is a no-op without a token).
app.use('/api', requireAuth(['/auth/login', '/auth/logout', '/health']));

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/payslips', payslipsRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/backup', backupRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/leave-requests', leaveRouter);
app.use('/api/document-templates', docTemplatesRouter);

// Serve company logo (and other small public assets) under /static/.
app.use('/static', express.static(config.dataDir, {
  maxAge: '1h',
  setHeaders: (res, p) => {
    if (p.endsWith('.jpg') || p.endsWith('.png')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// In production, serve the built client bundle.
if (fs.existsSync(config.clientBuildDir)) {
  app.use(express.static(config.clientBuildDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(config.clientBuildDir, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(config.port, () => {
  console.log(`\n  Onse Winkel EMS — API listening on http://localhost:${config.port}`);
  console.log(`  Data directory: ${config.dataDir}`);
  if (fs.existsSync(config.clientBuildDir)) {
    console.log(`  App UI:        http://localhost:${config.port}\n`);
  } else {
    console.log(`  Run \`npm run dev:client\` in another terminal for live UI.\n`);
  }
});
