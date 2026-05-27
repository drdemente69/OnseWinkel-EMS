import fs from 'node:fs';
import PDFDocument from 'pdfkit';

const BROWN = '#3d2817';
const BROWN_DARK = '#2a2418';
const CREAM = '#f0ede5';
const ROW_LINE = '#ebe7dc';
const BORDER = '#d8d4cc';
const MUTED = '#5a5240';
const TEXT = '#1a1a1a';
const EMPTY = '#9c9686';

const NUM = (n, d = 0) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const TYPE_LABEL = {
  normal:          'Normal',
  sunday:          'Sunday',
  holiday:         'Holiday',           // legacy
  holiday_worked:  'Holiday (worked)',
  holiday_paid:    'Public holiday',
  public_holiday:  'Public holiday',
  sick:            'Sick leave',
  annual:          'Annual leave',
  unpaid:          'Unpaid',
};

const fmtDate = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDayOfWeek = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-ZA', { weekday: 'short' });
};

// Roll up an attendance row list into totals by category, mirroring the
// payroll engine's grouping so the report stays consistent with payslips.
function summarise(rows) {
  let normal = 0, overtime = 0, holiday = 0, publicHoliday = 0, sick = 0, leave = 0;
  let workDays = 0, totalDailyHours = 0;
  for (const a of rows) {
    const h = Number(a.hours) || 0;
    const ot = Number(a.overtime) || 0;
    if (a.type === 'normal') {
      normal += h; overtime += ot;
      if (h > 0) { workDays++; totalDailyHours += h; }
    } else if (a.type === 'sunday' || a.type === 'holiday' || a.type === 'holiday_worked') {
      holiday += h;
    } else if (a.type === 'holiday_paid' || a.type === 'public_holiday') {
      publicHoliday += h;
    } else if (a.type === 'sick') {
      sick += h;
    } else if (a.type === 'annual' || a.type === 'unpaid') {
      leave += h;
    }
  }
  return { normal, overtime, holiday, publicHoliday, sick, leave,
    workDays, totalDailyHours,
    grandTotal: normal + overtime + holiday + publicHoliday + sick + leave };
}

function drawHeader(doc, leftX, pageWidth, company, period, scope) {
  const headerTop = doc.y;
  // Logo
  if (company?.logoPath && fs.existsSync(company.logoPath)) {
    try {
      doc.save();
      doc.roundedRect(leftX, headerTop, 44, 44, 6).fill('#000');
      doc.image(company.logoPath, leftX, headerTop, { fit: [44, 44] });
      doc.restore();
    } catch {}
  } else {
    doc.save();
    doc.roundedRect(leftX, headerTop, 44, 44, 6).fill(BROWN);
    doc.fill('#fff').font('Helvetica-Bold').fontSize(11).text('OW', leftX + 13, headerTop + 15);
    doc.restore();
  }
  doc.fill(BROWN).font('Helvetica-Bold').fontSize(18)
    .text('ONSE WINKEL', leftX + 56, headerTop, { characterSpacing: 0.4 });
  doc.fill(MUTED).font('Helvetica').fontSize(8.5)
    .text(company?.address || '', leftX + 56, headerTop + 22, { width: pageWidth - 56 - 220 });
  doc.text(`Phone: ${company?.phone || ''}  ·  Email: ${company?.email || ''}`, leftX + 56, doc.y, { width: pageWidth - 56 - 220 });

  doc.font('Helvetica-Bold').fontSize(18).fill(BROWN)
    .text('ATTENDANCE', leftX, headerTop, { align: 'right', characterSpacing: 1.2 });
  doc.font('Helvetica').fontSize(9).fill(MUTED)
    .text(scope, leftX, headerTop + 22, { align: 'right' });
  doc.text(period.label || `${period.startISO} → ${period.endISO}`, leftX, doc.y, { align: 'right' });

  doc.moveTo(leftX, headerTop + 60).lineTo(leftX + pageWidth, headerTop + 60)
    .lineWidth(2.2).strokeColor(BROWN).stroke();
  doc.y = headerTop + 72;
}

