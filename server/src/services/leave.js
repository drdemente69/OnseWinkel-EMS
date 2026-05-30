// ============================================================
// Leave Approval — business logic
// ============================================================
//
// Working day rules (from owner spec):
//   1. Skip Sundays.
//   2. Skip days the employee already has marked as holiday_paid /
//      holiday_worked / holiday in attendance (a public holiday for them).
//   3. Skip days the employee already worked (attendance.type = 'normal'
//      with hours > 0) — worked time always wins over leave.
//
// Maternity + Parental are SPAN-ONLY: we record the leave_requests row but
// do NOT write per-day attendance rows. Reports read directly from
// leave_requests for those.
//
// All other types (annual, sick, family, unpaid, study, compassionate) write
// one attendance row per applicable working day with hours = avg daily hours
// so payroll can pay them at the normal rate.

import db from '../db.js';
import { daysBetween } from './periods.js';

export const LEAVE_TYPES = [
  'annual', 'sick', 'family', 'maternity', 'parental',
  'unpaid', 'study', 'compassionate',
];

// Leave types for which we materialise daily attendance rows.
export const ATTENDANCE_WRITING_TYPES = new Set([
  'annual', 'sick', 'family', 'unpaid', 'study', 'compassionate',
]);

// Maps a leave_type onto the attendance.type stored on each day.
// Parental leave is statutorily UNPAID by the employer (UIF claim) so it
// maps to 'unpaid', not 'annual'.
export function attendanceTypeFor(leaveType) {
  switch (leaveType) {
    case 'annual':        return 'annual';
    case 'sick':          return 'sick';
    case 'family':        return 'annual';     // paid at normal rate (BCEA § 27)
    case 'compassionate': return 'annual';     // paid at normal rate (company policy)
    case 'parental':      return 'unpaid';     // unpaid by employer; employee claims UIF (§ 25A)
    case 'unpaid':        return 'unpaid';
    case 'study':         return 'unpaid';
    default:              return 'annual';
  }
}

export function getEntitlements() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'leave_entitlements'`).get();
  const defaults = {
    annual_days: 18, sick_days_per_year: 10, sick_cycle_years: 3,
    family_days: 3, parental_days: 10, maternity_months: 4,
    compassionate_days: 3, study_days: 0,
  };
  if (!row) return defaults;
  try { return { ...defaults, ...JSON.parse(row.value) }; }
  catch { return defaults; }
}

// Compute the per-employee average daily hours from their existing normal-day
// attendance over the last 60 days. Falls back to 8 if no data.
export function avgDailyHoursFor(employeeId) {
  const row = db.prepare(`
    SELECT AVG(hours) AS avg FROM attendance
    WHERE employee_id = ?
      AND type = 'normal' AND hours > 0
      AND date >= date('now', '-60 days')`).get(employeeId);
  const avg = Number(row?.avg) || 0;
  return avg > 0 ? Math.round(avg * 4) / 4 : 8;
}

// Inspect every day in [startISO, endISO] and decide whether it should be
// included in the leave. Returns:
//   { applicable: [iso, ...], skipped: { sundays, holidays, worked } }
//
// `excludeLeaveRequestId` lets a re-evaluation skip attendance rows that this
// very leave request itself created previously (so editing a request doesn't
// see its own writes as "already worked").
export function classifyRange(employeeId, startISO, endISO, excludeLeaveRequestId = null) {
  const dates = daysBetween(startISO, endISO);
  if (dates.length === 0) {
    return { applicable: [], skipped: { sundays: [], holidays: [], worked: [] } };
  }
  const placeholders = dates.map(() => '?').join(',');
  const existing = db.prepare(`SELECT date, type, hours, note FROM attendance
    WHERE employee_id = ? AND date IN (${placeholders})`).all(employeeId, ...dates);
  const byDate = new Map(existing.map(r => [r.date, r]));
  const ownNotePrefix = excludeLeaveRequestId ? `Leave#${excludeLeaveRequestId}` : null;

  const skipped = { sundays: [], holidays: [], worked: [] };
  const applicable = [];
  for (const iso of dates) {
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (dow === 0) { skipped.sundays.push(iso); continue; }
    const row = byDate.get(iso);
    if (row) {
      const t = row.type;
      if (t === 'holiday' || t === 'holiday_paid' || t === 'holiday_worked' || t === 'sunday') {
        skipped.holidays.push(iso);
        continue;
      }
      // Skip days already worked (preserve the worked entry).
      // BUT if this row is one this leave previously wrote, treat it as
      // applicable so re-approval still covers the same span.
      const isOwn = ownNotePrefix && row.note && row.note.startsWith(ownNotePrefix);
      if (!isOwn && t === 'normal' && Number(row.hours) > 0) {
        skipped.worked.push(iso);
        continue;
      }
    }
    applicable.push(iso);
  }
  return { applicable, skipped };
}

