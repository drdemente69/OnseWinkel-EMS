# Onse Winkel EMS

Local employee management system for Onse Winkel PTY LTD. Runs entirely on your
Mac — no cloud account, no external services. SQLite for data, the local
filesystem for files (documents, PDFs, backups, timesheet images).

## What's inside

```
OnseWinkel-EMS/
├── server/                 Node.js + Express API
│   ├── src/
│   │   ├── server.js       wire-up
│   │   ├── config.js       paths + env
│   │   ├── db.js           better-sqlite3 handle
│   │   ├── migrate.js      runs SQL migrations
│   │   ├── seed.js         seeds Cedrick + 31 days + 2 payslips
│   │   ├── routes/         REST endpoints
│   │   └── services/
│   │       ├── payroll.js  calculation engine
│   │       ├── pdf.js      PDFKit payslip renderer
│   │       ├── ocr.js      Tesseract.js pipeline + parser
│   │       ├── storage.js  multer-backed file uploads
│   │       └── backup.js   JSON export/import
│   └── migrations/001_init.sql
├── client/                 Vite + React UI
│   └── src/
│       ├── App.jsx, main.jsx, store.jsx, api.js, styles.css
│       ├── components/Icons.jsx, Shell.jsx
│       └── screens/Dashboard, Employees, Attendance,
│                   Payslips, Documents, OCR, Settings
├── data/                   created at first run
│   ├── ems.db              SQLite database
│   ├── uploads/<employee>  per-employee document vault
│   ├── timesheets/         OCR source images
│   ├── payslips/           generated PDFs
│   └── backups/            local .json snapshots
├── package.json            workspace root
└── .env.example
```

## Features implemented

- **Employees** — full CRUD, profile view with overview / attendance / payslips
  / documents tabs, CSV export.
- **Employee document vault** — per-employee uploads, version tracking,
  tags (Contract, Leave, Payroll, HR, Medical, Performance, Warning),
  inline preview + download, global search.
- **Attendance calendar** — month view with overtime, sick, holiday and leave
  pills. Day editor with auto-calc from start/end. Bulk-replace endpoint.
- **OCR timesheet** — drag-drop image upload → Tesseract.js extraction →
  parser that pulls day rows out of free text → editable review table →
  commit straight into attendance. Falls back to a synthetic sample when an
  image is too noisy to parse.
- **Payroll engine** — Onse Winkel pay rules (1.0×, 1.5×, 2.0×, UIF 1%, sick
  pay = avg daily hours × wage). Live preview while building. Persists all
  hours, rates, totals and per-line YTD.
- **Payslip PDF** — PDFKit renderer styled to match the Onse Winkel sample
  layout (brown header rule, olive accents, JetBrains-mono numbers, net-pay
  panel). Stored under `data/payslips/<id>.pdf`. Regenerated lazily if missing.
- **YTD calculations** — accumulates initial YTD + every prior payslip per
  line, plumbed through the engine and the PDF.
- **Dashboard** — active employees, current-period payroll, YTD payroll,
  payroll trend (last 8 months), hours breakdown for the current month,
  recent payslips/documents, anniversaries, quick actions.
- **Search** — global ⌘K palette over employees, documents, payslips.
- **Backup / restore** — `/api/backup/export` streams a full JSON snapshot;
  Settings → "Save local backup" stores under `data/backups/`. Upload a JSON
  file in Settings → "Restore from backup" to replace state in a single tx.

## Stack

- **Backend:** Node 18+ (tested on Node 24), Express 4, better-sqlite3,
  PDFKit, Tesseract.js, Multer, dotenv, morgan.
- **Frontend:** React 18 + Vite 5 (hash routing, no SPA framework needed).
- **DB:** SQLite (WAL journal mode, foreign keys on).
- **Tests:** payslip preview/generation and OCR sample both exercised by the
  seed step.

## Setup

Run once:

```bash
cd ~/OnseWinkel-EMS
npm install --workspaces          # installs server + client deps
npm run migrate                   # creates data/ems.db and applies schema
npm run seed                      # inserts Cedrick + attendance + payslips
npm run build                     # bundles the client into client/dist
```

Optional — copy the env template:

```bash
cp .env.example .env
```

## Running

### Single-process production mode (server hosts built UI)

```bash
npm start
# open http://localhost:4180
```

The Express server serves the API at `/api/*` and the built React app at
`/`. Static logo at `/static/logo.jpg`.

### Dev mode (live-reload UI + watch-restart server)

```bash
npm run dev
# open http://localhost:5173    ← Vite dev server
```

Two processes are spawned via `concurrently`:

