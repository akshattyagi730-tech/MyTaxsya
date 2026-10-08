// Pure helpers behind the downloadable invoice PDF (no jsPDF in here, so they can be unit-tested).

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 1234567.5 -> "12,34,567.50": Indian digit grouping, always two decimals (a bill must show paise). */
export const formatMoney = (n) =>
  num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const below1000 = (n) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? below100(n % 100) : ''].filter(Boolean).join(' ');

/** 166468.5 -> "One Lakh Sixty Six Thousand Four Hundred Sixty Eight Rupees and Fifty Paise Only" */
export function amountInWordsINR(amount) {
  const total = Math.round(Math.abs(num(amount)) * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rupees) parts.push(below1000(rupees));

  const rupeeWords = parts.length ? `${parts.join(' ')} Rupees` : '';
  const paiseWords = paise ? `${below100(paise)} Paise` : '';
  return `${[rupeeWords, paiseWords].filter(Boolean).join(' and ')} Only`;
}

/** The value a line contributes before tax. Imported bills store it in `amount` (it already reflects line discounts). */
export const lineTaxable = (item = {}) => num(item.amount) > 0 ? num(item.amount) : num(item.quantity) * num(item.rate);

/**
 * GST summary by rate. The invoice's own CGST/SGST/IGST totals are spread over the rates in proportion
 * to each rate's tax, so the summary always adds up to exactly what the invoice shows.
 */
export function gstSummary(invoice = {}) {
  const items = invoice.items || [];
  const byRate = new Map();
  for (const it of items) {
    const rate = num(it.gst_rate);
    const row = byRate.get(rate) || { rate, taxable: 0, weight: 0 };
    const t = lineTaxable(it);
    row.taxable += t;
    row.weight += (t * rate) / 100;
    byRate.set(rate, row);
  }
  const rows = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const weightSum = rows.reduce((s, r) => s + r.weight, 0);
  const taxTotals = { cgst: num(invoice.cgst), sgst: num(invoice.sgst), igst: num(invoice.igst) };

  const out = rows.map((r) => {
    const share = weightSum > 0 ? r.weight / weightSum : 0;
    const cgst = round2(taxTotals.cgst * share);
    const sgst = round2(taxTotals.sgst * share);
    const igst = round2(taxTotals.igst * share);
    return { rate: r.rate, taxable: round2(r.taxable), cgst, sgst, igst, tax: round2(cgst + sgst + igst) };
  });
  // Put any rounding crumbs on the last row so each column sums to the invoice total.
  if (out.length) {
    const last = out[out.length - 1];
    for (const k of ['cgst', 'sgst', 'igst']) {
      const diff = round2(taxTotals[k] - out.reduce((s, r) => s + r[k], 0));
      if (diff !== 0) last[k] = round2(last[k] + diff);
    }
    last.tax = round2(last.cgst + last.sgst + last.igst);
  }
  return out;
}

/** Round-off between the lines and the total, shown on the bill when non-zero. */
export function roundOffOf(invoice = {}) {
  if (invoice.round_off !== undefined && invoice.round_off !== null && num(invoice.round_off) !== 0) return round2(invoice.round_off);
  const expected = num(invoice.subtotal) - num(invoice.discount) + num(invoice.cgst) + num(invoice.sgst) + num(invoice.igst) + num(invoice.cess);
  const diff = round2(num(invoice.total) - expected);
  return Math.abs(diff) < 1 ? diff : 0;
}

/** "Paid" / "Partially paid" / "Unpaid" wording for the bill's status stamp. */
export function paymentLabel(invoice = {}) {
  const total = num(invoice.total);
  const paid = num(invoice.paid_amount);
  if (invoice.status === 'cancelled') return 'CANCELLED';
  if (total > 0 && paid >= total - 0.01) return 'PAID';
  if (paid > 0) return 'PARTIALLY PAID';
  return invoice.status === 'draft' ? 'DRAFT' : 'UNPAID';
}
