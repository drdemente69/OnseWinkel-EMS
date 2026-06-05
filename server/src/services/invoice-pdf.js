// ============================================================================
// Onse Winkel — Quotation / Invoice PDF generator
// ----------------------------------------------------------------------------
// Faithful PDFKit recreation of the approved Alexkor quotation/invoice design
// (design_handoff_invoice_quote/template.html). The SAME generator renders a
// quotation or an invoice — the `doc_type` field flips the labels.
//
// `mode`:
//   services  → unpriced list, single grand total (no per-line pricing)
//   products  → priced rows (qty × unit price = line amount), summed total
// ============================================================================

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { resolveLogoPath } from './logo.js';

// ---- design tokens (from README → Design Tokens) ----
const GREEN      = '#91b73a';
const GREEN_DEEP = '#7a9e2b';
const BROWN      = '#3a2418';
const BROWN_SOFT = '#5a4030';
const INK        = '#2a2118';
const MUTED      = '#8a8175';
const LINE       = '#e7e2d8';
const CREAM      = '#faf8f3';
const FOOTER_TXT = '#d9cfc4';
const WHITE      = '#ffffff';

const MM = 2.834645669; // pt per mm
const PAD = 18 * MM;    // 18mm side padding
const HEADER_TOP = 15 * MM;

