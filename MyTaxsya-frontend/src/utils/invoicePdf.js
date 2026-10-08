import { jsPDF } from 'jspdf';
import { formatDate } from './format.js';
import { amountInWordsINR, formatMoney, gstSummary, lineTaxable, paymentLabel, roundOffOf } from './invoiceDocument.js';

// A4 GST tax invoice. The standard PDF fonts have no rupee glyph, so amounts are labelled "Rs.".
const ACCENT = [15, 118, 110];
const INK = [30, 41, 59];
const MUTED = [100, 116, 139];
const LINE = [203, 213, 225];
const TINT = [240, 247, 246];
const GREEN = [22, 163, 74];
const RED = [220, 38, 38];
const AMBER = [217, 119, 6];

const M = 12;          // page margin (mm)
const PAGE_W = 210;
const PAGE_H = 297;
const CW = PAGE_W - 2 * M;
const FOOTER_H = 14;
const BOTTOM = PAGE_H - FOOTER_H - 4;

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const qtyText = (q) => { const n = Number(q) || 0; return Number.isInteger(n) ? String(n) : String(+n.toFixed(3)); };

async function loadImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const format = /png/i.test(blob.type) ? 'PNG' : 'JPEG';
    return { dataUrl, format };
  } catch { return null; }
}

