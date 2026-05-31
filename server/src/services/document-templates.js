// ============================================================
// Document templates — generates standard HR documents
// (employment contract, payroll-deduction consent, specific-deduction
// authorisation, termination notice, leave application) as PDF files.
//
// Templates mirror the structure of the company's existing paper forms
// and pull employer + employee details from the EMS database so the
// operator only fills in the variable bits (dates, amounts, reasons …).
// ============================================================

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { resolveLogoPath } from './logo.js';

// ----- shared helpers ------------------------------------------------------

const BROWN     = '#3d2817';
const BROWN_DARK = '#2a2418';
const TEXT      = '#1a1a1a';
const MUTED     = '#5a5240';
const RULE      = '#d8d4cc';
const FAINT     = '#9c9686';

const fmtDate = (iso) => {
  if (!iso) return '__________________';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
};
const dotted = (val, width = 30) => {
  const s = (val == null || val === '') ? '' : String(val);
  return s + ' '.repeat(Math.max(0, width - s.length));
};
const moneyZAR = (n) => {
  if (n == null || n === '') return 'R ______________';
  return `R ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function drawHeader(doc, company, title, subtitle) {
  const leftX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const top = doc.y;
  const logoPath = resolveLogoPath(company?.logoPath);
  if (logoPath) {
    try {
      doc.save();
      doc.roundedRect(leftX, top, 44, 44, 6).fill('#000');
      doc.image(logoPath, leftX, top, { fit: [44, 44] });
      doc.restore();
    } catch {}
  }
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(15)
    .text(company?.name || 'ONSE WINKEL (PTY) LTD', leftX + 56, top, { characterSpacing: 0.3 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text(company?.address || '', leftX + 56, top + 18, { width: pageW - 56 });
  if (company?.phone || company?.email) {
    doc.text(
      [company?.phone && `Phone: ${company.phone}`, company?.email && `Email: ${company.email}`]
        .filter(Boolean).join('  ·  '),
      leftX + 56, doc.y, { width: pageW - 56 },
    );
  }
  doc.moveTo(leftX, top + 56).lineTo(leftX + pageW, top + 56)
    .lineWidth(1.5).strokeColor(BROWN).stroke();

  doc.y = top + 72;
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(15)
    .text(title.toUpperCase(), { align: 'center', characterSpacing: 0.8 });
  if (subtitle) {
    doc.moveDown(0.2);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10.5)
      .text(subtitle, { align: 'center' });
  }
  doc.moveDown(1.2);
  doc.fillColor(TEXT).font('Helvetica').fontSize(10.5);
}

function drawFooter(doc, company) {
  const leftX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.page.height - doc.page.margins.bottom - 16;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`${company?.name || 'Onse Winkel (Pty) Ltd'} · Generated ${new Date().toISOString().slice(0, 10)}`,
          leftX, y, { width: pageW, align: 'center' });
}

// Convenience: a labelled value with a trailing underline.
function inlineLabel(doc, label, value, opts = {}) {
  doc.font('Helvetica-Bold').text(label + ' ', { continued: true });
  doc.font('Helvetica').text(value || '____________________________', opts);
}

// Numbered section heading: "1. APPOINTMENT"
function sectionHead(doc, n, title) {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK)
    .text(`${n}. ${title.toUpperCase()}`);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.15);
}

// Wraps a clause "1.1 text…". Uses flowing text (no absolute positioning) so
// PDFKit handles page breaks cleanly — earlier versions used two text() calls
// at the same explicit y, which caused overlapping numbers and stray blank
// pages when clauses crossed a page boundary.
function clause(doc, num, text) {
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXT)
    .text(num + '  ', { continued: true, lineGap: 2 });
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT)
    .text(text, { lineGap: 2 });
  doc.moveDown(0.3);
}

// Force a page break if less than `requiredHeight` remains on the current page.
// Used so signature blocks never get marooned at the very bottom.
function ensureSpace(doc, requiredHeight) {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < requiredHeight) doc.addPage();
}

function signatureBlock(doc, parties) {
  // Reserve enough room for the full block so the signature line never
  // ends up orphaned from its label across pages.
  ensureSpace(doc, 110);
  doc.moveDown(1.5);
  const leftX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 24;
  const colW = (pageW - gap * (parties.length - 1)) / parties.length;
  const yStart = doc.y;
  parties.forEach((p, i) => {
    const x = leftX + i * (colW + gap);
    if (p.name) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT)
        .text(p.name, x, yStart, { width: colW });
    }
    // Signature line sits below the (optional) name.
    doc.moveTo(x, yStart + 28).lineTo(x + colW, yStart + 28)
      .strokeColor('#000').lineWidth(0.8).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(p.label, x, yStart + 32, { width: colW });
  });
  // Reset cursor to the left margin — the parties loop above leaves doc.x
  // parked at the last column, which would otherwise push following text
  // (date line, witness lines) into the far right of the page.
  doc.x = leftX;
  doc.y = yStart + 52;
  doc.moveDown(0.5);
  // Date line
  doc.font('Helvetica').fontSize(9.5).fillColor(TEXT);
  doc.text(`Signed at ${dotted('', 20)} on ${dotted('', 6)} day of ${dotted('', 18)} 20${dotted('', 2)}.`);
}

// ----- 1. Employment contract ---------------------------------------------

function generateContract(doc, { company, employee, fields }) {
  drawHeader(doc, company, 'Contract of Employment');

  // Parties block
  doc.font('Helvetica-Bold').fontSize(10.5).text('ENTERED INTO BY AND BETWEEN:');
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').text('EMPLOYER: ', { continued: true });
  doc.font('Helvetica').text(`${company?.name || 'ONSE WINKEL (PTY) LTD'} of ${company?.address || ''} herein represented by ${fields.employer_rep || company?.contact || 'HAFIZ RAHAT BAIG'} (the "EMPLOYER")`);
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').text('AND'); doc.moveDown(0.3);
  doc.font('Helvetica-Bold').text('EMPLOYEE: ', { continued: true });
  doc.font('Helvetica').text(`${employee.first_name} ${employee.last_name}`);
  doc.font('Helvetica-Bold').text('Identity number: ', { continued: true });
  doc.font('Helvetica').text(employee.id_number && employee.id_number !== '——' ? employee.id_number : '____________________________');
  doc.font('Helvetica-Bold').text('Address: ', { continued: true });
  doc.font('Helvetica').text(employee.address || '____________________________');
  doc.font('Helvetica-Bold').text('Employee number: ', { continued: true });
  doc.font('Helvetica').text(employee.employee_no || '____________________________');
  doc.text('(the "EMPLOYEE")');

  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').text('WHEREBY THE PARTIES AGREE AS FOLLOWS:');

  // 1 Appointment
  sectionHead(doc, 1, 'Appointment');
  clause(doc, '1.1', `The EMPLOYEE hereby accepts the appointment as ${fields.position || employee.position || '____________________________'} for the EMPLOYER.`);

  // 2 Duration
  sectionHead(doc, 2, 'Duration');
  clause(doc, '2.1', `This agreement becomes effective from ${fmtDate(fields.start_date || employee.date_employed)}${fields.end_date ? ` and continues until ${fmtDate(fields.end_date)}` : ' and continues until terminated by either party'}.`);
  clause(doc, '2.2', `In the case of a new appointment, the EMPLOYEE's appointment is subject to a ${fields.probation_weeks || 8}-week probationary period during which the EMPLOYER may terminate the services of the EMPLOYEE for any fair reason. One week's written notice of termination of service must be given to the EMPLOYEE before the end of the probationary period.`);
  clause(doc, '2.3', `Substantive and procedural fairness will entail that the EMPLOYEE will be given the opportunity to state his/her case in response to the allegations being raised and to receive a final decision from the EMPLOYER.`);

  // 3 Duties
  sectionHead(doc, 3, "The Employee's Duties");
  clause(doc, '3.1', `The core of the EMPLOYEE's duties towards the EMPLOYER is the duty to obey all lawful and reasonable instructions and to perform such work as he/she is directed to perform which falls within his/her vocational ability.`);
  clause(doc, '3.2', `Without limiting the aforesaid duties, the EMPLOYEE is obliged to strictly comply with the provisions of this agreement, may not misappropriate the EMPLOYER's property, must keep all information entrusted to him/her confidential, and must adhere to the general Code of Conduct that governs relations with co-employees and customers.`);
  clause(doc, '3.3', fields.duties || `Cleaning inside and outside, helping to price stock and place it on shelves, any jobs related to running the shop, and loading and off-loading of stock.`);

  // 4 Workplace
  sectionHead(doc, 4, 'Workplace');
  clause(doc, '4.1', `The EMPLOYEE will perform his/her duties at ${company?.name || 'ONSE WINKEL (PTY) LTD'}, ${company?.address || ''}, provided that the EMPLOYER may require the EMPLOYEE to perform his/her duties at such other place as may be indicated by the EMPLOYER.`);

  // 5 Service hours
  sectionHead(doc, 5, 'Service hours');
  clause(doc, '5.1', `Service hours are from ${fields.weekday_start || '08h00'} to ${fields.weekday_end || '17h00'} on weekdays. The EMPLOYEE is expected to work on Saturdays from ${fields.saturday_start || '__________'} to ${fields.saturday_end || '__________'}. The EMPLOYER will not require the EMPLOYEE to work more than 45 normal hours per week.`);
  clause(doc, '5.2', `The EMPLOYEE is entitled to a meal interval of sixty continuous minutes.`);
  clause(doc, '5.3', `Interruptions will normally not be permitted; however, operational circumstances may justify an interruption whereupon equivalent time off will be given.`);

  // 6 Remuneration
  sectionHead(doc, 6, 'Remuneration');
  clause(doc, '6.1', `An hourly wage of ${moneyZAR(fields.hourly_wage ?? employee.hourly_wage)}.`);
  clause(doc, '6.2', `The EMPLOYEE hereby gives permission to the EMPLOYER to deduct all obligatory deductions, as authorised by statute, from the above remuneration.`);
  clause(doc, '6.3', `Overtime will be performed when reasonably requested by the EMPLOYER, and the EMPLOYER will remunerate the EMPLOYEE in accordance with the Basic Conditions of Employment Act, 1997 (as amended).`);

  // 7 Leave (with our company-configurable annual default)
  sectionHead(doc, 7, 'Leave');
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXT).text('7.1 ANNUAL LEAVE');
  clause(doc, '7.1.1', `The EMPLOYEE is entitled to ${fields.annual_days || 18} consecutive working days' leave on full pay for each annual leave cycle.`);
  clause(doc, '7.1.2', `Leave shall be granted by the EMPLOYER at a date determined by the EMPLOYER, at any time during the 12-month cycle but no later than six months after the end of the cycle.`);
  clause(doc, '7.1.3', `On termination of employment, the EMPLOYER shall pay the EMPLOYEE the full remuneration for any leave that accrued but was not granted prior to the date of termination.`);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10.5).text('7.2 SICK LEAVE');
  clause(doc, '7.2.1', `During each sick leave cycle of 36 months, the EMPLOYEE is entitled to paid sick leave equal to the number of days the EMPLOYEE would normally work during a six-week period (BCEA § 22).`);
  clause(doc, '7.2.2', `During the first six months of continuous employment, the EMPLOYEE is entitled to one day's paid sick leave for every twenty-six days worked.`);
  clause(doc, '7.2.3', `The EMPLOYEE shall provide a valid medical certificate when applying for more than two consecutive days' sick leave or after more than two occasions in an eight-week period.`);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10.5).text('7.3 MATERNITY LEAVE');
  clause(doc, '7.3.1', `The EMPLOYEE is entitled to unpaid maternity leave for a maximum period of 4 consecutive months commencing at any time from 4 weeks before the expected date of birth unless otherwise agreed or as certified by a medical practitioner.`);
  clause(doc, '7.3.2', `The EMPLOYEE must inform the EMPLOYER at least 4 weeks before she intends to start maternity leave.`);
  clause(doc, '7.3.3', `The EMPLOYEE may not work for 6 weeks after the birth of her child unless a medical practitioner certifies that she is fit to do so.`);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10.5).text('7.4 FAMILY RESPONSIBILITY LEAVE');
  clause(doc, '7.4.1', `The EMPLOYEE is entitled, during each annual leave cycle, to three days' paid family responsibility leave (BCEA § 27) which the EMPLOYEE is entitled to take:`);
  clause(doc, '7.4.1.1', `When the EMPLOYEE's child is born;`);
  clause(doc, '7.4.1.2', `When the EMPLOYEE's child is sick; or`);
  clause(doc, '7.4.1.3', `In the event of the death of the EMPLOYEE's spouse or life partner, parent, adoptive parent, grandparent, child, adopted child, grandchild or sibling.`);
  clause(doc, '7.4.2', `The EMPLOYEE may take family responsibility leave for the whole or part of a day and the EMPLOYER may require reasonable proof of the reason for the leave.`);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10.5).text('7.5 ACCRUAL OF LEAVE');
  clause(doc, '7.5.1', `Leave may not be accrued by the EMPLOYEE and in the event of it not being taken, the EMPLOYEE will forfeit it (unless otherwise agreed in writing).`);

  // 8 Public holidays
  sectionHead(doc, 8, 'Public holidays');
  clause(doc, '8.1', `The EMPLOYEE is entitled to such public holidays on full pay as are determined by law.`);

  // 9 Termination
  sectionHead(doc, 9, 'Termination');
  clause(doc, '9.1', `This agreement may be terminated by either party giving one calendar month's written notice of termination of service to the other, provided that such notice must be given on the first day of the particular month.`);

  // 10 Certificate of service
  sectionHead(doc, 10, 'Certificate of service');
  clause(doc, '10.1', `On termination of employment, the EMPLOYEE is entitled to a Certificate of Service, the particulars of which are detailed in the Basic Conditions of Employment Act.`);

  // Signatures
  signatureBlock(doc, [
    { label: 'EMPLOYER (signature)', name: fields.employer_rep || company?.contact || 'HAFIZ RAHAT BAIG' },
    { label: 'EMPLOYEE (signature)', name: `${employee.first_name} ${employee.last_name}` },
  ]);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10).text('AS WITNESSES:');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text('1. ____________________________________________');
  doc.moveDown(0.3);
  doc.text('2. ____________________________________________');

  drawFooter(doc, company);
}