// Write daily attendance rows for an APPROVED leave request that materialises
// attendance (i.e. NOT maternity/parental).
export function writeAttendanceForLeave(req) {
  if (!ATTENDANCE_WRITING_TYPES.has(req.leave_type)) return { written: 0, skipped: 0 };
  const { applicable, skipped } = classifyRange(req.employee_id, req.start_date, req.end_date, req.id);
  const avgDaily = avgDailyHoursFor(req.employee_id);
  const type = attendanceTypeFor(req.leave_type);
  const note = `Leave#${req.id}: ${req.leave_type}${req.sub_reason ? ' (' + req.sub_reason + ')' : ''}`;
  const stmt = db.prepare(`INSERT INTO attendance
    (employee_id, date, type, start_time, end_time, break_min, hours, overtime, note)
    VALUES (?, ?, ?, NULL, NULL, 0, ?, 0, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      type = excluded.type,
      hours = excluded.hours,
      overtime = 0,
      break_min = 0,
      start_time = NULL,
      end_time = NULL,
      note = excluded.note,
      updated_at = datetime('now')`);
  const tx = db.transaction(() => {
    for (const d of applicable) stmt.run(req.employee_id, d, type, avgDaily, note);
    db.prepare(`UPDATE leave_requests
      SET days_count = ?, attendance_written = 1, skipped_dates = ?
      WHERE id = ?`).run(
        applicable.length,
        JSON.stringify(skipped),
        req.id,
      );
  });
  tx();
  return { written: applicable.length, skippedCount: skipped.sundays.length + skipped.holidays.length + skipped.worked.length };
}

// Remove the daily attendance rows previously written for this leave request.
// Identifies them by the `Leave#<id>:` note prefix.
export function rollbackAttendanceForLeave(reqId) {
  const r = db.prepare(`DELETE FROM attendance WHERE note LIKE ?`).run(`Leave#${reqId}:%`);
  db.prepare(`UPDATE leave_requests SET attendance_written = 0 WHERE id = ?`).run(reqId);
  return { removed: r.changes };
}

// ----- Balances ---------------------------------------------------------

// Cycle window for annual + family + maternity + parental: rolling 12 months
// ending on the employee's hire-date anniversary. For employees without a
// hire date, we fall back to the calendar year.
function annualCycleWindow(employee, now = new Date()) {
  const hire = employee.date_employed ? new Date(employee.date_employed) : null;
  if (!hire || isNaN(hire)) {
    const y = now.getFullYear();
    return { startISO: `${y}-01-01`, endISO: `${y}-12-31` };
  }
  // Find the most recent anniversary on or before `now`.
  let anniv = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
  if (anniv > now) anniv.setFullYear(anniv.getFullYear() - 1);
  const cycleStart = anniv;
  const cycleEnd = new Date(anniv);
  cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
  cycleEnd.setDate(cycleEnd.getDate() - 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { startISO: fmt(cycleStart), endISO: fmt(cycleEnd) };
}

// Sick leave runs on a rolling 3-year window from today.
function sickWindow(years = 3, now = new Date()) {
  const end = now;
  const start = new Date(now.getFullYear() - years, now.getMonth(), now.getDate() + 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { startISO: fmt(start), endISO: fmt(end) };
}

// Returns { annual, sick, family, parental, maternity } each as { used, allowed, left, cycleEnd }.
export function computeBalancesFor(employee) {
  const ent = getEntitlements();
  const cycle = annualCycleWindow(employee);
  const sick = sickWindow(ent.sick_cycle_years || 3);

  // Sum days_count of approved requests within the window.
  const sumDays = (type, fromISO, toISO) => {
    const row = db.prepare(`SELECT COALESCE(SUM(days_count), 0) AS d
      FROM leave_requests
      WHERE employee_id = ? AND leave_type = ? AND status = 'approved'
        AND start_date <= ? AND end_date >= ?`)
      .get(employee.id, type, toISO, fromISO);
    return Number(row?.d) || 0;
  };

  // Maternity/parental: count requests within the cycle, not day counts.
  const countSpans = (type, fromISO, toISO) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM leave_requests
      WHERE employee_id = ? AND leave_type = ? AND status = 'approved'
        AND start_date <= ? AND end_date >= ?`)
      .get(employee.id, type, toISO, fromISO);
    return Number(row?.n) || 0;
  };

  return {
    cycle, sick_window: sick,
    annual: {
      used: sumDays('annual', cycle.startISO, cycle.endISO),
      allowed: ent.annual_days,
      get left() { return Math.max(0, this.allowed - this.used); },
    },
    sick: {
      used: sumDays('sick', sick.startISO, sick.endISO),
      allowed: (ent.sick_days_per_year || 10) * (ent.sick_cycle_years || 3),
      get left() { return Math.max(0, this.allowed - this.used); },
    },
    family: {
      used: sumDays('family', cycle.startISO, cycle.endISO),
      allowed: ent.family_days,
      get left() { return Math.max(0, this.allowed - this.used); },
    },
    parental: {
      used: countSpans('parental', cycle.startISO, cycle.endISO) > 0 ? ent.parental_days : 0,
      allowed: ent.parental_days,
      get left() { return Math.max(0, this.allowed - this.used); },
    },
    maternity: {
      used: countSpans('maternity', cycle.startISO, cycle.endISO),
      allowed: 1,                       // one maternity span per cycle
      get left() { return Math.max(0, this.allowed - this.used); },
      months: ent.maternity_months,
    },
    compassionate: {
      used: sumDays('compassionate', cycle.startISO, cycle.endISO),
      allowed: ent.compassionate_days,
      get left() { return Math.max(0, this.allowed - this.used); },
    },
  };
}

// Convenience for serialising balances over JSON (drops the getters).
export function serialiseBalances(b) {
  const flat = (x) => ({ used: x.used, allowed: x.allowed, left: x.left, ...(x.months ? { months: x.months } : {}) });
  return {
    cycle: b.cycle,
    sick_window: b.sick_window,
    annual: flat(b.annual),
    sick: flat(b.sick),
    family: flat(b.family),
    parental: flat(b.parental),
    maternity: flat(b.maternity),
    compassionate: flat(b.compassionate),
  };
}
