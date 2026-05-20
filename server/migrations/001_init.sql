-- Onse Winkel EMS — initial schema
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id              TEXT PRIMARY KEY,
  employee_no     TEXT NOT NULL UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  photo_path      TEXT,
  position        TEXT,
  department      TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  date_employed   TEXT,                -- ISO date
  hourly_wage     REAL NOT NULL DEFAULT 0,
  initial_ytd     REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  payment_method  TEXT,
  bank            TEXT,
  bank_account    TEXT,
  id_number       TEXT,
  tax_code        TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_name   ON employees(first_name, last_name);

CREATE TABLE IF NOT EXISTS attendance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL,
  date          TEXT NOT NULL,             -- ISO YYYY-MM-DD
  type          TEXT NOT NULL,             -- normal | sunday | holiday | sick | annual | unpaid
  start_time    TEXT,
  end_time      TEXT,
  break_min     INTEGER NOT NULL DEFAULT 0,
  hours         REAL    NOT NULL DEFAULT 0,
  overtime      REAL    NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id, date);

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  name           TEXT NOT NULL,
  tag            TEXT NOT NULL DEFAULT 'HR',
  storage_path   TEXT NOT NULL,
  size           INTEGER NOT NULL DEFAULT 0,
  mime           TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_tag      ON documents(tag);

CREATE TABLE IF NOT EXISTS payslips (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL,
  period_label  TEXT NOT NULL,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  pay_date      TEXT NOT NULL,

  normal_hours    REAL NOT NULL DEFAULT 0,
  overtime_hours  REAL NOT NULL DEFAULT 0,
  holiday_hours   REAL NOT NULL DEFAULT 0,
  sick_hours      REAL NOT NULL DEFAULT 0,
  leave_hours     REAL NOT NULL DEFAULT 0,

  normal_pay      REAL NOT NULL DEFAULT 0,
  overtime_pay    REAL NOT NULL DEFAULT 0,
  holiday_pay     REAL NOT NULL DEFAULT 0,
  sick_pay        REAL NOT NULL DEFAULT 0,
  commission      REAL NOT NULL DEFAULT 0,
  bonus           REAL NOT NULL DEFAULT 0,
  other_earnings  REAL NOT NULL DEFAULT 0,

  hourly_wage     REAL NOT NULL,
  gross           REAL NOT NULL,
  uif             REAL NOT NULL,
  paye            REAL NOT NULL DEFAULT 0,
  other_deductions REAL NOT NULL DEFAULT 0,
  net             REAL NOT NULL,

  pdf_path        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id, pay_date);
CREATE INDEX IF NOT EXISTS idx_payslips_paydate  ON payslips(pay_date);

CREATE TABLE IF NOT EXISTS timesheet_imports (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT,
  image_path    TEXT NOT NULL,
  raw_text      TEXT,
  parsed_json   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | reviewed | imported
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_employee ON activity(employee_id, created_at);
