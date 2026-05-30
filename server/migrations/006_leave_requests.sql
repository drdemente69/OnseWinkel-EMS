-- Onse Winkel EMS — Leave Approval system
--
-- One row per leave request. Approval auto-writes attendance rows for the
-- applicable working days (except for maternity/parental, which are tracked
-- here as a single span only).

CREATE TABLE IF NOT EXISTS leave_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id       TEXT NOT NULL,
  leave_type        TEXT NOT NULL,          -- annual | sick | family | maternity | parental | unpaid | study | compassionate
  sub_reason        TEXT,                   -- For family resp.: birth | illness | death | other (free text after the keyword)
  start_date        TEXT NOT NULL,          -- ISO YYYY-MM-DD
  end_date          TEXT NOT NULL,
  days_requested    REAL NOT NULL DEFAULT 0,-- gross calendar days in the range
  days_count        REAL NOT NULL DEFAULT 0,-- working days actually applied (excludes Sundays, public holidays, already-worked days)
  skipped_dates     TEXT,                   -- JSON array of ISO dates we skipped (worked / holiday / Sunday) for audit
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  decided_by        INTEGER,                -- references users.id
  decided_at        TEXT,
  attendance_written INTEGER NOT NULL DEFAULT 0,    -- 1 once daily attendance rows have been materialised
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by)  REFERENCES users(id)    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_requests(employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_status   ON leave_requests(status);