// ----- 2. Employee Consent (general) ---------------------------------------

function generateConsent(doc, { company, employee, fields }) {
  drawHeader(doc, company, 'Employee Consent Form for Payroll Deductions', company?.name);

  // Employee info
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('EMPLOYEE INFORMATION');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  inlineLabel(doc, 'Employee Name:', `${employee.first_name} ${employee.last_name}`);
  inlineLabel(doc, 'Employee ID:',   employee.employee_no);
  inlineLabel(doc, 'Position:',      fields.position || employee.position);
  inlineLabel(doc, 'Date:',          fmtDate(fields.date || new Date().toISOString().slice(0, 10)));

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('CONSENT AND AUTHORIZATION');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.text(`I, ${employee.first_name} ${employee.last_name}, hereby acknowledge and provide my express written consent regarding payroll deductions from my salary/wages as follows:`, { lineGap: 1.5 });

  // 1 General policy
  sectionHead(doc, 1, 'General deduction policy');
  doc.text(`${company?.name || 'Onse Winkel (Pty) Ltd'} will NOT deduct any charges, fees, or amounts from my salary/wages without my prior written consent, except for:`, { lineGap: 1.5 });
  doc.moveDown(0.2);
  ['Statutory deductions required by law (income tax, UIF, pension contributions, etc.)',
   'Court-ordered deductions (garnishments, child support, etc.)',
   'Previously authorized deductions with valid written consent']
    .forEach(s => doc.text('  •  ' + s, { lineGap: 1.5 }));

  // 2 Specific authorization
  sectionHead(doc, 2, 'Specific authorization required');
  doc.text('The following types of deductions require specific written authorization:', { lineGap: 1.5 });
  doc.moveDown(0.2);
  ['Equipment or property damage charges',
   'Uniform or safety equipment costs',
   'Outstanding loans or advances',
   'Disciplinary fines or penalties',
   'Cash register shortages',
   'Other business-related expenses']
    .forEach(s => doc.text('  •  ' + s, { lineGap: 1.5 }));

  // 3 Procedures
  sectionHead(doc, 3, 'Consent procedures');
  ['Any deduction request must be presented in writing.',
   'I have the right to refuse any non-statutory deduction.',
   'I may withdraw my consent for future deductions with 30 days written notice.',
   'Deductions cannot exceed the maximum amounts permitted by applicable employment law.',
   'I will receive detailed information about the nature and amount of any proposed deduction.']
    .forEach(s => doc.text('  •  ' + s, { lineGap: 1.5 }));

  // 4 Rights
  sectionHead(doc, 4, 'Employee rights');
  ['Receiving advance notice of any proposed deduction',
   'Understanding the reason and calculation method for deductions',
   'Disputing any unauthorized or incorrect deductions',
   'Seeking legal advice regarding deduction matters',
   'Filing complaints with the CCMA or other relevant employment authorities']
    .forEach(s => doc.text('  •  ' + s, { lineGap: 1.5 }));

  // 5 Records
  sectionHead(doc, 5, 'Record keeping');
  doc.text('All deduction authorizations and related documentation will be maintained in my personnel file and made available upon request.', { lineGap: 1.5 });

  // Declaration
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('EMPLOYEE DECLARATION');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.3);
  doc.text('By signing below, I confirm that I have read and understood this consent form, that I voluntarily provide this authorization, that I understand my rights regarding payroll deductions, that I acknowledge no deductions will be made without proper authorization, and that I have received a copy of this form for my records.', { lineGap: 1.5 });

  signatureBlock(doc, [
    { label: 'EMPLOYEE (signature)', name: `${employee.first_name} ${employee.last_name}` },
    { label: 'EMPLOYER REPRESENTATIVE',  name: fields.rep_name || company?.contact || 'HAFIZ RAHAT BAIG' },
  ]);

  drawFooter(doc, company);
}

