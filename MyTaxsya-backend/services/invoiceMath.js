// Deterministic arithmetic checks for an extracted invoice.
//
// The language model reads numbers off the page; this module never trusts them
// blindly. It re-does the maths from the extracted line items and works out
// which pricing convention the document actually uses, by testing each one
// against the invoice's own printed grand total:
//
//   exclusive — line amounts are ex-tax, GST is added on top   (B2B tax invoices)
//   inclusive — line amounts already contain GST, i.e. MRP     (pharmacy / FMCG retail bills)
//
// An inclusive bill read as exclusive double-counts the tax; that is the ₹109
// overstatement seen on the Saharan Medical bill. Reconciling against the printed
// total catches it, and — just as important — flags documents where *neither*
// convention reproduces the printed total, which is what a misread quantity or
// rate looks like.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const GST_SLABS = [0, 0.25, 1.5, 3, 5, 12, 18, 28];
const SLAB_TOLERANCE_PP = 0.5;

// GST state codes — the first two digits of any GSTIN.
const STATE_CODES = {
  "01": "jammu and kashmir", "02": "himachal pradesh", "03": "punjab", "04": "chandigarh", "05": "uttarakhand",
  "06": "haryana", "07": "delhi", "08": "rajasthan", "09": "uttar pradesh", "10": "bihar", "11": "sikkim",
  "12": "arunachal pradesh", "13": "nagaland", "14": "manipur", "15": "mizoram", "16": "tripura", "17": "meghalaya",
  "18": "assam", "19": "west bengal", "20": "jharkhand", "21": "odisha", "22": "chhattisgarh", "23": "madhya pradesh",
  "24": "gujarat", "26": "dadra and nagar haveli and daman and diu", "27": "maharashtra", "29": "karnataka", "30": "goa",
  "31": "lakshadweep", "32": "kerala", "33": "tamil nadu", "34": "puducherry", "35": "andaman and nicobar islands",
  "36": "telangana", "37": "andhra pradesh", "38": "ladakh",
};
const STATE_ALIASES = {
  "up": "09", "u.p.": "09", "u.p": "09", "mp": "23", "m.p.": "23", "hp": "02", "h.p.": "02", "jk": "01", "j&k": "01",
  "uk": "05", "wb": "19", "tn": "33", "ap": "37", "mh": "27", "dl": "07", "new delhi": "07", "nct of delhi": "07",
  "orissa": "21", "pondicherry": "34", "rj": "08", "gj": "24", "ka": "29", "kl": "32", "hr": "06", "pb": "03", "br": "10",
};
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATE_CODES).map(([code, name]) => [name, code]));

/** GST state code from a GSTIN when it looks like one, otherwise from a state name/abbreviation. */
export function stateCodeOf(party = {}) {
  const gstin = String(party.gstin || "").trim().toUpperCase();
  if (/^\d{2}[A-Z0-9]{13}$/.test(gstin) && STATE_CODES[gstin.slice(0, 2)]) return gstin.slice(0, 2);
  const name = String(party.state || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!name) return null;
  return NAME_TO_CODE[name] || STATE_ALIASES[name] || null;
}

const nearestSlab = (ratePct) => GST_SLABS.reduce((best, s) => (Math.abs(s - ratePct) < Math.abs(best - ratePct) ? s : best), GST_SLABS[0]);

/**
 * @param {object} input
 * @param {Array<{quantity?:number, rate?:number, taxable_value?:number, total?:number, gst_rate?:number}>} input.items
 * @param {number} [input.discount]      document-level discount printed between subtotal and grand total
 * @param {number} [input.cgst] [input.sgst] [input.igst] [input.cess] [input.round_off]
 * @param {number} input.declaredTotal   the grand total printed on the document
 * @param {object} [input.seller] [input.buyer]   { gstin?, state? }
 */
