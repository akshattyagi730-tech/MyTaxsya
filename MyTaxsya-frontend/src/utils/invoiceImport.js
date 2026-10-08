// Turns one extracted document into the numbers that get saved on an Invoice.
//
// Rules (so a saved invoice always adds up, and never carries invented values):
//   - subtotal is the sum of EX-TAX line values (taxable_value, else qty x rate). A line's printed
//     `total` can include GST, so it is never used to build the subtotal.
//   - tax comes from the document's printed CGST/SGST/IGST/Cess; only when none is printed is it
//     derived from the per-line GST rates.
//   - total is the printed grand total when there is one. Otherwise it is computed:
//     subtotal - discount + tax.
//   - a line that has no value stays 0; it is never filled with the whole invoice's subtotal.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function lineExTaxValue(p = {}) {
  return num(p.taxable_value) || num(p.quantity) * num(p.rate) || num(p.total);
}

export function computeInvoiceAmounts({ products = [], totals = {} } = {}) {
  const subtotal = products.reduce((s, p) => s + lineExTaxValue(p), 0);
  const discount = Math.max(0, num(totals.discount));

  let cgst = num(totals.cgst);
  let sgst = num(totals.sgst);
  let igst = num(totals.igst);
  const cess = num(totals.cess);

  let taxSource = 'printed';
  if (cgst + sgst + igst + cess === 0) {
    const derived = products.reduce((s, p) => s + (lineExTaxValue(p) * num(p.gst_rate)) / 100, 0);
    if (derived > 0) {
      taxSource = 'derived';
      // The split is unknown without the parties' states, so keep it as IGST only when the lines say so.
      const lineIgst = products.reduce((s, p) => s + num(p.igst), 0);
      if (lineIgst > 0) igst = round2(derived);
      else { cgst = round2(derived / 2); sgst = round2(derived / 2); }
    }
  }

  const tax = cgst + sgst + igst + cess;
  const printedTotal = num(totals.grand_total);
  const computedTotal = subtotal - discount + tax;
  const total = printedTotal > 0 ? printedTotal : computedTotal;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    cess: round2(cess),
    total: round2(total),
    round_off: round2(total - computedTotal),
    taxSource,
    usedPrintedTotal: printedTotal > 0,
  };
}

export function buildInvoiceItems(products = []) {
  return products.map((p) => {
    const qty = num(p.quantity) || 1;
    const amount = lineExTaxValue(p);
    return {
      description: p.description || 'Imported Item',
      hsn: p.hsn || undefined,
      quantity: qty,
      rate: num(p.rate) || (amount > 0 ? round2(amount / qty) : 0),
      amount: round2(amount),
      gst_rate: num(p.gst_rate),
    };
  });
}