// ----- 3. Authorization for Specific Deduction -----------------------------

function generateAuthorization(doc, { company, employee, fields }) {
  drawHeader(doc, company, 'Authorization for Specific Payroll Deduction', company?.name);

  // Employee info
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('EMPLOYEE INFORMATION');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  inlineLabel(doc, 'Employee Name:',          `${employee.first_name} ${employee.last_name}`);
  inlineLabel(doc, 'Employee ID:',            employee.employee_no);
  inlineLabel(doc, 'Position:',               fields.position || employee.position);
  inlineLabel(doc, 'Date of Authorization:',  fmtDate(fields.date || new Date().toISOString().slice(0, 10)));

  // Deduction details
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('DEDUCTION DETAILS');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  const cats = ['Equipment/Property Damage','Uniform/Safety Equipment','Loan/Advance Repayment','Other'];
  inlineLabel(doc, 'Category:', '');
  cats.forEach(c => {
    const sel = (fields.category === c.toLowerCase().split(/[\/ ]/)[0] || fields.category === c) ? '☑' : '☐';
    doc.font('Helvetica').text(`  ${sel} ${c}${c === 'Other' && fields.category_other ? `: ${fields.category_other}` : ''}`);
  });
  doc.moveDown(0.3);
  inlineLabel(doc, 'Incident/Transaction Date:', fmtDate(fields.incident_date));
  inlineLabel(doc, 'Reference Number:', fields.reference_number);
  doc.font('Helvetica-Bold').text('Detailed Description:');
  doc.font('Helvetica').text(fields.description || '____________________________________________________________________________', { lineGap: 1.5 });

  // Financial info
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('FINANCIAL INFORMATION');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  inlineLabel(doc, 'Total Amount to be Deducted:', moneyZAR(fields.total_amount));
  doc.font('Helvetica-Bold').text('Deduction Method:');
  const methods = [
    { id: 'single',      label: `Single deduction on ${fmtDate(fields.single_date)}` },
    { id: 'installments',label: `Installments over ${fields.installments_count || '____'} pay periods` },
    { id: 'fixed',       label: `Fixed amount of ${moneyZAR(fields.fixed_amount)} per pay period` },
    { id: 'percentage',  label: `Percentage of salary: ${fields.percentage ?? '____'}% per pay period` },
  ];
  methods.forEach(m => {
    const sel = fields.method === m.id ? '☑' : '☐';
    doc.text(`  ${sel} ${m.label}`);
  });
  doc.moveDown(0.2);
  inlineLabel(doc, 'Maximum deduction per pay period:', moneyZAR(fields.max_per_period));
  inlineLabel(doc, 'Estimated completion date:',         fmtDate(fields.completion_date));

  // Terms
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('EMPLOYEE AUTHORIZATION');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  doc.text(`I, ${employee.first_name} ${employee.last_name}, hereby authorize ${company?.name || 'Onse Winkel (Pty) Ltd'} to deduct the above-specified amount(s) from my salary/wages under the following conditions:`, { lineGap: 1.5 });
  doc.moveDown(0.2);
  ['Voluntary Authorization: I confirm this authorization is given voluntarily and without coercion.',
   'Understanding: I fully understand the reason for this deduction and agree it is justified.',
   'Amount Confirmation: I acknowledge the total amount and deduction schedule outlined above.',
   'Legal Compliance: I understand this deduction complies with applicable employment legislation and does not reduce my wages below the prescribed minimum wage.',
   'Right to Dispute: I retain the right to dispute this deduction through the company\'s grievance procedure within 30 days of this authorization.',
   'Modification: Any changes to this deduction arrangement must be agreed to in writing by both parties.',
   `Termination Impact: If my employment terminates before the deduction is fully recovered: ${({deduct_remaining:'remaining balance will be deducted from final pay', alt:'alternative payment arrangements will be made', other:`other: ${fields.termination_impact_other || ''}`})[fields.termination_impact] || 'as agreed in writing'}.`,
   'Record Keeping: I acknowledge receiving a copy of this authorization for my records.']
    .forEach(s => doc.text('  •  ' + s, { lineGap: 1.5 }));

  // Signatures
  signatureBlock(doc, [
    { label: 'EMPLOYEE (signature)', name: `${employee.first_name} ${employee.last_name}` },
    { label: 'SUPERVISOR / MANAGER', name: fields.supervisor_name || '' },
  ]);

  drawFooter(doc, company);
}

