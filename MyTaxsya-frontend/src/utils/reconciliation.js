// The extraction API reads a bill's numbers and then reconciles them against the printed grand total
// (see backend services/invoiceMath.js). When a bill turns out to be priced GST-inclusive (MRP-style),
// the line amounts as printed are gross — feeding them to a form that adds GST on top would count the
// tax twice. The API therefore also returns an ex-tax view of the same bill; this swaps it in.
//
// Exclusive bills (and bills that could not be reconciled) are returned untouched, so a human always
// reviews exactly what was read off the page.
export function applyReconciliation({ products = [], totals = {}, reconciliation } = {}) {
  if (reconciliation?.mode !== 'inclusive' || !reconciliation.resolved) return { products, totals };

  const r = reconciliation.resolved;
  return {
    products: products.map((p, i) => {
      const exTax = r.items?.[i];
      return exTax
        ? { ...p, rate: exTax.rate, taxable_value: exTax.taxable_value, total: exTax.taxable_value, gst_rate: exTax.gst_rate }
        : p;
    }),
    totals: { ...totals, taxable_value: r.subtotal, discount: r.discount, round_off: r.round_off },
  };
}