/** Builds the invoice as a jsPDF document. `business` and `customer` are optional: missing parts are simply left out. */
export async function buildInvoicePdf({ invoice, business = {}, customer = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const set = (color) => doc.setTextColor(...color);
  const font = (style = 'normal', size = 9) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const text = (s, x, y, opts) => doc.text(String(s), x, y, opts);
  const wrap = (s, w) => doc.splitTextToSize(String(s), w);
  const hline = (y, x1 = M, x2 = PAGE_W - M, color = LINE, width = 0.2) => { doc.setDrawColor(...color); doc.setLineWidth(width); doc.line(x1, y, x2, y); };

  const gstOn = business.gst_enabled !== false;
  const label = paymentLabel(invoice);
  const labelColor = label === 'PAID' ? GREEN : label === 'PARTIALLY PAID' ? AMBER : label === 'UNPAID' ? RED : MUTED;
  const placeOfSupply = clean(customer.state) || clean(business.state);

  // ---------- Header: business on the left, document title on the right ----------
  let y = M;
  const logo = await loadImage(business.logo_url);
  let textX = M;
  if (logo) { try { doc.addImage(logo.dataUrl, logo.format, M, y, 18, 18); textX = M + 22; } catch { /* unreadable logo: skip */ } }

  font('bold', 15); set(INK);
  const nameLines = wrap(clean(business.name) || 'Your Business', 105 - (textX - M));
  text(nameLines, textX, y + 5);
  let ly = y + 5 + nameLines.length * 6;
  font('normal', 8.5); set(MUTED);
  const address = [clean(business.address), [clean(business.city), clean(business.state), clean(business.pincode)].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const infoLines = [
    ...(address ? wrap(address, 105 - (textX - M)) : []),
    [business.gstin && `GSTIN: ${clean(business.gstin)}`, business.pan && `PAN: ${clean(business.pan)}`].filter(Boolean).join('   '),
    [business.phone && `Phone: ${clean(business.phone)}`, business.email && clean(business.email)].filter(Boolean).join('   '),
  ].filter(Boolean);
  infoLines.forEach((l) => { text(l, textX, ly); ly += 4.2; });

  font('bold', 21); set(ACCENT);
  text(gstOn ? 'TAX INVOICE' : 'INVOICE', PAGE_W - M, y + 8, { align: 'right' });
  font('normal', 8); set(MUTED);
  text('ORIGINAL FOR RECIPIENT', PAGE_W - M, y + 13, { align: 'right' });
  // status stamp
  font('bold', 9);
  const stampW = doc.getTextWidth(label) + 8;
  doc.setDrawColor(...labelColor); doc.setLineWidth(0.5);
  doc.roundedRect(PAGE_W - M - stampW, y + 16, stampW, 7, 1.5, 1.5);
  set(labelColor);
  text(label, PAGE_W - M - stampW / 2, y + 20.8, { align: 'center' });

  y = Math.max(ly, y + 26) + 2;
  hline(y, M, PAGE_W - M, ACCENT, 0.8);
  y += 5;

  // ---------- Meta strip ----------
  doc.setFillColor(...TINT);
  doc.rect(M, y, CW, 13, 'F');
  const metaCells = [
    ['INVOICE NO.', clean(invoice.invoice_number) || '-'],
    ['INVOICE DATE', formatDate(invoice.invoice_date)],
    ['DUE DATE', formatDate(invoice.due_date)],
    ['PLACE OF SUPPLY', placeOfSupply || '-'],
  ];
  const cellW = CW / metaCells.length;
  metaCells.forEach(([k, v], i) => {
    const x = M + i * cellW + 3;
    font('bold', 7); set(MUTED); text(k, x, y + 5);
    font('bold', 10); set(INK); text(wrap(v, cellW - 5)[0], x, y + 10.5);
  });
  y += 13 + 6;

  // ---------- Bill to + payment summary ----------
  const boxTop = y;
  const half = (CW - 6) / 2;
  font('bold', 7.5); set(ACCENT); text('BILL TO', M, y);
  y += 5;
  font('bold', 11); set(INK);
  const custName = wrap(clean(invoice.customer_name) || clean(customer.name) || '-', half);
  text(custName, M, y); y += custName.length * 5;
  font('normal', 8.5); set(MUTED);
  const custAddr = [clean(customer.billing_address), [clean(customer.city), clean(customer.state), clean(customer.pincode)].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const custLines = [
    ...(custAddr ? wrap(custAddr, half) : []),
    customer.gstin ? `GSTIN: ${clean(customer.gstin)}` : '',
    customer.phone ? `Phone: ${clean(customer.phone)}` : '',
  ].filter(Boolean);
  custLines.forEach((l) => { text(l, M, y); y += 4.2; });

  const rx = M + half + 6;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  doc.roundedRect(rx, boxTop - 4, half, 26, 1.5, 1.5);
  font('bold', 7.5); set(ACCENT); text('AMOUNT SUMMARY', rx + 4, boxTop + 1);
  font('normal', 8.5); set(MUTED);
  const sumRow = (k, v, yy, bold) => { font(bold ? 'bold' : 'normal', bold ? 10 : 8.5); set(bold ? INK : MUTED); text(k, rx + 4, yy); text(v, rx + half - 4, yy, { align: 'right' }); };
  sumRow('Invoice total', `Rs. ${formatMoney(invoice.total)}`, boxTop + 7);
  sumRow('Amount paid', `Rs. ${formatMoney(invoice.paid_amount)}`, boxTop + 12);
  sumRow('Balance due', `Rs. ${formatMoney(invoice.balance_due ?? (Number(invoice.total) - Number(invoice.paid_amount || 0)))}`, boxTop + 18.5, true);

  y = Math.max(y, boxTop + 24) + 5;

  // ---------- Items table ----------
  const cols = [
    { k: 'no', t: '#', w: 8, a: 'left' },
    { k: 'desc', t: 'DESCRIPTION', w: 76, a: 'left' },
    { k: 'hsn', t: 'HSN/SAC', w: 20, a: 'left' },
    { k: 'qty', t: 'QTY', w: 16, a: 'right' },
    { k: 'rate', t: 'RATE (Rs.)', w: 26, a: 'right' },
    { k: 'gst', t: 'GST %', w: 14, a: 'right' },
    { k: 'amt', t: 'AMOUNT (Rs.)', w: 26, a: 'right' },
  ];
  const colX = []; cols.reduce((x, c) => { colX.push(x); return x + c.w; }, M);
  const cellText = (c, s, yy) => {
    const x = c.a === 'right' ? colX[cols.indexOf(c)] + c.w - 2 : colX[cols.indexOf(c)] + 2;
    text(s, x, yy, { align: c.a });
  };
  const tableHeader = () => {
    doc.setFillColor(...ACCENT); doc.rect(M, y, CW, 7.5, 'F');
    font('bold', 7.5); doc.setTextColor(255, 255, 255);
    cols.forEach((c) => cellText(c, c.t, y + 5));
    y += 7.5;
  };
  const newPage = () => { doc.addPage(); y = M; };

  tableHeader();
  const items = invoice.items || [];
  items.forEach((it, i) => {
    const descLines = wrap(clean(it.description) || '-', cols[1].w - 4);
    const rowH = Math.max(7, descLines.length * 4.2 + 3);
    if (y + rowH > BOTTOM) { newPage(); tableHeader(); }
    if (i % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(M, y, CW, rowH, 'F'); }
    font('normal', 8.5); set(INK);
    const ty = y + 5;
    cellText(cols[0], String(i + 1), ty);
    descLines.forEach((l, li) => text(l, colX[1] + 2, ty + li * 4.2));
    cellText(cols[2], clean(it.hsn) || '-', ty);
    cellText(cols[3], qtyText(it.quantity), ty);
    cellText(cols[4], formatMoney(it.rate), ty);
    cellText(cols[5], `${Number(it.gst_rate) || 0}%`, ty);
    font('bold', 8.5); cellText(cols[6], formatMoney(lineTaxable(it)), ty);
    y += rowH;
    hline(y, M, PAGE_W - M, LINE, 0.15);
  });
  if (!items.length) { font('normal', 9); set(MUTED); text('No line items', M + 2, y + 5); y += 8; }
  y += 5;

  // ---------- Totals (right) and words / notes / bank (left) ----------
  const totalsW = 78;
  const totalsX = PAGE_W - M - totalsW;
  const rows = [['Taxable value', formatMoney(invoice.subtotal)]];
  if (Number(invoice.discount) > 0) rows.push(['Discount', `- ${formatMoney(invoice.discount)}`]);
  if (Number(invoice.cgst) > 0) rows.push(['CGST', formatMoney(invoice.cgst)]);
  if (Number(invoice.sgst) > 0) rows.push(['SGST', formatMoney(invoice.sgst)]);
  if (Number(invoice.igst) > 0) rows.push(['IGST', formatMoney(invoice.igst)]);
  if (Number(invoice.cess) > 0) rows.push(['Cess', formatMoney(invoice.cess)]);
  const ro = roundOffOf(invoice);
  if (ro !== 0) rows.push(['Round off', `${ro > 0 ? '+ ' : '- '}${formatMoney(Math.abs(ro))}`]);

  const words = amountInWordsINR(invoice.total);
  const leftW = totalsX - M - 6;
  const wordLines = wrap(words, leftW);
  const noteLines = invoice.notes ? wrap(clean(invoice.notes), leftW) : [];
  const bank = [
    business.bank_name && `Bank: ${clean(business.bank_name)}`,
    business.bank_account && `A/C No: ${clean(business.bank_account)}`,
    business.bank_ifsc && `IFSC: ${clean(business.bank_ifsc)}`,
    business.upi_id && `UPI: ${clean(business.upi_id)}`,
  ].filter(Boolean);
  const leftH = 8 + wordLines.length * 4.2 + (noteLines.length ? 8 + noteLines.length * 4.2 : 0) + (bank.length ? 8 + bank.length * 4.2 : 0);
  const rightH = rows.length * 6 + 12 + 14;
  if (y + Math.max(leftH, rightH) > BOTTOM) { newPage(); }

  const blockTop = y;
  let ry = y;
  font('normal', 9);
  rows.forEach(([k, v]) => { set(MUTED); text(k, totalsX + 3, ry + 4); set(INK); text(v, PAGE_W - M - 3, ry + 4, { align: 'right' }); ry += 6; });
  doc.setFillColor(...ACCENT); doc.rect(totalsX, ry + 1, totalsW, 10, 'F');
  font('bold', 10.5); doc.setTextColor(255, 255, 255);
  text('GRAND TOTAL', totalsX + 3, ry + 7.6);
  text(`Rs. ${formatMoney(invoice.total)}`, PAGE_W - M - 3, ry + 7.6, { align: 'right' });
  ry += 13;
  if (Number(invoice.paid_amount) > 0) {
    font('normal', 9); set(MUTED); text('Amount paid', totalsX + 3, ry + 4); set(INK); text(formatMoney(invoice.paid_amount), PAGE_W - M - 3, ry + 4, { align: 'right' }); ry += 6;
    font('bold', 9.5); set(INK); text('Balance due', totalsX + 3, ry + 4); text(`Rs. ${formatMoney(invoice.balance_due)}`, PAGE_W - M - 3, ry + 4, { align: 'right' }); ry += 6;
  }

  let ly2 = blockTop;
  font('bold', 7.5); set(ACCENT); text('AMOUNT IN WORDS', M, ly2 + 3); ly2 += 7;
  font('bold', 8.5); set(INK); wordLines.forEach((l) => { text(l, M, ly2); ly2 += 4.2; });
  if (noteLines.length) {
    ly2 += 3; font('bold', 7.5); set(ACCENT); text('NOTES', M, ly2); ly2 += 4;
    font('normal', 8.5); set(MUTED); noteLines.forEach((l) => { text(l, M, ly2); ly2 += 4.2; });
  }
  if (bank.length) {
    ly2 += 3; font('bold', 7.5); set(ACCENT); text('BANK / PAYMENT DETAILS', M, ly2); ly2 += 4;
    font('normal', 8.5); set(INK); bank.forEach((l) => { text(l, M, ly2); ly2 += 4.2; });
  }
  y = Math.max(ry, ly2) + 6;

  // ---------- GST summary by rate ----------
  const summary = gstOn ? gstSummary(invoice) : [];
  if (summary.some((r) => r.tax > 0)) {
    const need = 14 + summary.length * 6;
    if (y + need > BOTTOM) newPage();
    font('bold', 7.5); set(ACCENT); text('GST SUMMARY', M, y); y += 2.5;
    const sc = [
      { t: 'GST RATE', w: 26, a: 'left' }, { t: 'TAXABLE VALUE', w: 40, a: 'right' }, { t: 'CGST', w: 30, a: 'right' },
      { t: 'SGST', w: 30, a: 'right' }, { t: 'IGST', w: 30, a: 'right' }, { t: 'TOTAL TAX', w: 30, a: 'right' },
    ];
    const sx = []; sc.reduce((x, c) => { sx.push(x); return x + c.w; }, M);
    const sCell = (i, s, yy) => text(s, sc[i].a === 'right' ? sx[i] + sc[i].w - 2 : sx[i] + 2, yy, { align: sc[i].a });
    doc.setFillColor(...TINT); doc.rect(M, y, CW, 6.5, 'F');
    font('bold', 7); set(MUTED); sc.forEach((c, i) => sCell(i, c.t, y + 4.5)); y += 6.5;
    font('normal', 8.5); set(INK);
    summary.forEach((r) => {
      sCell(0, `${r.rate}%`, y + 4.5); sCell(1, formatMoney(r.taxable), y + 4.5); sCell(2, formatMoney(r.cgst), y + 4.5);
      sCell(3, formatMoney(r.sgst), y + 4.5); sCell(4, formatMoney(r.igst), y + 4.5); sCell(5, formatMoney(r.tax), y + 4.5);
      y += 6; hline(y, M, PAGE_W - M, LINE, 0.15);
    });
    y += 6;
  }

  // ---------- Terms + signature ----------
  const terms = clean(business.invoice_terms);
  const termLines = terms ? wrap(terms, 110) : [];
  const sigH = 26;
  if (y + Math.max(sigH, termLines.length * 4.2 + 8) > BOTTOM) newPage();
  if (termLines.length) {
    font('bold', 7.5); set(ACCENT); text('TERMS & CONDITIONS', M, y + 3);
    font('normal', 8); set(MUTED); termLines.forEach((l, i) => text(l, M, y + 8 + i * 4));
  }
  const sigX = PAGE_W - M - 62;
  font('bold', 9); set(INK); text(`For ${clean(business.name) || 'Your Business'}`, PAGE_W - M, y + 3, { align: 'right' });
  hline(y + 21, sigX, PAGE_W - M, MUTED, 0.3);
  font('normal', 8); set(MUTED); text('Authorised Signatory', PAGE_W - M, y + 25, { align: 'right' });

  // ---------- Footer on every page ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    hline(PAGE_H - FOOTER_H, M, PAGE_W - M, LINE, 0.2);
    font('normal', 7.5); set(MUTED);
    text('This is a computer-generated invoice.', PAGE_W / 2, PAGE_H - FOOTER_H + 5, { align: 'center' });
    text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - FOOTER_H + 5, { align: 'right' });
    text(clean(invoice.invoice_number), M, PAGE_H - FOOTER_H + 5);
  }
  return doc;
}