// ----- 4. Notice of Termination --------------------------------------------

function generateTermination(doc, { company, employee, fields }) {
  drawHeader(doc, company, 'Notice of Termination of Employment', company?.name);
  doc.fillColor(TEXT).font('Helvetica').fontSize(10.5);

  inlineLabel(doc, 'Date:', fmtDate(fields.date || new Date().toISOString().slice(0, 10)));
  doc.moveDown(0.3);
  const sal = ({male:'Mr.',female:'Ms.'})[fields.salutation] || 'Mr./Ms.';
  // Bold name on its own line (no inlineLabel — that would print an
  // unwanted "____________________________" placeholder after the name).
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXT)
    .text(`${sal} ${employee.first_name} ${employee.last_name}`);
  doc.font('Helvetica');
  inlineLabel(doc, 'ID Number:',      employee.id_number && employee.id_number !== '——' ? employee.id_number : '____________________________');
  inlineLabel(doc, 'Employee Number:', employee.employee_no);

  doc.moveDown(0.4);
  doc.font('Helvetica').text(`Dear ${sal} ${employee.last_name},`);
  doc.moveDown(0.3);
  doc.text(`We regret to inform you that your employment with ${company?.name || 'Onse Winkel (Pty) Ltd'} will be terminated effective ${fmtDate(fields.termination_date)}.`, { lineGap: 1.5 });

  // Reasons
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('REASONS FOR TERMINATION');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  const reasons = (fields.reasons || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (reasons.length) {
    reasons.forEach(r => doc.text('  •  ' + r, { lineGap: 1.5 }));
  } else {
    doc.text('  •  ____________________________________________________________________________', { lineGap: 1.5 });
  }
  if (fields.reasons_summary) {
    doc.moveDown(0.3);
    doc.text(fields.reasons_summary, { lineGap: 1.5 });
  }

  // Termination details
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('TERMINATION DETAILS');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  inlineLabel(doc, 'Last Working Day:',       fmtDate(fields.last_working_day));
  inlineLabel(doc, 'Notice Period:',          fields.notice_period || 'Effective immediately');
  inlineLabel(doc, 'Reason Classification:',  fields.reason_classification || '');

  // Final remuneration
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('FINAL REMUNERATION AND BENEFITS');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  doc.text('Your final remuneration package will include:', { lineGap: 1.5 });
  doc.text('  •  Salary up to your last working day', { lineGap: 1.5 });
  doc.text(`  •  Outstanding leave pay (if any) per your contract`, { lineGap: 1.5 });
  if (fields.other_benefits_amount) doc.text(`  •  Other benefits as per your contract: ${moneyZAR(fields.other_benefits_amount)}`, { lineGap: 1.5 });
  doc.moveDown(0.2);
  inlineLabel(doc, 'Final Payment Date:',    fmtDate(fields.final_payment_date));
  inlineLabel(doc, 'Payment Method:',        fields.payment_method || 'EFT / Direct deposit');

  // Company property
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('COMPANY PROPERTY');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  doc.text('You are required to return all company property in your possession, including but not limited to:', { lineGap: 1.5 });
  ['Company identification / access cards',
   'Uniforms and safety equipment',
   'Tools, equipment, or materials',
   'Company documents, files, or confidential information',
   'Any other items belonging to the company']
    .forEach(s => doc.text('  •  ' + s, { lineGap: 1.5 }));
  doc.moveDown(0.1);
  inlineLabel(doc, 'Return Date:', `On or before ${fmtDate(fields.last_working_day)}`);

  // Confidentiality
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('CONFIDENTIALITY AND NON-DISCLOSURE');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.text('Your confidentiality and non-disclosure obligations as outlined in your employment contract remain in effect after termination.', { lineGap: 1.5 });

  // Closing
  doc.moveDown(0.5);
  doc.text(`We thank you for your service to ${company?.name || 'Onse Winkel (Pty) Ltd'} and wish you well in your future endeavours.`, { lineGap: 1.5 });
  doc.moveDown(0.4);
  doc.text('Yours sincerely,');
  doc.moveDown(1);
  doc.font('Helvetica-Bold').text(fields.signed_by || company?.contact || 'Hafiz Rahat Baig');
  doc.font('Helvetica').text(company?.name || 'Onse Winkel (Pty) Ltd');

  // Acknowledgment
  doc.moveDown(1);
  signatureBlock(doc, [
    { label: 'EMPLOYEE acknowledgement', name: `${employee.first_name} ${employee.last_name}` },
    { label: 'COMPANY REPRESENTATIVE',   name: fields.signed_by || company?.contact || 'Hafiz Rahat Baig' },
  ]);

  drawFooter(doc, company);
}

