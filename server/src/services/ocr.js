// ============================================================
// Timesheet OCR pipeline
// ============================================================
// 1. Preprocess the uploaded photo (rotate / upscale / greyscale / contrast).
// 2. Run Tesseract.js with table-friendly page-segmentation mode 6.
// 3. Detect the pay period from the raw text (multiple formats supported).
// 4. Parse free-form lines for day-name / date / start-end times / hours / OT.
// 5. Align parsed rows to every date in the period; flag missing dates as
//    "needs manual entry" so the UI can highlight them in red.
//
// Recognised period formats:
//   "Mar-April 26"             → 21 Mar 2026 → 20 Apr 2026
//   "Mar-Apr 26"               → ditto
//   "March - April 2026"       → ditto
//   "Dec-Jan 26"               → 21 Dec 2025 → 20 Jan 2026 (year wraps)
//   "21/03/26 - 20/04/26"      → explicit ISO dates
//   "April 2026"               → period that ends in April 2026 (Mar-Apr)
//
// All periods follow the Onse Winkel pay cycle: 21st of start month →
// 20th of end month, payday on the 21st of the end month.
// ============================================================

import Tesseract from 'tesseract.js';
import fs from 'node:fs';

let sharp;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['sun','mon','tue','wed','thu','fri','sat'];

const pad = (n) => String(n).padStart(2, '0');
const isoFromYMD = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// ---- Image preprocessing -------------------------------------------------
async function preprocessImage(imagePath) {
  if (!sharp) return imagePath;
  try {
    const buf = await sharp(imagePath)
      .rotate()                                    // auto-rotate from EXIF
      .resize({ width: 2200, withoutEnlargement: false })
      .grayscale()
      .normalise()                                  // stretch contrast
      .sharpen()
      .toBuffer();
    return buf;
  } catch (e) {
    console.warn('[ocr] preprocess failed, using raw image:', e.message);
    return imagePath;
  }
}

// ---- OCR core ------------------------------------------------------------
async function runTesseract(source) {
  // PSM 6 = uniform block of text (works well for tabular timesheets).
  // preserve_interword_spaces helps keep tokens together.
  const result = await Tesseract.recognize(source, 'eng', {
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
  });
  return { text: result.data.text || '', confidence: result.data.confidence || 0 };
}

// ---- Period detection ----------------------------------------------------
export function periodFromMonths(startMonth, endMonth, endYear) {
  let endY = Number(endYear);
  if (endY < 100) endY += 2000;
  const startY = startMonth > endMonth ? endY - 1 : endY;
  const startISO = isoFromYMD(startY, startMonth, 21);
  const endISO = isoFromYMD(endY, endMonth, 20);
  const payDateISO = isoFromYMD(endY, endMonth, 21);
  const label = `${MONTH_SHORT[startMonth - 1]}-${MONTH_SHORT[endMonth - 1]} ${String(endY).slice(-2)}`;
  return { startISO, endISO, payDateISO, label };
}

const MONTH_RX = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export function detectPeriod(rawText) {
  if (!rawText) return null;
  const text = rawText.replace(/[‐-―]/g, '-');

  // Pattern A — "Mar-April 26", "March - April 2026", "Mar to Apr 26"
  let m = text.match(new RegExp(`\\b${MONTH_RX}\\s*[-/]?\\s*(?:-|to)\\s*${MONTH_RX}\\s*(\\d{2,4})`, 'i'));
  if (m) {
    const sm = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const em = MONTHS[m[2].toLowerCase().slice(0, 3)];
    const yr = Number(m[3]);
    if (sm && em && yr) return periodFromMonths(sm, em, yr);
  }

  // Pattern B — explicit date range "21/3/26 - 20/4/26" or "21 Mar 2026 to 20 Apr 2026"
  m = text.match(/(\d{1,2})[\/\-.\s](\d{1,2}|[A-Za-z]+)[\/\-.\s](\d{2,4})\s*(?:-|to|–|—)\s*(\d{1,2})[\/\-.\s](\d{1,2}|[A-Za-z]+)[\/\-.\s](\d{2,4})/);
  if (m) {
    const startD = Number(m[1]);
    const startM = isNaN(Number(m[2])) ? MONTHS[String(m[2]).toLowerCase().slice(0, 3)] : Number(m[2]);
    let startY = Number(m[3]); if (startY < 100) startY += 2000;
    const endD = Number(m[4]);
    const endM = isNaN(Number(m[5])) ? MONTHS[String(m[5]).toLowerCase().slice(0, 3)] : Number(m[5]);
    let endY = Number(m[6]); if (endY < 100) endY += 2000;
    if (startM && endM) {
      return {
        startISO: isoFromYMD(startY, startM, startD),
        endISO: isoFromYMD(endY, endM, endD),
        payDateISO: isoFromYMD(endY, endM, endD + 1),
        label: `${MONTH_SHORT[startM - 1]}-${MONTH_SHORT[endM - 1]} ${String(endY).slice(-2)}`,
      };
    }
  }

  // Pattern C — single month "April 2026" → period that ENDS in that month.
  m = text.match(new RegExp(`\\b${MONTH_RX}\\s+(\\d{2,4})\\b`, 'i'));
  if (m) {
    const em = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const yr = Number(m[2]);
    if (em && yr) {
      const sm = em === 1 ? 12 : em - 1;
      return periodFromMonths(sm, em, yr);
    }
  }

  return null;
}

