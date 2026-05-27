// Onse Winkel pay cycle: 21st of one month → 20th of the next; payday = 21st
// of the end month. Returns ISO strings for use against the SQLite `date`
// column (which is stored as YYYY-MM-DD).

const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = (n) => String(n).padStart(2, '0');

function build(startY, startM, endY, endM) {
  return {
    startISO: `${startY}-${pad(startM)}-21`,
    endISO:   `${endY}-${pad(endM)}-20`,
    payDate:  `${endY}-${pad(endM)}-21`,
    label:    `${MS[startM - 1]}-${MS[endM - 1]} ${String(endY).slice(-2)}`,
  };
}

// The pay period that CONTAINS `date`.
export function payPeriodFor(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDate();
  const monthIdx = d.getMonth();             // 0-indexed
  const year = d.getFullYear();
  if (day >= 21) {
    // Start month is the current month; end month is next.
    const endMonth = monthIdx === 11 ? 1 : monthIdx + 2;
    const endYear  = monthIdx === 11 ? year + 1 : year;
    return build(year, monthIdx + 1, endYear, endMonth);
  }
  // End month is the current month; start month is previous.
  const startMonth = monthIdx === 0 ? 12 : monthIdx;
  const startYear  = monthIdx === 0 ? year - 1 : year;
  return build(startYear, startMonth, year, monthIdx + 1);
}

// The pay period immediately BEFORE `date`'s period.
export function previousPayPeriodFor(date = new Date()) {
  const cur = payPeriodFor(date);
  const [sY, sM] = cur.startISO.split('-').map(Number);
  const endMonth = sM;            // previous period's end month = this period's start month
  const endYear  = sY;
  const startMonth = endMonth === 1 ? 12 : endMonth - 1;
  const startYear  = endMonth === 1 ? endYear - 1 : endYear;
  return build(startYear, startMonth, endYear, endMonth);
}

// The full calendar month containing `date` (1st → last day of the month).
export function calendarMonthFor(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const firstDay = `${y}-${pad(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    startISO: firstDay,
    endISO: `${y}-${pad(m)}-${pad(lastDay)}`,
    label: d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }),
  };
}

// Iterate every day between startISO and endISO inclusive, returning ISO strings.
export function daysBetween(startISO, endISO) {
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