const money = (n) => {
  const v = Number(n) || 0;
  const neg = v < 0 ? '-' : '';
  const [intp, dec] = Math.abs(v).toFixed(2).split('.');
  const grouped = intp.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg}R ${grouped}.${dec}`;
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const LABELS = {
  quotation: {
    title: 'QUOTATION', numberLabel: 'Quote No.', secondaryLabel: 'Valid Until',
    clientLabel: 'Prepared For', grandLabel: 'Total Due',
  },
  invoice: {
    title: 'INVOICE', numberLabel: 'Invoice No.', secondaryLabel: 'Due Date',
    clientLabel: 'Bill To', grandLabel: 'Amount Due',
  },
};

export async function generateInvoicePDF({ outPath, invoice, company }) {
  const L = LABELS[invoice.doc_type] || LABELS.quotation;
  const priced = invoice.mode === 'products';
  const items = Array.isArray(invoice.items) ? invoice.items : JSON.parse(invoice.items || '[]');
  const terms = Array.isArray(invoice.terms) ? invoice.terms : JSON.parse(invoice.terms || '[]');

  const doc = new PDFDocument({
    size: 'A4', margin: 0,
    info: {
      Title: `${L.title} ${invoice.number}`,
      Author: company?.name || 'Onse Winkel (Pty) Ltd',
      Subject: invoice.client_name || '',
    },
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = PAD;
  const right = pageW - PAD;
  const contentW = right - left;

  // ============================ HEADER ============================
  // Left — logo + brand
  const logoPath = resolveLogoPath(company?.logoPath);
  let brandX = left;
  if (logoPath) {
    try {
      doc.image(logoPath, left, HEADER_TOP, { width: 64 });
      brandX = left + 64 + 14;
    } catch { brandX = left; }
  }
  // Brand name — stack before "PTY"/"(PTY)" so it reads as two tidy lines and
  // stays narrow (prevents crowding the document title on the right).
  const rawName = (company?.name || 'ONSE WINKEL (PTY) LTD').toUpperCase();
  const ptyIdx = rawName.search(/\(?PTY/);
  const nameLines = ptyIdx > 0
    ? [rawName.slice(0, ptyIdx).trim(), rawName.slice(ptyIdx).trim()]
    : [rawName];
  // Left brand column is capped so it can never reach into the title block.
  const brandW = contentW * 0.46 - (brandX - left);
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(15);
  let by = HEADER_TOP;
  for (const ln of nameLines) { doc.text(ln, brandX, by, { width: brandW, lineGap: 1 }); by = doc.y; }
  doc.font('Helvetica').fontSize(9).fillColor(BROWN_SOFT);
  doc.text(company?.address || '', brandX, by + 6, { width: brandW, lineGap: 2 });
  const contactBits = [company?.phone, company?.email].filter(Boolean).join('   ·   ');
  if (contactBits) doc.text(contactBits, brandX, doc.y + 1, { width: brandW });
  const leftBottom = doc.y;

  // Right — document title block, kept in the right half so it can't overlap.
  const titleX = left + contentW * 0.5;
  const titleW = contentW * 0.5;
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(25)
    .text(L.title, titleX, HEADER_TOP, { width: titleW, align: 'right', characterSpacing: 1 });
  // accent bar
  doc.roundedRect(right - 56, HEADER_TOP + 30, 56, 4, 2).fill(GREEN);
  // meta rows
  let my = HEADER_TOP + 46;
  const metaRow = (label, value) => {
    if (!value) return;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(label.toUpperCase(), right - 260, my + 1, { width: 150, align: 'right', characterSpacing: 0.5 });
    doc.font('Courier').fontSize(10).fillColor(INK)
      .text(value, right - 105, my, { width: 105, align: 'right' });
    my += 16;
  };
  metaRow(L.numberLabel, invoice.number);
  metaRow('Date', fmtDate(invoice.doc_date));
  if (invoice.secondary_date) metaRow(L.secondaryLabel, fmtDate(invoice.secondary_date));
  const rightBottom = my;

  // Divider
  let y = Math.max(leftBottom, rightBottom) + 14;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(LINE).stroke();
  y += 18;

  // ============================ PARTIES ============================
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN_DEEP)
    .text(L.clientLabel.toUpperCase(), left, y, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(BROWN)
    .text(invoice.client_name || '—', left, doc.y + 4, { width: contentW / 2 - 10 });
  if (invoice.client_address) {
    doc.font('Helvetica').fontSize(10).fillColor(BROWN_SOFT)
      .text(invoice.client_address, left, doc.y + 3, { width: contentW / 2 - 10, lineGap: 2 });
  }
  y = doc.y + 14;

  // ============================ SCOPE (optional) ============================
  if (invoice.scope_description || invoice.route_from || invoice.route_to) {
    const boxX = left, boxW = contentW;
    const padX = 16, padY = 11;
    // measure
    doc.font('Helvetica').fontSize(10.5);
    const descH = invoice.scope_description
      ? doc.heightOfString(invoice.scope_description, { width: boxW - padX * 2, lineGap: 1.5 })
      : 0;
    const hasRoute = invoice.route_from || invoice.route_to;
    const boxH = padY * 2 + 13 /*eyebrow*/ + (descH ? descH + 5 : 0) + (hasRoute ? 28 : 0);
    // card
    doc.roundedRect(boxX, y, boxW, boxH, 4).fillAndStroke(CREAM, LINE);
    doc.rect(boxX, y, 3, boxH).fill(GREEN); // green left border
    let cy = y + padY;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN_DEEP)
      .text('SCOPE OF WORK', boxX + padX, cy, { characterSpacing: 1 });
    cy = doc.y + 4;
    if (invoice.scope_description) {
      doc.font('Helvetica').fontSize(10.5).fillColor(INK)
        .text(invoice.scope_description, boxX + padX, cy, { width: boxW - padX * 2, lineGap: 1.5 });
      cy = doc.y + 6;
    }
    if (hasRoute) {
      drawRoute(doc, boxX + padX, cy + 3, boxW - padX * 2, invoice);
    }
    y += boxH + 14;
  }

  // ============================ LINE ITEMS ============================
  y = drawItemsTable(doc, left, y, contentW, {
    heading: invoice.items_heading || (priced ? 'Description' : 'Services Included'),
    priced, items,
  });

  // ============================ TOTALS ============================
  y += 12;
  const boxW = contentW * 0.58;
  const boxX = right - boxW;
  const totalLines = [];
  if (invoice.vat_enabled) {
    totalLines.push({ label: 'Amount (VAT inclusive)', value: money(invoice.grand_total) });
    totalLines.push({ label: 'VAT @ 15% (included)',   value: money(invoice.vat_amount) });
  }
  doc.font('Helvetica').fontSize(11);
  for (const ln of totalLines) {
    doc.fillColor(BROWN_SOFT).font('Helvetica').text(ln.label, boxX + 14, y + 5, { width: boxW * 0.6 });
    doc.font('Courier').fillColor(BROWN_SOFT).text(ln.value, boxX, y + 5, { width: boxW - 14, align: 'right' });
    y += 20;
  }
  // grand total bar
  y += 6;
  const grandH = 34;
  doc.roundedRect(boxX, y, boxW, grandH, 4).fill(GREEN);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11)
    .text(L.grandLabel.toUpperCase(), boxX + 14, y + 12, { characterSpacing: 1 });
  doc.font('Courier').fontSize(18).fillColor(WHITE)
    .text(money(invoice.grand_total), boxX, y + 8, { width: boxW - 14, align: 'right' });
  y += grandH;

  // ============================ LOWER (pinned to bottom) ============================
  drawLower(doc, left, right, contentW, pageW, pageH, { invoice, company, terms, minY: y + 18 });

  doc.end();
  return new Promise((res, rej) => {
    stream.on('finish', res);
    stream.on('error', rej);
  });
}

// ---- route strip (origin → destination, dashed) ----
function drawRoute(doc, x, y, w, inv) {
  const dotR = 4.5;
  const cy = y + 6;
  // origin dot (solid green)
  doc.circle(x + dotR, cy, dotR).fill(GREEN);
  // origin label
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BROWN)
    .text(inv.route_from || '', x + dotR * 2 + 8, y, { width: 150 });
  if (inv.route_from_sub) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(inv.route_from_sub, x + dotR * 2 + 8, doc.y + 1, { width: 150 });
  }
  // destination dot (hollow)
  const destDotX = x + w - dotR;
  doc.circle(destDotX, cy, dotR).lineWidth(1.5).fillAndStroke(WHITE, BROWN);
  // destination labels (right aligned)
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BROWN)
    .text(inv.route_to || '', x + w - 160 - 12, y, { width: 160, align: 'right' });
  if (inv.route_to_sub) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(inv.route_to_sub, x + w - 160 - 12, doc.y + 1, { width: 160, align: 'right' });
  }
  // dashed track between dots
  const trackX1 = x + dotR * 2 + 70;
  const trackX2 = destDotX - 70;
  if (trackX2 > trackX1) {
    doc.save().lineWidth(2).strokeColor(GREEN).dash(8, { space: 6 })
      .moveTo(trackX1, cy).lineTo(trackX2, cy).stroke().undash().restore();
  }
}

// ---- line-items table ----
function drawItemsTable(doc, x, y, w, { heading, priced, items }) {
  const rowPadX = 14;
  // column geometry
  const qtyW = priced ? w * 0.08 : 0;
  const priceW = priced ? w * 0.19 : 0;
  const amtW = priced ? w * 0.19 : 0;
  const descW = w - qtyW - priceW - amtW;

  // header
  const headH = 27;
  doc.save();
  doc.roundedRect(x, y, w, headH, 4).fill(BROWN);
  // square off bottom corners so body sits flush
  doc.rect(x, y + headH - 6, w, 6).fill(BROWN);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(WHITE);
  doc.text(heading.toUpperCase(), x + rowPadX, y + 10, { width: descW - rowPadX, characterSpacing: 0.8 });
  if (priced) {
    doc.text('QTY', x + descW, y + 10, { width: qtyW, align: 'center', characterSpacing: 0.8 });
    doc.text('UNIT PRICE', x + descW + qtyW, y + 10, { width: priceW - rowPadX, align: 'right', characterSpacing: 0.8 });
    doc.text('AMOUNT', x + descW + qtyW + priceW, y + 10, { width: amtW - rowPadX, align: 'right', characterSpacing: 0.8 });
  }
  let ry = y + headH;

  items.forEach((it, i) => {
    // measure row height
    doc.font('Helvetica-Bold').fontSize(11);
    const titleH = doc.heightOfString(it.title || '', { width: descW - rowPadX * 2 });
    let subH = 0;
    if (it.description) {
      doc.font('Helvetica').fontSize(9.5);
      subH = doc.heightOfString(it.description, { width: descW - rowPadX * 2, lineGap: 1 }) + 2;
    }
    const rowH = Math.max(titleH + subH + 16, 34);
    // zebra
    if (i % 2 === 1) doc.rect(x, ry, w, rowH).fill(CREAM);
    // text
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN)
      .text(it.title || '', x + rowPadX, ry + 9, { width: descW - rowPadX * 2 });
    if (it.description) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
        .text(it.description, x + rowPadX, doc.y + 1, { width: descW - rowPadX * 2, lineGap: 1 });
    }
    if (priced) {
      doc.font('Courier').fontSize(10).fillColor(INK)
        .text(String(it.qty ?? ''), x + descW, ry + 10, { width: qtyW, align: 'center' });
      doc.text(money(it.unitPrice), x + descW + qtyW, ry + 10, { width: priceW - rowPadX, align: 'right' });
      doc.text(money(it.amount), x + descW + qtyW + priceW, ry + 10, { width: amtW - rowPadX, align: 'right' });
    }
    // bottom border
    doc.moveTo(x, ry + rowH).lineTo(x + w, ry + rowH).lineWidth(0.7).strokeColor(LINE).stroke();
    ry += rowH;
  });
  return ry;
}

// ---- lower block: banking + terms grid, thanks, footer bar ----
function drawLower(doc, left, right, contentW, pageW, pageH, { invoice, company, terms, minY }) {
  const footerBarH = 30;
  const colGap = 22;
  const colW = (contentW - colGap) / 2;

  // Measure terms + bank heights so we can pin the block above the footer bar.
  doc.font('Helvetica').fontSize(9.5);
  let termsH = 0;
  for (const t of terms) termsH += doc.heightOfString(t, { width: colW - 14, lineGap: 2 }) + 4;
  const bankLines = 4;
  const bankH = bankLines * 17;
  const gridH = 14 /*eyebrow*/ + Math.max(termsH, bankH) + 8;
  const thanksH = invoice.thanks_title ? 30 : 0;

  const footerBarY = pageH - footerBarH;
  const thanksY = footerBarY - 18 - thanksH;
  let gridY = thanksY - gridH - 8;
  if (gridY < minY) gridY = minY; // never overlap the totals on a very full page

  // --- info grid ---
  // Banking
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN_DEEP)
    .text('BANKING DETAILS', left, gridY, { characterSpacing: 1 });
  let bky = doc.y + 6;
  const bankRow = (label, value, mono) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BROWN).text(label + ' ', left, bky, { continued: true });
    doc.font(mono ? 'Courier' : 'Helvetica').fillColor(BROWN_SOFT).text(value || '—');
    bky = doc.y + 4;
  };
  bankRow('Bank:', invoice.bank_name);
  bankRow('Account Name:', invoice.bank_account_name);
  bankRow('Account No.:', invoice.bank_account_no, true);
  bankRow('Branch Code:', invoice.bank_branch, true);

  // Terms
  const termsX = left + colW + colGap;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN_DEEP)
    .text('TERMS & CONDITIONS', termsX, gridY, { characterSpacing: 1 });
  let ty = doc.y + 6;
  for (const t of terms) {
    doc.circle(termsX + 2, ty + 5, 2).fill(GREEN);
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
      .text(t, termsX + 10, ty, { width: colW - 14, lineGap: 2 });
    ty = doc.y + 4;
  }

  // --- thanks ---
  if (invoice.thanks_title) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BROWN)
      .text(invoice.thanks_title, left, thanksY, { width: contentW });
    if (invoice.thanks_sub) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
        .text(invoice.thanks_sub, left, doc.y + 2, { width: contentW });
    }
  }

  // --- footer bar (flush to bottom edge) ---
  doc.rect(0, footerBarY, pageW, footerBarH).fill(BROWN);
  const segs = [company?.name || 'Onse Winkel (Pty) Ltd'];
  if (company?.reg) segs.push(`Reg. ${company.reg}`);
  if (company?.vat) segs.push(`VAT ${company.vat}`);
  doc.font('Helvetica').fontSize(8.5).fillColor(FOOTER_TXT)
    .text(segs.join('   ·   '), left, footerBarY + 11, { width: contentW * 0.62 });
  const rightInfo = [company?.email, company?.phone].filter(Boolean).join('   ·   ');
  doc.fillColor(GREEN).font('Helvetica-Bold')
    .text(rightInfo, left + contentW * 0.4, footerBarY + 11, { width: contentW * 0.6, align: 'right' });
}