// ----- 5. Leave Application (new) -----------------------------------------

function generateLeaveApplication(doc, { company, employee, fields }) {
  drawHeader(doc, company, 'Leave Application Form', company?.name);
  doc.fillColor(TEXT).font('Helvetica').fontSize(10.5);

  // Employee info
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('EMPLOYEE INFORMATION');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  inlineLabel(doc, 'Employee Name:', `${employee.first_name} ${employee.last_name}`);
  inlineLabel(doc, 'Employee ID:',   employee.employee_no);
  inlineLabel(doc, 'Position:',      employee.position);
  inlineLabel(doc, 'Date submitted:',fmtDate(fields.date || new Date().toISOString().slice(0, 10)));

  // Leave details
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('LEAVE DETAILS');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  const typeLabels = {
    annual:'Annual', sick:'Sick', family:'Family responsibility',
    maternity:'Maternity', parental:'Parental', unpaid:'Unpaid',
    compassionate:'Compassionate', study:'Study',
  };
  const ltLabel = fields.leave_type
    ? (typeLabels[fields.leave_type] || (fields.leave_type[0].toUpperCase() + fields.leave_type.slice(1)))
    : '____________________________';
  inlineLabel(doc, 'Leave type:', ltLabel);
  if (fields.leave_type === 'family' && fields.sub_reason) {
    inlineLabel(doc, 'Family responsibility sub-reason:', fields.sub_reason);
  }
  doc.moveDown(0.2);
  inlineLabel(doc, 'Start date:',      fmtDate(fields.start_date));
  inlineLabel(doc, 'End date:',        fmtDate(fields.end_date));
  inlineLabel(doc, 'Number of working days:', fields.days_count != null ? `${fields.days_count} days` : '____');
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').text('Reason / description:');
  doc.font('Helvetica').text(fields.reason || '____________________________________________________________________________', { lineGap: 1.5 });
  doc.moveDown(0.2);
  inlineLabel(doc, 'Contact during leave:', fields.contact_during_leave || employee.phone || '');

  // Declaration
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('EMPLOYEE DECLARATION');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  doc.text(`I, ${employee.first_name} ${employee.last_name}, hereby apply for the leave detailed above. I confirm that the information provided is accurate. I understand that any approval is subject to operational requirements and that, where applicable, I will provide supporting documentation (e.g. medical certificate, supporting affidavit).`, { lineGap: 1.5 });

  signatureBlock(doc, [
    { label: 'EMPLOYEE (signature)', name: `${employee.first_name} ${employee.last_name}` },
    { label: 'MANAGER / SUPERVISOR (approval)', name: fields.approver_name || '' },
  ]);

  // Office use
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN_DARK).text('FOR OFFICE USE');
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.moveDown(0.2);
  inlineLabel(doc, 'Status:', fields.status ? fields.status[0].toUpperCase() + fields.status.slice(1) : 'Pending');
  inlineLabel(doc, 'Decision date:', fmtDate(fields.decision_date));
  inlineLabel(doc, 'Decision by:',   fields.approver_name || '');
  inlineLabel(doc, 'Notes:',         fields.office_notes || '');

  drawFooter(doc, company);
}