// Public helper: parse a label like "Mar-April 26" into a period (used when
// the client wants to override).
export function periodFromLabel(label) {
  if (!label) return null;
  return detectPeriod(label);
}

// ---- Token / row parsing -------------------------------------------------
function timeMin(s) {
  const m = /(\d{1,2})[:h.](\d{2})/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseFraction(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[½]$/.test(t)) return 0.5;
  if (/^\d+\s*1\/2$/.test(t)) return Number(t.split(/[\s\/]/)[0]) + 0.5;
  if (/^\d+½$/.test(t)) return Number(t.replace('½', '')) + 0.5;
  const num = parseFloat(t.replace(/[^\d.]/g, ''));
  return isNaN(num) ? null : num;
}

function findDay(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase().replace(/[^a-z]/g, '');
    if (!tok) continue;
    const idx = DAY_SHORT.indexOf(tok.slice(0, 3));
    if (idx >= 0) return { value: DAY_SHORT[idx], full: DAY_FULL[idx], index: i };
  }
  return null;
}

function findTimes(tokens) {
  const out = [];
  for (const t of tokens) {
    let m = /(\d{1,2})[:h.](\d{2})/.exec(t);
    if (m) { out.push(`${pad(Number(m[1]))}:${m[2]}`); continue; }
    m = /^(\d{1,2})(am|pm)$/i.exec(t);
    if (m) {
      let h = Number(m[1]);
      if (m[2].toLowerCase() === 'pm' && h < 12) h += 12;
      if (m[2].toLowerCase() === 'am' && h === 12) h = 0;
      out.push(`${pad(h)}:00`);
    }
  }
  return out;
}

function findExplicitDate(tokens) {
  for (const t of tokens) {
    const m = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(t);
    if (m) {
      return {
        day: Number(m[1]),
        month: Number(m[2]),
        year: m[3] ? Number(m[3]) : null,
      };
    }
  }
  return null;
}

function findBareDayNumber(tokens, dayTokenIndex) {
  // After the day-name, the first bare 1-31 number is likely the day-of-month.
  for (let i = (dayTokenIndex ?? -1) + 1; i < tokens.length; i++) {
    const t = tokens[i].replace(/[^\d]/g, '');
    if (!t) continue;
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= 31) return n;
  }
  return null;
}

function tokenize(line) {
  return line.replace(/\s+/g, ' ').trim().split(' ');
}

function lineLooksLikeRow(line) {
  // A timesheet row contains at least a day name or a date-like token.
  const lower = line.toLowerCase();
  const hasDay = DAY_SHORT.some(d => new RegExp(`\\b${d}`, 'i').test(lower));
  const hasDate = /\d{1,2}[\/\-.]\d{1,2}/.test(line);
  const hasTime = /\d{1,2}[:h.]\d{2}/.test(line);
  return hasDay || hasDate || hasTime;
}

