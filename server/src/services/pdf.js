import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { ytdForEmployee } from './payroll.js';
import { resolveLogoPath } from './logo.js';

const BROWN = '#3d2817';
const BROWN_DARK = '#2a2418';
const CREAM = '#f0ede5';
const CREAM_DEEP = '#f6f3e8';
const BORDER = '#d8d4cc';
const ROW_LINE = '#ebe7dc';
const MUTED = '#5a5240';
const EMPTY = '#9c9686';
const TEXT = '#1a1a1a';

const ZAR = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return `${sign}R${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const NUM = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDateShort = (iso) => {
  const dt = new Date(iso);
  if (isNaN(dt)) return '–';
  return dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
};

export async function generatePayslipPDF({ outPath, employee, payslip, priorSlips, company }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
    Title: `Payslip ${payslip.id}`,
    Author: company?.name || 'Onse Winkel PTY LTD',
    Subject: `${employee.first_name} ${employee.last_name} · ${payslip.period_label}`,
  }});
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;

  // ===== Header =====
  const headerTop = doc.y;
  // Logo — resolve via the portable helper so any reasonable settings
  // value still finds the file (absolute path on the seed host, basename
  // on AWS, or just the data/logo.* fallback).
  const logoPath = resolveLogoPath(company?.logoPath);
  if (logoPath) {
    try {
      doc.save();
      // Solid black rounded rect bg
      doc.roundedRect(leftX, headerTop, 44, 44, 6).fill('#000');
      doc.image(logoPath, leftX, headerTop, { fit: [44, 44] });
      doc.restore();
    } catch (e) { /* ignore unsupported logo formats */ }
  } else {
    doc.save();
    doc.roundedRect(leftX, headerTop, 44, 44, 6).fill(BROWN);
    doc.fill('#fff').fontSize(11).font('Helvetica-Bold').text('OW', leftX + 13, headerTop + 15);
    doc.restore();
  }
  doc.fill(BROWN).font('Helvetica-Bold').fontSize(18).text('ONSE WINKEL', leftX + 56, headerTop, { characterSpacing: 0.4 });
  doc.fill(MUTED).font('Helvetica').fontSize(8.5)
    .text(company?.address || '', leftX + 56, headerTop + 22, { width: pageWidth - 56 - 200 });
  doc.text(`Phone: ${company?.phone || ''}  ·  Email: ${company?.email || ''}`, leftX + 56, doc.y, { width: pageWidth - 56 - 200 });

  doc.font('Helvetica-Bold').fontSize(20).fill(BROWN)
    .text('PAYSLIP', leftX, headerTop, { align: 'right', characterSpacing: 1.5 });
  doc.font('Courier').fontSize(8.5).fill(MUTED)
    .text(`Ref: ${(payslip.id || '').toUpperCase()}`, leftX, headerTop + 26, { align: 'right' });

  // Brown rule line
  doc.moveTo(leftX, headerTop + 60).lineTo(leftX + pageWidth, headerTop + 60)
    .lineWidth(2.2).strokeColor(BROWN).stroke();

  doc.y = headerTop + 72;

  // ===== Employee info table =====
  drawInfoTable(doc, leftX, doc.y, pageWidth, [
    [
      { label: 'EMPLOYEE INFORMATION', width: 0.4, body: [
        { text: `${employee.first_name} ${employee.last_name}`, bold: true, color: BROWN, size: 11 },
        { text: employee.position || '', color: MUTED, size: 9 },
      ]},
      { label: 'PAY DATE', width: 0.2, body: [{ text: fmtDateShort(payslip.pay_date), mono: true }] },
      { label: 'PAY TYPE', width: 0.2, body: [{ text: 'Monthly' }] },
      { label: 'PERIOD', width: 0.2, body: [{ text: payslip.period_label, bold: true }] },
    ],
  ]);

  doc.moveDown(0.4);

  drawInfoTable(doc, leftX, doc.y, pageWidth, [
    [
      { label: 'PAYROLL #', width: 1/3, body: [{ text: employee.employee_no || '', mono: true }] },
      { label: 'ID NUMBER', width: 1/3, body: [{ text: employee.id_number || '——', mono: true }] },
      { label: 'TAX CODE',  width: 1/3, body: [{ text: employee.tax_code || '——', mono: true }] },
    ],
  ]);

  // Payment row
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Payment Method: ', leftX, doc.y + 4, { continued: true });
  doc.font('Helvetica-Bold').fillColor(BROWN).text(employee.payment_method || '—', { continued: true });
  doc.font('Helvetica').fillColor(MUTED).text('    Bank: ', { continued: true });
  doc.font('Helvetica-Bold').fillColor(TEXT).text(`${employee.bank || ''} `, { continued: true });
  doc.font('Courier').fillColor(MUTED).text(employee.bank_account || '');
  doc.moveTo(leftX, doc.y + 4).lineTo(leftX + pageWidth, doc.y + 4).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.y += 12;

  // ===== Earnings =====
  drawSectionHead(doc, leftX, doc.y, pageWidth, 'Earnings');
  const ytd = ytdForEmployee(employee, priorSlips);

  const w = Number(payslip.hourly_wage || employee.hourly_wage || 0);
  const publicHoliday = Number(payslip.public_holiday_pay) || 0;
  const annual = Number(payslip.annual_pay) || 0;
  const sick = Number(payslip.sick_pay) || 0;
  const earnRows = [
    { label: 'Standard Pay',         hours: payslip.normal_hours,        rate: w,       current: payslip.normal_pay,        ytd: ytd.normal },
    { label: 'Overtime Pay',         hours: payslip.overtime_hours,      rate: w * 1.5, current: payslip.overtime_pay,      ytd: ytd.overtime },
    { label: 'Sunday & Holiday Pay', hours: payslip.holiday_hours,       rate: w * 2,   current: payslip.holiday_pay,       ytd: ytd.holiday },
    {
      label: 'Public Holiday Pay',
      hours: payslip.public_holiday_hours,
      rate: w,
      current: publicHoliday,
      ytd: ytd.publicHoliday,
      empty: !publicHoliday,
    },
    {
      label: 'Annual Leave Pay',
      hours: payslip.annual_hours,
      rate: w,
      current: annual,
      ytd: ytd.annual,
      empty: !annual,
    },
    { label: 'Sick Pay', hours: payslip.sick_hours, rate: w, current: sick, ytd: ytd.sick, empty: !sick },
    {
      label: 'Commission and Bonus',
      current: (Number(payslip.commission) || 0) + (Number(payslip.bonus) || 0),
      ytd: ytd.commission + ytd.bonus,
      empty: !(Number(payslip.commission) || Number(payslip.bonus)),
    },
  ];

  drawEarningsTable(doc, leftX, doc.y, pageWidth, earnRows, payslip, ytd);

  // ===== Deductions =====
  doc.moveDown(0.4);
  drawSectionHead(doc, leftX, doc.y, pageWidth, 'Deductions');
  const dedRows = [
    { label: 'PAYE Tax',                 empty: !(Number(payslip.paye) > 0), current: payslip.paye },
    { label: 'UIF',                      current: payslip.uif,   ytd: ytd.uif },
    { label: 'Student Loan Repayment',   empty: true },
    { label: 'Pension',                  empty: true },
    { label: 'Union Fees',               empty: true },
  ];
  drawDeductionsTable(doc, leftX, doc.y, pageWidth, dedRows, payslip, ytd);

  // ===== Net pay panel =====
  doc.moveDown(0.6);
  const npY = doc.y;
  doc.save();
  doc.roundedRect(leftX, npY, pageWidth, 56, 4).fill(BROWN);
  doc.fillColor(CREAM_DEEP).font('Helvetica').fontSize(8).text('NET PAY', leftX + 14, npY + 10, { characterSpacing: 1.2 });
  doc.font('Helvetica-Bold').fontSize(22).fillColor(CREAM_DEEP).text(ZAR(payslip.net), leftX + 14, npY + 22);
  doc.font('Helvetica').fontSize(8).fillColor(CREAM_DEEP).text('YEAR TO DATE · NET', leftX, npY + 10, { width: pageWidth - 14, align: 'right', characterSpacing: 1.2 });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(CREAM_DEEP).text(ZAR(ytd.net), leftX, npY + 26, { width: pageWidth - 14, align: 'right' });
  doc.restore();
  doc.y = npY + 70;

  // Footer
  doc.moveTo(leftX, doc.y).lineTo(leftX + pageWidth, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.y += 8;
  const footY = doc.y;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('If you have any questions about this payslip, please contact:', leftX, footY, { width: pageWidth - 200 });
  doc.font('Helvetica-Bold').fillColor(BROWN)
    .text(`${company?.contact || ''}`, leftX, doc.y, { continued: true });
  doc.font('Helvetica').fillColor(MUTED)
    .text(` · ${company?.contactPhone || ''} · ${company?.email || ''}`);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('Generated by Onse Winkel EMS', leftX, footY, { width: pageWidth, align: 'right' });
  doc.font('Courier').text(new Date().toISOString().slice(0, 10), leftX, doc.y, { width: pageWidth, align: 'right' });

  doc.end();
  return new Promise((res, rej) => {
    stream.on('finish', res);
    stream.on('error', rej);
  });
}

function drawSectionHead(doc, x, y, width, label) {
  doc.save();
  doc.rect(x, y, width, 18).fill(BROWN_DARK);
  doc.fillColor(CREAM).font('Helvetica-Bold').fontSize(8.5)
    .text(label.toUpperCase(), x + 8, y + 5, { characterSpacing: 1.4, width });
  doc.restore();
  doc.y = y + 22;
}

function drawInfoTable(doc, x, y, width, rows) {
  const headerH = 16;
  const bodyH = 30;
  let cursorX = x;
  doc.save();
  // Header (rule line bottom)
  for (const row of rows) {
    let cx = x;
    for (const cell of row) {
      const w = width * cell.width;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BROWN_DARK)
        .text(cell.label, cx + 4, y + 2, { width: w - 8, characterSpacing: 1.1 });
      cx += w;
    }
    doc.moveTo(x, y + headerH).lineTo(x + width, y + headerH).lineWidth(1).strokeColor(BROWN_DARK).stroke();

    cx = x;
    for (const cell of row) {
      const w = width * cell.width;
      let by = y + headerH + 4;
      for (const line of cell.body) {
        doc.font(line.bold ? 'Helvetica-Bold' : line.mono ? 'Courier' : 'Helvetica')
          .fontSize(line.size || 10).fillColor(line.color || TEXT)
          .text(line.text, cx + 4, by, { width: w - 8 });
        by = doc.y;
      }
      cx += w;
    }
    doc.moveTo(x, y + headerH + bodyH).lineTo(x + width, y + headerH + bodyH).lineWidth(0.5).strokeColor(BORDER).stroke();
  }
  doc.restore();
  doc.y = y + headerH + bodyH + 4;
}

function drawEarningsTable(doc, x, y, width, rows, payslip, ytd) {
  const colWidths = [width * 0.38, width * 0.155, width * 0.155, width * 0.155, width * 0.155];
  const colXs = [x, x + colWidths[0], x + colWidths[0] + colWidths[1], x + colWidths[0] + colWidths[1] + colWidths[2], x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3]];

  // Header bar
  doc.save();
  doc.rect(x, y, width, 16).fill(CREAM);
  doc.fillColor(BROWN_DARK).font('Helvetica-Bold').fontSize(7.5);
  doc.text('DESCRIPTION', colXs[0] + 4, y + 4, { width: colWidths[0] - 8, characterSpacing: 1.1 });
  for (const [i, label] of [[1,'HOURS'],[2,'RATE'],[3,'CURRENT'],[4,'YTD']]) {
    doc.text(label, colXs[i], y + 4, { width: colWidths[i] - 8, align: 'right', characterSpacing: 1.1 });
  }
  doc.moveTo(x, y + 16).lineTo(x + width, y + 16).lineWidth(0.5).strokeColor(BORDER).stroke();
  doc.restore();

  let cy = y + 18;
  for (const r of rows) {
    drawEarnRow(doc, colXs, colWidths, cy, r);
    cy += 16;
  }
  // Gross pay row
  doc.save();
  doc.rect(x, cy, width, 22).fill(CREAM);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BROWN);
  doc.text('GROSS PAY', colXs[0] + 4, cy + 7, { width: colWidths[0] - 8, characterSpacing: 0.5 });
  doc.font('Courier-Bold').fontSize(10).fillColor(BROWN);
  doc.text(ZAR(payslip.gross), colXs[3], cy + 6, { width: colWidths[3] - 4, align: 'right' });
  doc.text(ZAR(ytd.gross),     colXs[4], cy + 6, { width: colWidths[4] - 4, align: 'right' });
  doc.moveTo(x, cy + 22).lineTo(x + width, cy + 22).lineWidth(1.5).strokeColor(BROWN).stroke();
  doc.restore();
  doc.y = cy + 24;
}

function drawEarnRow(doc, colXs, colWidths, y, r) {
  doc.save();
  doc.font('Helvetica').fontSize(9).fillColor(r.empty ? EMPTY : TEXT);
  doc.text(r.label, colXs[0] + 4, y + 3, { width: colWidths[0] - 8 });
  doc.font('Courier').fontSize(9).fillColor(r.empty ? EMPTY : '#3a3a3a');
  doc.text(r.empty ? '–' : NUM(r.hours, 0), colXs[1], y + 3, { width: colWidths[1] - 4, align: 'right' });
  doc.text(r.empty ? '–' : (r.rate ? r.rate.toFixed(2) : '–'), colXs[2], y + 3, { width: colWidths[2] - 4, align: 'right' });
  doc.font(r.empty ? 'Courier' : 'Courier-Bold').fillColor(r.empty ? EMPTY : TEXT);
  doc.text(r.empty ? '–' : ZAR(r.current || 0), colXs[3], y + 3, { width: colWidths[3] - 4, align: 'right' });
  doc.font('Courier').fillColor(r.empty ? EMPTY : TEXT);
  doc.text(r.empty ? '–' : ZAR(r.ytd || 0), colXs[4], y + 3, { width: colWidths[4] - 4, align: 'right' });
  doc.moveTo(colXs[0], y + 14).lineTo(colXs[4] + colWidths[4], y + 14).lineWidth(0.4).strokeColor(ROW_LINE).stroke();
  doc.restore();
}

function drawDeductionsTable(doc, x, y, width, rows, payslip, ytd) {
  const colWidths = [width * 0.38, width * 0.31, width * 0.155, width * 0.155];
  const colXs = [x, x + colWidths[0], x + colWidths[0] + colWidths[1], x + colWidths[0] + colWidths[1] + colWidths[2]];

  doc.save();
  doc.rect(x, y, width, 16).fill(CREAM);
  doc.fillColor(BROWN_DARK).font('Helvetica-Bold').fontSize(7.5);
  doc.text('DESCRIPTION', colXs[0] + 4, y + 4, { width: colWidths[0] - 8, characterSpacing: 1.1 });
  doc.text('CURRENT', colXs[2], y + 4, { width: colWidths[2] - 4, align: 'right', characterSpacing: 1.1 });
  doc.text('YTD',     colXs[3], y + 4, { width: colWidths[3] - 4, align: 'right', characterSpacing: 1.1 });
  doc.moveTo(x, y + 16).lineTo(x + width, y + 16).lineWidth(0.5).strokeColor(BORDER).stroke();
  doc.restore();

  let cy = y + 18;
  for (const r of rows) {
    doc.save();
    doc.font('Helvetica').fontSize(9).fillColor(r.empty ? EMPTY : TEXT);
    doc.text(r.label, colXs[0] + 4, cy + 3, { width: colWidths[0] - 8 });
    doc.font(r.empty ? 'Courier' : 'Courier-Bold').fillColor(r.empty ? EMPTY : TEXT);
    doc.text(r.empty ? '–' : (r.current != null ? Number(r.current).toFixed(2) : '–'),
      colXs[2], cy + 3, { width: colWidths[2] - 4, align: 'right' });
    doc.font('Courier').fillColor(r.empty ? EMPTY : TEXT);
    doc.text(r.empty ? '–' : (r.ytd != null ? Number(r.ytd).toFixed(2) : '–'),
      colXs[3], cy + 3, { width: colWidths[3] - 4, align: 'right' });
    doc.moveTo(x, cy + 14).lineTo(x + width, cy + 14).strokeColor(ROW_LINE).lineWidth(0.4).stroke();
    doc.restore();
    cy += 16;
  }
  doc.save();
  doc.rect(x, cy, width, 22).fill(CREAM);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BROWN);
  doc.text('TOTAL DEDUCTIONS', colXs[0] + 4, cy + 7, { width: colWidths[0] - 8, characterSpacing: 0.5 });
  const totalCurrent = Number(payslip.uif || 0) + Number(payslip.paye || 0) + Number(payslip.other_deductions || 0);
  doc.font('Courier-Bold').fontSize(10).fillColor(BROWN);
  doc.text(ZAR(totalCurrent), colXs[2], cy + 6, { width: colWidths[2] - 4, align: 'right' });
  doc.text(ZAR(ytd.uif),      colXs[3], cy + 6, { width: colWidths[3] - 4, align: 'right' });
  doc.moveTo(x, cy + 22).lineTo(x + width, cy + 22).lineWidth(1.5).strokeColor(BROWN).stroke();
  doc.restore();
  doc.y = cy + 24;
}