// ----- Template catalogue --------------------------------------------------

export const TEMPLATES = [
  {
    id: 'contract',
    label: 'Contract of Employment',
    description: 'Full SA-BCEA-aligned employment contract pre-filled with the employee\'s details.',
    tag: 'Contract',
    filenameFor: (emp) => `Contract of Employment – ${emp.first_name} ${emp.last_name}.pdf`,
    fields: [
      { id: 'position',         label: 'Position',                   type: 'text',   placeholder: 'e.g. General Worker' },
      { id: 'start_date',       label: 'Start date',                 type: 'date'   },
      { id: 'end_date',         label: 'End date (optional)',        type: 'date'   },
      { id: 'probation_weeks',  label: 'Probation period (weeks)',   type: 'number', default: 8 },
      { id: 'weekday_start',    label: 'Weekday start (e.g. 08h00)', type: 'text',   default: '08h00' },
      { id: 'weekday_end',      label: 'Weekday end',                type: 'text',   default: '17h00' },
      { id: 'saturday_start',   label: 'Saturday start (optional)',  type: 'text' },
      { id: 'saturday_end',     label: 'Saturday end (optional)',    type: 'text' },
      { id: 'hourly_wage',      label: 'Hourly wage (R)',            type: 'number' },
      { id: 'annual_days',      label: 'Annual leave days / year',   type: 'number', default: 18 },
      { id: 'duties',           label: 'Duties (optional override)', type: 'textarea' },
      { id: 'employer_rep',     label: 'Employer representative',    type: 'text' },
    ],
    generate: generateContract,
  },
  {
    id: 'consent',
    label: 'Employee Consent — Payroll Deductions',
    description: 'General consent acknowledging the payroll-deduction policy.',
    tag: 'Payroll',
    filenameFor: (emp) => `Payroll Deductions Consent – ${emp.first_name} ${emp.last_name}.pdf`,
    fields: [
      { id: 'position', label: 'Position', type: 'text' },
      { id: 'date',     label: 'Date',     type: 'date' },
      { id: 'rep_name', label: 'Company representative', type: 'text' },
    ],
    generate: generateConsent,
  },
  {
    id: 'authorization',
    label: 'Authorization for Specific Payroll Deduction',
    description: 'One-off deduction authorisation with amount, schedule, and supervisor sign-off.',
    tag: 'Payroll',
    filenameFor: (emp) => `Payroll Deduction Authorization – ${emp.first_name} ${emp.last_name}.pdf`,
    fields: [
      { id: 'position',         label: 'Position',                type: 'text' },
      { id: 'date',             label: 'Date of authorization',   type: 'date' },
      { id: 'category',         label: 'Deduction category',      type: 'select', options: [
        { value: 'Equipment/Property Damage', label: 'Equipment / Property damage' },
        { value: 'Uniform/Safety Equipment',  label: 'Uniform / Safety equipment' },
        { value: 'Loan/Advance Repayment',    label: 'Loan / Advance repayment' },
        { value: 'Other',                     label: 'Other' },
      ]},
      { id: 'category_other',   label: 'Specify (if Other)',      type: 'text' },
      { id: 'incident_date',    label: 'Incident / Transaction date', type: 'date' },
      { id: 'reference_number', label: 'Reference number',        type: 'text' },
      { id: 'description',      label: 'Detailed description',    type: 'textarea' },
      { id: 'total_amount',     label: 'Total amount (R)',        type: 'number' },
      { id: 'method',           label: 'Deduction method',        type: 'select', options: [
        { value: 'single',       label: 'Single deduction' },
        { value: 'installments', label: 'Installments over N pay periods' },
        { value: 'fixed',        label: 'Fixed amount per pay period' },
        { value: 'percentage',   label: 'Percentage of salary' },
      ]},
      { id: 'single_date',         label: 'Single deduction date',     type: 'date' },
      { id: 'installments_count',  label: 'Installments (pay periods)', type: 'number' },
      { id: 'fixed_amount',        label: 'Fixed amount (R)',          type: 'number' },
      { id: 'percentage',          label: 'Percentage of salary',      type: 'number' },
      { id: 'max_per_period',      label: 'Max per pay period (R)',    type: 'number' },
      { id: 'completion_date',     label: 'Estimated completion date', type: 'date' },
      { id: 'termination_impact',  label: 'On termination',            type: 'select', options: [
        { value: 'deduct_remaining', label: 'Remaining balance deducted from final pay' },
        { value: 'alt',              label: 'Alternative payment arrangement' },
        { value: 'other',            label: 'Other' },
      ]},
      { id: 'termination_impact_other', label: 'Specify other',        type: 'text' },
      { id: 'supervisor_name',     label: 'Supervisor / Manager name', type: 'text' },
    ],
    generate: generateAuthorization,
  },
  {
    id: 'termination',
    label: 'Notice of Termination of Employment',
    description: 'Formal termination letter with last working day, reasons, and final pay details.',
    tag: 'HR',
    filenameFor: (emp) => `Notice of Termination – ${emp.first_name} ${emp.last_name}.pdf`,
    fields: [
      { id: 'date',                  label: 'Notice date',              type: 'date' },
      { id: 'salutation',            label: 'Salutation',               type: 'select', options: [
        { value: 'female', label: 'Ms.' },
        { value: 'male',   label: 'Mr.' },
      ]},
      { id: 'termination_date',      label: 'Effective termination date',type: 'date' },
      { id: 'last_working_day',      label: 'Last working day',          type: 'date' },
      { id: 'notice_period',         label: 'Notice period',             type: 'text', default: 'Effective immediately' },
      { id: 'reason_classification', label: 'Reason classification',     type: 'text' },
      { id: 'reasons',               label: 'Detailed reasons (one per line)', type: 'textarea' },
      { id: 'reasons_summary',       label: 'Summary paragraph',         type: 'textarea' },
      { id: 'final_payment_date',    label: 'Final payment date',        type: 'date' },
      { id: 'payment_method',        label: 'Payment method',            type: 'text', default: 'EFT / Direct deposit' },
      { id: 'other_benefits_amount', label: 'Other benefits amount (R)', type: 'number' },
      { id: 'signed_by',             label: 'Signed by (company)',       type: 'text' },
    ],
    generate: generateTermination,
  },
  {
    id: 'leave_application',
    label: 'Leave Application Form',
    description: 'Standard leave request form for the employee to sign before/after the leave.',
    tag: 'Leave',
    filenameFor: (emp) => `Leave Application – ${emp.first_name} ${emp.last_name}.pdf`,
    fields: [
      { id: 'leave_type', label: 'Leave type', type: 'select', options: [
        { value: 'annual',        label: 'Annual' },
        { value: 'sick',          label: 'Sick' },
        { value: 'family',        label: 'Family responsibility' },
        { value: 'maternity',     label: 'Maternity' },
        { value: 'parental',      label: 'Parental' },
        { value: 'unpaid',        label: 'Unpaid' },
        { value: 'compassionate', label: 'Compassionate' },
        { value: 'study',         label: 'Study' },
      ]},
      { id: 'sub_reason',      label: 'Sub-reason (if family responsibility)', type: 'text' },
      { id: 'start_date',      label: 'Start date',         type: 'date' },
      { id: 'end_date',        label: 'End date',           type: 'date' },
      { id: 'days_count',      label: 'Number of working days', type: 'number' },
      { id: 'reason',          label: 'Reason / description', type: 'textarea' },
      { id: 'contact_during_leave', label: 'Contact during leave', type: 'text' },
      { id: 'approver_name',   label: 'Manager / approver name', type: 'text' },
      { id: 'date',            label: 'Date submitted', type: 'date' },
    ],
    generate: generateLeaveApplication,
  },
];

export function findTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || null;
}

// Produce a PDF buffer for the chosen template into the given write stream.
export async function generateTemplatePDF({ template, outStream, company, employee, fields }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: {
      Title: template.label,
      Author: company?.name || 'Onse Winkel (Pty) Ltd',
      Subject: `${employee.first_name} ${employee.last_name}`,
    },
  });
  doc.pipe(outStream);
  template.generate(doc, { company, employee, fields });
  doc.end();
  return new Promise((res, rej) => {
    outStream.on('finish', res);
    outStream.on('error', rej);
  });
}
