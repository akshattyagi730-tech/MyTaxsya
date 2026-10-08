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
  // A real round-off is paise to a few rupees. A bigger "round-off" is a misread (e.g. a tax figure read
  // from the wrong row) and would let a wrong bill reconcile, so it is ignored for the maths.
  const roRaw = num(round_off);
  const ro = Math.abs(roRaw) <= 10 ? roRaw : 0;

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

  if (ro !== roRaw) result.warnings.push(`Round-off of ₹${round2(roRaw)} is too large to be a real round-off, so it was ignored — check that row of the bill.`);

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

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** True when a GSTIN has a valid state code, PAN-shaped body and correct check character. */
export function isValidGstin(value) {
  const g = String(value || "").trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) || !STATE_CODES[g.slice(0, 2)]) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

// ---------------------------------------------------------------------------------------------
// Grounding: for a digital PDF the document's own text is the ground truth, so every value the model
// returned can be looked up in it. A value that is not in the text was misread or invented.
// ---------------------------------------------------------------------------------------------

/** All numbers in a text as plain numbers: "1,66,468.50" and "166468.5" both become 166468.5. */
export function numbersInText(text = "") {
  const found = new Set();
  for (const m of String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) found.add(Math.round(n * 100) / 100);
  }
  return found;
}

const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** GSTIN-shaped tokens in the text that also pass the check-digit test. */
export function gstinsInText(text = "") {
  const tokens = String(text).toUpperCase().match(/\b\d{2}[A-Z0-9]{13}\b/g) || [];
  return [...new Set(tokens.filter(isValidGstin))];
}

const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/**
 * Checks an extraction against the PDF's own text. Returns { warnings, corrections }:
 *  - a GSTIN that is not in the text is replaced by the one valid GSTIN in the text that is 1-2
 *    characters away from it (a misread letter/digit), otherwise only warned about;
 *  - the invoice number, grand total and tax amounts that are not in the text are warned about.
 * It never changes amounts: those it only flags.
 */
export function verifyAgainstSource(extracted, sourceText, { gstinOnly = false } = {}) {
  const warnings = [];
  const corrections = [];
  if (!sourceText || sourceText.trim().length < 50) return { warnings, corrections };

  const textSquashed = squash(sourceText);
  const nums = numbersInText(sourceText);
  const textGstins = gstinsInText(sourceText);

  for (const [role, party] of [["Seller", extracted.seller], ["Buyer", extracted.buyer]]) {
    const g = squash(party?.gstin);
    if (!g || textSquashed.includes(g)) continue;
    // OCR text of a scan/photo is noisy, so there it is only trusted to repair a GSTIN that already fails its check digit.
    if (gstinOnly && isValidGstin(g)) continue;
    const near = textGstins.filter((t) => editDistance(t, g) <= 2);
    if (near.length === 1) {
      corrections.push(`${role} GSTIN corrected from "${party.gstin}" to "${near[0]}" to match the PDF text.`);
      party.gstin = near[0];
    } else if (!gstinOnly) {
      warnings.push(`${role} GSTIN "${party.gstin}" does not appear in the PDF text — it may have been misread.`);
    }
  }

  if (gstinOnly) return { warnings, corrections };

  const inv = squash(extracted.invoice_number);
  if (inv && !textSquashed.includes(inv)) warnings.push(`Invoice number "${extracted.invoice_number}" does not appear in the PDF text — it may have been misread.`);

  const amounts = { "Grand total": extracted.total_amount, CGST: extracted.cgst, SGST: extracted.sgst, IGST: extracted.igst, Discount: extracted.discount };
  for (const [label, value] of Object.entries(amounts)) {
    const v = Number(value);
    if (!(v > 0)) continue;
    const r = Math.round(v * 100) / 100;
    // Rounded/derived figures can legitimately be printed to the rupee, so allow a ±0.5 neighbour.
    const present = [...nums].some((n) => Math.abs(n - r) < 0.011) || (label === "Grand total" && [...nums].some((n) => Math.abs(n - r) <= 0.51));
    if (!present) warnings.push(`${label} ₹${r} does not appear in the PDF text — it may have been misread or calculated instead of read.`);
  }
  return { warnings, corrections };
}