function drawEmployeeStrip(doc, leftX, pageWidth, employee, period) {
  const y = doc.y;
  doc.save();
  doc.rect(leftX, y, pageWidth, 38).fill(CREAM);
  doc.fillColor(BROWN_DARK).font('Helvetica-Bold').fontSize(7.5)
    .text('EMPLOYEE', leftX + 10, y + 6, { characterSpacing: 1.1 })
    .text('PERIOD', leftX + pageWidth / 2, y + 6, { characterSpacing: 1.1 });
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(12)
    .text(`${employee.first_name} ${employee.last_name}`, leftX + 10, y + 16);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text(`${employee.position || ''}  ·  #${employee.employee_no || '—'}`, leftX + 10, doc.y);
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(12)
    .text(`${fmtDate(period.startISO)} → ${fmtDate(period.endISO)}`, leftX + pageWidth / 2, y + 16);
  doc.restore();
  doc.y = y + 46;
}

function drawAttendanceTable(doc, leftX, pageWidth, rows) {
  // Columns: Date | Day | Type | Start | End | Lunch | Hours | OT
  // The LUNCH column shows the actual lunch break time range
  // (e.g. "12:00 – 13:00"), replacing the previous BREAK-in-minutes display.
  // Widths sum to 1.00 and give the lunch column enough room for "HH:MM – HH:MM".
  const cols = [
    { key: 'date',   label: 'DATE',  w: 0.15, align: 'left' },
    { key: 'day',    label: 'DAY',   w: 0.07, align: 'left' },
    { key: 'type',   label: 'TYPE',  w: 0.16, align: 'left' },
    { key: 'start',  label: 'START', w: 0.08, align: 'right' },
    { key: 'end',    label: 'END',   w: 0.08, align: 'right' },
    { key: 'lunch',  label: 'LUNCH', w: 0.18, align: 'right' },
    { key: 'hours',  label: 'HOURS', w: 0.13, align: 'right' },
    { key: 'ot',     label: 'OT',    w: 0.15, align: 'right' },
  ];
  const xs = []; let acc = leftX;
  for (const c of cols) { xs.push(acc); acc += pageWidth * c.w; }

  // Header
  let y = doc.y;
  doc.save();
  doc.rect(leftX, y, pageWidth, 18).fill(CREAM);
  doc.fillColor(BROWN_DARK).font('Helvetica-Bold').fontSize(7.5);
  cols.forEach((c, i) => {
    doc.text(c.label, xs[i] + (c.align === 'right' ? 0 : 6), y + 5,
      { width: pageWidth * c.w - 6, align: c.align, characterSpacing: 1.1 });
  });
  doc.moveTo(leftX, y + 18).lineTo(leftX + pageWidth, y + 18).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.restore();
  y += 20;

  // Body
  const rowH = 14;
  doc.font('Helvetica').fontSize(9);
  for (const r of rows) {
    // Page break if running off the bottom margin.
    if (y > doc.page.height - doc.page.margins.bottom - 80) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const empty = !r.hasEntry;
    const lunch = (r.lunch_start && r.lunch_end)
      ? `${r.lunch_start} - ${r.lunch_end}`
      : '–';
    doc.fillColor(empty ? EMPTY : TEXT);
    doc.text(fmtDate(r.date),                        xs[0] + 6, y + 1, { width: pageWidth * cols[0].w - 6 });
    doc.text(fmtDayOfWeek(r.date),                   xs[1] + 6, y + 1, { width: pageWidth * cols[1].w - 6 });
    doc.text(empty ? '—' : (TYPE_LABEL[r.type] || r.type), xs[2] + 6, y + 1, { width: pageWidth * cols[2].w - 6 });
    doc.font('Courier').text(empty ? '–' : (r.start_time || '–'),  xs[3], y + 1, { width: pageWidth * cols[3].w - 6, align: 'right' });
    doc.text(empty ? '–' : (r.end_time || '–'),    xs[4], y + 1, { width: pageWidth * cols[4].w - 6, align: 'right' });
    doc.text(empty ? '–' : lunch,                   xs[5], y + 1, { width: pageWidth * cols[5].w - 6, align: 'right' });
    doc.text(empty ? '–' : NUM(r.hours, 2),         xs[6], y + 1, { width: pageWidth * cols[6].w - 6, align: 'right' });
    doc.text(empty || !r.overtime ? '–' : NUM(r.overtime, 2), xs[7], y + 1, { width: pageWidth * cols[7].w - 6, align: 'right' });
    doc.font('Helvetica').fontSize(9);
    doc.moveTo(leftX, y + rowH).lineTo(leftX + pageWidth, y + rowH).strokeColor(ROW_LINE).lineWidth(0.4).stroke();
    y += rowH;
  }
  doc.y = y + 4;
}

