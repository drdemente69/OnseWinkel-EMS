// Onse Winkel pay period: 21st of one month → 20th of the next.
//
// payPeriodFor(date) returns the period that *contains* the given date.
//   - If date is on or after the 21st: period runs date.month/21 → next/20
//   - Otherwise: period runs (date.month - 1)/21 → date.month/20
//
// Helpers return both ISO strings (yyyy-mm-dd) for API calls and Date objects
// for calendar math.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function payPeriodFor(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  const day = d.getDate();
  const startMonth = day >= 21
    ? new Date(d.getFullYear(), d.getMonth(), 21)
    : new Date(d.getFullYear(), d.getMonth() - 1, 21);
  const endMonth = new Date(startMonth.getFullYear(), startMonth.getMonth() + 1, 20);
  return {
    start: startMonth,
    end: endMonth,
    startISO: iso(startMonth),
    endISO: iso(endMonth),
    label: periodLabel(startMonth, endMonth),
    payDate: iso(new Date(endMonth.getFullYear(), endMonth.getMonth(), endMonth.getDate() + 1)),
  };
}

export function shiftPayPeriod(period, delta) {
  const next = new Date(period.start.getFullYear(), period.start.getMonth() + delta, 21);
  return payPeriodFor(next);
}

export function periodLabel(start, end) {
  const opts = { month: 'short', year: '2-digit' };
  const a = start.toLocaleDateString('en-ZA', opts);
  const b = end.toLocaleDateString('en-ZA', opts);
  // "Apr-May 26" if same year, otherwise "Dec 25 - Jan 26"
  const aMonth = start.toLocaleDateString('en-ZA', { month: 'short' });
  const bMonth = end.toLocaleDateString('en-ZA', { month: 'short' });
  const aYear = String(start.getFullYear()).slice(-2);
  const bYear = String(end.getFullYear()).slice(-2);
  if (aYear === bYear) return `${aMonth}-${bMonth} ${bYear}`;
  return `${aMonth} ${aYear} – ${bMonth} ${bYear}`;
}

export function isWithinPeriod(dateISO, period) {
  return dateISO >= period.startISO && dateISO <= period.endISO;
}

// "Mar-April 26" / "Mar-Apr 26" / "March - April 2026" → period object.
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function periodFromMonths(startMonth, endMonth, endYear) {
  let endY = Number(endYear);
  if (endY < 100) endY += 2000;
  const startY = startMonth > endMonth ? endY - 1 : endY;
  return {
    start: new Date(startY, startMonth - 1, 21),
    end: new Date(endY, endMonth - 1, 20),
    startISO: `${startY}-${pad(startMonth)}-21`,
    endISO: `${endY}-${pad(endMonth)}-20`,
    payDate: `${endY}-${pad(endMonth)}-21`,
    label: `${MS[startMonth - 1]}-${MS[endMonth - 1]} ${String(endY).slice(-2)}`,
  };
}

const MONTH_RX = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export function periodFromLabel(input) {
  if (!input) return null;
  const text = String(input).replace(/[‐-―]/g, '-');
  let m = text.match(new RegExp(`\\b${MONTH_RX}\\s*(?:-|to)\\s*${MONTH_RX}\\s*(\\d{2,4})`, 'i'));
  if (m) {
    const sm = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const em = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (sm && em) return periodFromMonths(sm, em, Number(m[3]));
  }
  // Single month "April 2026" → period that ends in that month.
  m = text.match(new RegExp(`\\b${MONTH_RX}\\s+(\\d{2,4})\\b`, 'i'));
  if (m) {
    const em = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (em) {
      const sm = em === 1 ? 12 : em - 1;
      return periodFromMonths(sm, em, Number(m[2]));
    }
  }
  return null;
}