function parseRow(line, periodHint) {
  if (!lineLooksLikeRow(line)) return null;
  const tokens = tokenize(line);
  if (tokens.length < 2) return null;

  const day = findDay(tokens);
  const times = findTimes(tokens);
  const explicitDate = findExplicitDate(tokens);

  // Build candidate date.
  let dateISO = null;
  if (explicitDate) {
    let year = explicitDate.year;
    if (!year && periodHint) {
      // Year inferred from the period: pick whichever of period.start/end falls
      // in the same month as the parsed date.
      const [sY, sM] = periodHint.startISO.split('-').map(Number);
      const [eY, eM] = periodHint.endISO.split('-').map(Number);
      if (explicitDate.month === sM) year = sY;
      else if (explicitDate.month === eM) year = eY;
      else year = eY;
    } else if (!year) {
      year = new Date().getFullYear();
    }
    if (year < 100) year += 2000;
    dateISO = isoFromYMD(year, explicitDate.month, explicitDate.day);
  } else if (day && periodHint) {
    // Without an explicit date, fall back to "first matching day-of-week in
    // the period that we haven't used yet" — but we don't track usage here.
    // Try to lift a bare day-of-month number from the tokens.
    const dom = findBareDayNumber(tokens, day.index);
    if (dom) {
      const [sY, sM] = periodHint.startISO.split('-').map(Number);
      const [eY, eM] = periodHint.endISO.split('-').map(Number);
      // Day numbers 21-31 → start month; 1-20 → end month.
      if (dom >= 21) dateISO = isoFromYMD(sY, sM, dom);
      else dateISO = isoFromYMD(eY, eM, dom);
    }
  }

  const type = day?.value === 'sun' ? 'sunday' : 'normal';

  // Total worked hours derived from start/end. We do NOT assume any break time
  // here — the operator enters break minutes in the review table (default 0).
  let totalFromTimes = 0;
  if (times.length >= 2) {
    const s = timeMin(times[0]), e = timeMin(times[1]);
    if (s != null && e != null && e > s) {
      totalFromTimes = (e - s) / 60;
    }
  }

  // Explicit hours / OT columns from the timesheet (e.g. "8  0" at end of line).
  const numericTokens = tokens.filter(t => !times.some(time => t.startsWith(time.slice(0, 2))));
  const candidateNumbers = [];
  for (const t of numericTokens) {
    if (/^\d{1,2}(?:[.½]\d*)?$/.test(t) || /^½$/.test(t) || /^\d+\s*1\/2$/.test(t) || /^\d+½$/.test(t)) {
      const n = parseFraction(t);
      if (n != null && n <= 24) candidateNumbers.push(n);
    }
  }

  let hours = 0, overtime = 0;
  if (candidateNumbers.length >= 2) {
    // Explicit hours + OT pair from the sheet wins over the time-based guess.
    const [h, ot] = candidateNumbers.slice(-2);
    if (h <= 24 && ot <= 24) { hours = h; overtime = ot; }
  }
  if (hours === 0 && totalFromTimes > 0) {
    // Apply the 8-hour rule: normal day caps at 8, anything beyond is OT.
    if (type === 'normal') {
      hours = Math.round(Math.min(totalFromTimes, 8) * 4) / 4;
      overtime = Math.round(Math.max(0, totalFromTimes - 8) * 4) / 4;
    } else {
      hours = Math.round(totalFromTimes * 4) / 4;
    }
  }
  if (hours === 0 && candidateNumbers.length === 1) {
    hours = candidateNumbers[0];
  }
  let conf = 0.4;
  if (day) conf += 0.15;
  if (dateISO) conf += 0.2;
  if (times.length >= 2) conf += 0.15;
  if (hours > 0) conf += 0.1;
  conf = Math.min(0.99, conf);

  return {
    day: day?.full || null,
    date: dateISO,
    type,
    start: times[0] || null,
    end: times[1] || null,
    breakMin: 0,
    hours: hours || 0,
    overtime: overtime || 0,
    confidence: conf,
    _source: line,
  };
}

function parseAllRows(rawText, periodHint) {
  const lines = (rawText || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length >= 2);
  const out = [];
  for (const line of lines) {
    try {
      const row = parseRow(line, periodHint);
      if (row) out.push(row);
    } catch {}
  }
  return out;
}