function drawTotals(doc, leftX, pageWidth, totals) {
  const y = doc.y + 6;
  // 7 short labels stacked above their numeric totals. The previous design
  // used wide labels ("SUNDAY/HOLIDAY", "PUBLIC HOL.") with letter-spacing,
  // which wrapped into the line below in narrow cells. Labels are now short
  // and drawn without character spacing so they fit on a single line.
  const boxH = 36;
  doc.save();
  doc.rect(leftX, y, pageWidth, boxH).fill(CREAM);
  const cells = [
    ['Normal',    NUM(totals.normal, 2)],
    ['Overtime',  NUM(totals.overtime, 2)],
    ['Sun/Hol.',  NUM(totals.holiday, 2)],
    ['Pub. hol.', NUM(totals.publicHoliday, 2)],
    ['Sick',      NUM(totals.sick, 2)],
    ['Leave',     NUM(totals.leave, 2)],
    ['Total',     NUM(totals.grandTotal, 2)],
  ];
  const cellW = pageWidth / cells.length;
  cells.forEach((c, i) => {
    const cx = leftX + i * cellW;
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
      .text(c[0].toUpperCase(), cx, y + 5, { width: cellW, align: 'center' });
    doc.fillColor(i === cells.length - 1 ? BROWN : TEXT).font('Helvetica-Bold').fontSize(11)
      .text(c[1], cx, y + 18, { width: cellW, align: 'center' });
  });
  doc.moveTo(leftX, y + boxH).lineTo(leftX + pageWidth, y + boxH)
    .lineWidth(1.5).strokeColor(BROWN).stroke();
  doc.restore();
  doc.y = y + boxH + 8;
}

function drawFooter(doc, leftX, pageWidth, company) {
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text(
    `Generated by Onse Winkel EMS · ${new Date().toISOString().slice(0, 10)}`,
    leftX, doc.page.height - doc.page.margins.bottom - 18,
    { width: pageWidth, align: 'right' },
  );
}

export async function generateAttendancePDF({ outStream, company, period, entries }) {
  // entries: [{ employee, rows }] — rows already filled out with one row per
  // day in the period (entries from DB merged with synthetic blanks).
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
    Title: `Attendance — ${period.label || `${period.startISO}/${period.endISO}`}`,
    Author: company?.name || 'Onse Winkel PTY LTD',
  }});
  doc.pipe(outStream);

  const leftX = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (let i = 0; i < entries.length; i++) {
    const { employee, rows } = entries[i];
    if (i > 0) doc.addPage();
    drawHeader(doc, leftX, pageWidth, company, period,
      entries.length === 1 ? 'Employee attendance' : `Employee ${i + 1} of ${entries.length}`);
    drawEmployeeStrip(doc, leftX, pageWidth, employee, period);
    drawAttendanceTable(doc, leftX, pageWidth, rows);
    drawTotals(doc, leftX, pageWidth, summarise(rows.filter(r => r.hasEntry)));
    drawFooter(doc, leftX, pageWidth, company);
  }
  doc.end();
  return new Promise((resolve, reject) => {
    outStream.on('finish', resolve);
    outStream.on('error', reject);
  });
}