- **server** on `localhost:4180` (auto-restart via `node --watch`)
- **client** on `localhost:5173` (Vite, with a proxy to `/api` and `/static`)

You can also run them in two terminals:

```bash
npm run dev:server
# in a second tab:
npm run dev:client
```

### Reset

```bash
rm -f data/ems.db data/ems.db-shm data/ems.db-wal
rm -rf data/uploads/* data/payslips/* data/timesheets/* data/backups/*
npm run migrate && npm run seed
```

Or, from inside the UI, **Settings → Reset all data**.

## API surface (relative to `/api`)

| Method | Path                              | Description                              |
|-------:|-----------------------------------|------------------------------------------|
|   GET  | `/health`                         | liveness probe                            |
|   GET  | `/dashboard`                      | aggregated dashboard data                 |
|   GET  | `/dashboard/search?q=`            | global search                             |
|   GET  | `/employees`                      | list (`?status=`, `?q=`)                  |
|   GET  | `/employees/:id`                  | one employee with attendance/docs/payslips|
|   POST | `/employees`                      | create                                    |
|  PATCH | `/employees/:id`                  | update fields                             |
| DELETE | `/employees/:id`                  | delete (cascade)                          |
|   GET  | `/attendance/:emp[?from&to]`      | attendance rows                           |
|    PUT | `/attendance/:emp/:date`          | upsert one day                            |
|   POST | `/attendance/:emp/bulk`           | replace within a range                    |
| DELETE | `/attendance/:emp/:date`          | delete one day                            |
|   GET  | `/documents`                      | global list (`?q&tag&employeeId`)         |
|   POST | `/documents/:emp` (multipart)     | upload a file                             |
|  PATCH | `/documents/:id`                  | rename / retag                            |
|   GET  | `/documents/:id/file`             | binary stream                             |
| DELETE | `/documents/:id`                  | delete                                    |
|   GET  | `/payslips`                       | list joined with employee                 |
|   POST | `/payslips/preview`               | live calc, no persistence                 |
|   POST | `/payslips`                       | generate + PDF                            |
|   GET  | `/payslips/:id`                   | one                                       |
|   GET  | `/payslips/:id/pdf`               | PDF stream (lazy-regenerates if missing)  |
| DELETE | `/payslips/:id`                   |                                          |
|   POST | `/ocr/scan` (multipart)           | run OCR; returns parsed rows              |
|   GET  | `/ocr/:id/image`                  | original image                            |
|   POST | `/ocr/:id/commit`                 | write reviewed rows into attendance       |
|   GET  | `/backup/export`                  | download snapshot.json                    |
|   POST | `/backup/save`                    | save snapshot to `data/backups/`          |
|   POST | `/backup/import` (multipart/json) | full replace from snapshot                |
|   GET  | `/backup`                         | list local backups                        |
|   GET  | `/settings`                       | all keys                                  |
|    PUT | `/settings/:key`                  | upsert one key                            |

## Pay rules (encoded in `server/src/services/payroll.js`)

| Type                | Calculation                                    |
|---------------------|------------------------------------------------|
| Standard            | `hours × wage`                                 |
| Overtime            | `hours × wage × 1.5`                           |
| Sunday & Holiday    | `hours × wage × 2.0`                           |
| Sick                | `sick_days × avg_daily_hours × wage`           |
| UIF deduction       | `1% × gross`                                   |
| PAYE                | manual (set per payslip during build)          |

Adjust under `server/src/services/payroll.js` if Onse Winkel's policy changes.
All historical payslips remain frozen — only future runs use the new rules.

## Seed data

`npm run seed` creates:

- **Cedrick Fredericks** — General Worker, Capitec EFT, R30.23/h, initial YTD
  R11 017.50.
- **31 attendance rows** for Mar 22 – Apr 21, 2026 (Sundays + Apr 10 as holiday,
  4 h overtime on Apr 9 — matches the design brief).
- **5 documents** with placeholder PDFs/JPGs.
- **2 historical payslips** (`Feb-Mar 26`, `Jan-Feb 26`) with regenerated PDFs.
- **Activity feed** entries for those events.

## Troubleshooting

- `better-sqlite3` build fails on first install → ensure Xcode CLI tools are
  installed (`xcode-select --install`).
- Port 4180 already in use → set `PORT=4200` in `.env`.
- OCR returns no rows → that's expected for genuinely illegible handwriting.
  The pipeline falls back to a synthetic sample so the workflow stays usable;
  edit any row in the review table before importing.
- Payslip PDF looks broken → delete the file from `data/payslips/<id>.pdf` and
  hit `/api/payslips/:id/pdf` again — it regenerates from the DB row.