export function reconcileInvoice({ items = [], discount = 0, cgst = 0, sgst = 0, igst = 0, cess = 0, round_off = 0, declaredTotal, seller, buyer } = {}) {
  const d = Math.max(0, num(discount));
  const tax = { cgst: num(cgst), sgst: num(sgst), igst: num(igst), cess: num(cess) };
  const printedTax = tax.cgst + tax.sgst + tax.igst + tax.cess;
  const printedTotal = num(declaredTotal);

  // The printed line amount is what the reader can actually see; fall back to qty × rate only when it is absent.
  const lines = items.map((it) => {
    const amount = num(it.taxable_value) || (num(it.quantity) * num(it.rate)) || num(it.total);
    return { amount, gstRate: num(it.gst_rate) };
  });
  const gross = lines.reduce((s, l) => s + l.amount, 0);

  const result = {
    mode: "insufficient_data",
    printed: { total: round2(printedTotal), discount: round2(d), cgst: round2(tax.cgst), sgst: round2(tax.sgst), igst: round2(tax.igst), tax: round2(printedTax) },
    hypotheses: null,
    resolved: null,
    checks: [],
    notes: [],
    warnings: [],
    discrepancy_pct: 0,
  };

  if (!(printedTotal > 0) || !(gross > 0)) {
    result.checks.push({ id: "total_reconciles", status: "skip", message: "Needs both line items and a printed grand total to reconcile." });
    return result;
  }

  const tol = Math.max(1.01, printedTotal * 0.0005); // ₹1 rounding, or 0.05% on large bills
  const afterDiscount = gross - d;
  const ro = num(round_off);

  // Hypothesis A — exclusive: GST is added on top of the line amounts.
  const totalExclusive = afterDiscount + printedTax + ro;
  // Hypothesis B — inclusive: the line amounts already contain the GST.
  const totalInclusive = afterDiscount + ro;
  const deltaE = Math.abs(totalExclusive - printedTotal);
  const deltaI = Math.abs(totalInclusive - printedTotal);
  result.hypotheses = {
    exclusive: { total: round2(totalExclusive), delta: round2(deltaE) },
    inclusive: { total: round2(totalInclusive), delta: round2(deltaI) },
  };

  let mode;
  if (deltaE <= tol) mode = "exclusive";
  else if (deltaI <= tol && printedTax > 0) mode = "inclusive";
  else mode = "unresolved";
  result.mode = mode;

  if (mode === "unresolved") {
    const best = Math.min(deltaE, deltaI);
    result.discrepancy_pct = best / printedTotal;
    result.checks.push({ id: "total_reconciles", status: "fail", message: `Neither ex-tax nor GST-inclusive pricing reproduces the printed total (off by at least ₹${round2(best)}).` });
    result.warnings.push(`Total discrepancy: line items and tax give ₹${round2(totalExclusive)} (or ₹${round2(totalInclusive)} if prices include GST) but the invoice prints ₹${round2(printedTotal)}. A quantity, rate or tax value may have been misread, or the bill carries an extra charge (freight, packing) that was not captured.`);
    return result;
  }
  result.checks.push({ id: "total_reconciles", status: "pass", message: mode === "inclusive" ? "Reconciles with the printed total when prices are read as GST-inclusive." : "Line items plus GST reconcile with the printed total." });

  // Effective GST rate (%), used both to convert inclusive prices and to sanity-check the tax.
  const taxableBase = mode === "inclusive" ? afterDiscount - printedTax : afterDiscount;
  const effectiveRate = taxableBase > 0 ? (printedTax / taxableBase) * 100 : 0;
  const itemRates = [...new Set(lines.map((l) => l.gstRate).filter((r) => r > 0))];

  // Build the ex-tax view that downstream code (invoice form: subtotal − discount + tax) can use as-is.
  const rateFor = (l) => (l.gstRate > 0 ? l.gstRate : effectiveRate);
  let resolvedItems;
  let subtotal;
  let discountEx;
  if (mode === "inclusive") {
    resolvedItems = lines.map((l, i) => {
      const r = rateFor(l);
      const exAmount = l.amount / (1 + r / 100);
      const qty = num(items[i].quantity) || 1;
      return { index: i, gst_rate: round2(r), taxable_value: round2(exAmount), rate: round2(exAmount / qty) };
    });
    subtotal = lines.reduce((s, l) => s + l.amount / (1 + rateFor(l) / 100), 0);
    // A document-level discount is applied to the GST-inclusive amounts, so spread it across the lines pro rata before stripping the tax.
    discountEx = d > 0 ? lines.reduce((s, l) => s + (d * (l.amount / gross)) / (1 + rateFor(l) / 100), 0) : 0;
    result.notes.push("Prices on this bill already include GST (MRP-style). They were converted to ex-tax values so that taxable value + GST equals the printed total.");
  } else {
    resolvedItems = lines.map((l, i) => {
      const qty = num(items[i].quantity) || 1;
      return { index: i, gst_rate: round2(l.gstRate || effectiveRate), taxable_value: round2(l.amount), rate: round2(num(items[i].rate) || l.amount / qty) };
    });
    subtotal = gross;
    discountEx = d;
  }
  const taxableValue = subtotal - discountEx;
  result.resolved = {
    items: resolvedItems,
    subtotal: round2(subtotal),
    discount: round2(discountEx),
    taxable_value: round2(taxableValue),
    cgst: round2(tax.cgst), sgst: round2(tax.sgst), igst: round2(tax.igst), cess: round2(tax.cess),
    round_off: round2(printedTotal - (taxableValue + printedTax)),
    total: round2(printedTotal),
  };

  // --- Consistency checks that catch real-world extraction slips -------------------------------------
  if (tax.cgst > 0 && tax.igst > 0) {
    result.checks.push({ id: "tax_type", status: "fail", message: "Both CGST/SGST and IGST are charged." });
    result.warnings.push("Both CGST/SGST and IGST are present — a bill charges one or the other, never both.");
  } else {
    result.checks.push({ id: "tax_type", status: "pass", message: "Only one tax type is charged." });
  }

  if (tax.cgst > 0 || tax.sgst > 0) {
    const off = Math.abs(tax.cgst - tax.sgst);
    if (off > Math.max(0.05, 0.005 * Math.max(tax.cgst, tax.sgst))) {
      result.checks.push({ id: "cgst_sgst_equal", status: "warn", message: "CGST and SGST differ." });
      result.warnings.push(`CGST (₹${round2(tax.cgst)}) and SGST (₹${round2(tax.sgst)}) should be equal — one of them may have been misread.`);
    } else {
      result.checks.push({ id: "cgst_sgst_equal", status: "pass", message: "CGST and SGST are equal." });
    }
  }

  const sellerCode = stateCodeOf(seller);
  const buyerCode = stateCodeOf(buyer);
  if (sellerCode && buyerCode && printedTax > 0) {
    const intra = sellerCode === buyerCode;
    if (intra && tax.igst > 0) {
      result.checks.push({ id: "jurisdiction", status: "warn", message: "Same-state supply charged IGST." });
      result.warnings.push(`Seller and buyer are both in ${STATE_CODES[sellerCode]}, so CGST + SGST is expected — the bill shows IGST.`);
    } else if (!intra && (tax.cgst > 0 || tax.sgst > 0)) {
      result.checks.push({ id: "jurisdiction", status: "warn", message: "Inter-state supply charged CGST/SGST." });
      result.warnings.push(`Seller (${STATE_CODES[sellerCode]}) and buyer (${STATE_CODES[buyerCode]}) are in different states, so IGST is expected — the bill shows CGST/SGST.`);
    } else {
      result.checks.push({ id: "jurisdiction", status: "pass", message: intra ? "Same state, CGST + SGST." : "Different states, IGST." });
    }
  } else {
    result.checks.push({ id: "jurisdiction", status: "skip", message: "Seller/buyer state not both known." });
  }

  if (printedTax > 0 && itemRates.length <= 1) {
    if (itemRates.length === 1 && Math.abs(effectiveRate - itemRates[0]) > SLAB_TOLERANCE_PP) {
      result.checks.push({ id: "gst_rate", status: "warn", message: `Printed tax works out to ${round2(effectiveRate)}%, items say ${itemRates[0]}%.` });
      result.warnings.push(`Printed tax works out to ${round2(effectiveRate)}% of taxable value but the line items are at ${itemRates[0]}% — check the tax amounts or rates.`);
    } else if (itemRates.length === 0 && Math.abs(effectiveRate - nearestSlab(effectiveRate)) > SLAB_TOLERANCE_PP) {
      result.checks.push({ id: "gst_rate", status: "warn", message: `Effective GST rate ${round2(effectiveRate)}% is not a standard slab.` });
      result.warnings.push(`Effective GST rate comes to ${round2(effectiveRate)}%, which is not a standard slab (${GST_SLABS.join("/")}%) — a quantity, rate or tax value may have been misread.`);
    } else {
      result.checks.push({ id: "gst_rate", status: "pass", message: `Effective GST rate ${round2(effectiveRate)}% is consistent.` });
    }
  } else {
    result.checks.push({ id: "gst_rate", status: "skip", message: itemRates.length > 1 ? "Mixed GST rates on this bill." : "No tax charged." });
  }

  return result;
}