// ---- Alignment to period -------------------------------------------------
function buildPeriodSkeleton(period) {
  const start = new Date(period.startISO + 'T00:00:00Z');
  const end = new Date(period.endISO + 'T00:00:00Z');
  const rows = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    rows.push({
      date: iso,
      day: DAY_FULL[dow],
      type: dow === 0 ? 'sunday' : 'normal',
      start: null,
      end: null,
      breakMin: 0,
      hours: 0,
      overtime: 0,
      confidence: 0,
      _needsManualEntry: true,
      _source: null,
    });
  }
  return rows;
}

export function alignRowsToPeriod(parsedRows, period) {
  const skeleton = buildPeriodSkeleton(period);
  for (const parsed of parsedRows) {
    if (!parsed) continue;
    let target = null;
    if (parsed.date) {
      target = skeleton.find(r => r.date === parsed.date);
    } else if (parsed.day) {
      // First unfilled day in the period whose name matches.
      target = skeleton.find(r => r.day === parsed.day && r._needsManualEntry);
    }
    if (target) {
      Object.assign(target, {
        type: parsed.type,
        start: parsed.start,
        end: parsed.end,
        // Default break is 0 — operator enters it explicitly in the review.
        breakMin: Number(parsed.breakMin) || 0,
        hours: parsed.hours,
        overtime: parsed.overtime,
        confidence: parsed.confidence,
        _needsManualEntry: parsed.confidence < 0.6 || (!parsed.start && !parsed.hours),
        _source: parsed._source,
      });
    }
  }
  return skeleton;
}

// ---- Public entry point --------------------------------------------------
export async function processTimesheet(imagePath, options = {}) {
  const source = await preprocessImage(imagePath);
  const ocr = await runTesseract(source);

  // Employee name (best-effort).
  let employeeName = null;
  const nm = /name\s*[:\-]?\s*([A-Za-z][A-Za-z .'\-]{2,})/i.exec(ocr.text);
  if (nm) employeeName = nm[1].trim().replace(/\s+/g, ' ');

  // Period: caller hint wins, otherwise detect from text.
  let period = options.periodHint || detectPeriod(ocr.text);
  let parsed = parseAllRows(ocr.text, period);
  let rows;
  if (period) {
    rows = alignRowsToPeriod(parsed, period);
  } else {
    rows = parsed.map(r => ({
      ...r,
      _needsManualEntry: !r.date || r.confidence < 0.6,
    }));
  }

  return {
    rawText: ocr.text,
    overallConfidence: ocr.confidence / 100,
    employeeName,
    period,
    rows,
  };
}

// ---- Synthetic sample (used for the demo button and as a fallback) -------
// If a period is supplied, the sample data is mapped onto the LAST 8 working
// days of that period so the demo always lands inside the user's chosen
// window. Otherwise it falls back to Mar-Apr 26.
const SAMPLE_PATTERN = [
  { hours: 8, start: '08:00', end: '16:00', breakMin: 0, confidence: 0.96 },
  { hours: 8, start: '08:00', end: '16:00', breakMin: 0, confidence: 0.94 },
  { hours: 8, start: '07:30', end: '17:00', overtime: 1.5, breakMin: 0, confidence: 0.81 },
  { hours: 8, start: '08:00', end: '16:00', breakMin: 0, confidence: 0.92 },
  { hours: 8, start: '08:00', end: '16:30', overtime: 0.5, breakMin: 0, confidence: 0.74 },
  { hours: 5, start: '08:00', end: '13:00', breakMin: 0, confidence: 0.88 },
  { hours: 7, start: '09:00', end: '16:00', breakMin: 0, type: 'sunday', confidence: 0.69 },
  { hours: 8, start: '08:00', end: '16:00', breakMin: 0, confidence: 0.95 },
];

export function syntheticSampleRows(periodHint = null) {
  const period = periodHint || periodFromMonths(3, 4, 26);
  const skeleton = buildPeriodSkeleton(period);
  // Fill the last N dates of the period with the sample pattern.
  const N = SAMPLE_PATTERN.length;
  const startIdx = Math.max(0, skeleton.length - N);
  for (let i = 0; i < N && startIdx + i < skeleton.length; i++) {
    const fill = SAMPLE_PATTERN[i];
    Object.assign(skeleton[startIdx + i], fill, { _needsManualEntry: fill.confidence < 0.6 });
  }
  return {
    rawText: '[synthetic sample]',
    overallConfidence: 0.87,
    employeeName: 'Cedrick Fredericks',
    period,
    rows: skeleton,
  };
}
