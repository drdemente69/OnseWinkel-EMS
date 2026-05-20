// Shared time / hour helpers.
//
// Onse Winkel pay rule:
//   - Normal days: anything up to 8 worked hours is "normal", anything above
//     is overtime (paid at 1.5×).
//   - Sunday / Holiday: every hour is paid at 2×; no overtime split.
//   - Sick / Annual / Unpaid: hours stay in the `hours` field as entered.
//
// All numeric results are rounded to the nearest 0.25 hour to match what
// timesheets typically record (8 h, 8.25 h, 8.5 h, …).

export const round25 = (n) => Math.round(Number(n || 0) * 4) / 4;

function parseTime(t) {
  if (!t) return null;
  const m = /^(\d{1,2})[:.](\d{1,2})/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// Returns total worked minutes from a start/end pair minus the break, or
// null if the times are invalid.
export function workedMinutes(start, end, breakMin = 0) {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s == null || e == null) return null;
  let span = e - s;
  if (span <= 0) return null;
  span -= Number(breakMin) || 0;
  return Math.max(0, span);
}

// True if the given day-type uses start/end times.
export function typeUsesTimes(type) {
  return type === 'normal' || type === 'sunday' || type === 'holiday' || type === 'holiday_worked';
}

// The headline helper: given a row's start/end/break/type, return the
// { hours, overtime } that should be stored on it.
export function splitHoursFromTimes({ start, end, breakMin = 0, type = 'normal' }) {
  // Public holiday (paid off) is hours-by-policy, not derived from times.
  if (type === 'holiday_paid' || type === 'public_holiday') {
    return { hours: 0, overtime: 0, paidOff: true };
  }
  const mins = workedMinutes(start, end, breakMin);
  if (mins == null) return { hours: 0, overtime: 0 };
  const total = mins / 60;
  // Only "normal" working days split at 8 hours. Worked holiday / Sunday
  // shifts go entirely to `hours` (paid at the holiday rate).
  if (type === 'normal') {
    return {
      hours: round25(Math.min(total, 8)),
      overtime: round25(Math.max(0, total - 8)),
    };
  }
  return { hours: round25(total), overtime: 0 };
}
