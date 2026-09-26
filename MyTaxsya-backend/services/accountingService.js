import Invoice from "../models/Invoice.js";
import PurchaseBill from "../models/PurchaseBill.js";
import Expense from "../models/Expense.js";
import Business from "../models/Business.js";

// Single source of truth for every accounting number the AI assistant (and any
// future report) may quote. Everything here is plain deterministic code — the
// language model only ever *reads* these results, it never computes them.
//
// The rules deliberately mirror the GST Center page so the two screens can
// never disagree about the same figure:
//   - Output tax counts only issued invoices (sent / paid / overdue) —
//     drafts and cancelled invoices are excluded.
//   - Input tax credit counts only purchase bills that are recorded (not
//     draft) and not marked ITC-ineligible (Sec. 17(5) blocked credits).

export const ISSUED_STATUSES = ["sent", "paid", "overdue"];
const MAX_ROWS = 50;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const invoiceTax = (i) => (i.cgst || 0) + (i.sgst || 0) + (i.igst || 0);
const billTax = (b) => (b.cgst || 0) + (b.sgst || 0) + (b.igst || 0);
const iso = (d) => (d ? new Date(d).toISOString().split("T")[0] : null);

/**
 * Resolve a reporting window. Dates are stored as UTC midnight, so the window
 * is built in UTC and its end is exclusive.
 *   { month: "2026-08" }            -> that calendar month
 *   { from: "2026-04-01", to: ... } -> inclusive day range
 *   {}                              -> all time
 */
export function resolvePeriod({ month, from, to } = {}) {
  if (month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
    if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Invalid month "${month}" — use YYYY-MM.`);
    const start = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
    const end = new Date(Date.UTC(+m[1], +m[2], 1));
    return { start, end, label: `${m[1]}-${m[2]}` };
  }
  const parse = (v, name) => {
    if (!v) return null;
    const d = new Date(`${String(v).trim()}T00:00:00.000Z`);
    if (isNaN(d.getTime())) throw new Error(`Invalid ${name} "${v}" — use YYYY-MM-DD.`);
    return d;
  };
  const start = parse(from, "from");
  const endInclusive = parse(to, "to");
  const end = endInclusive ? new Date(endInclusive.getTime() + 86400000) : null;
  const label = start || end ? `${iso(start) || "beginning"} to ${endInclusive ? iso(endInclusive) : "today"}` : "all time";
  return { start, end, label };
}

const dateFilter = (field, { start, end }) => {
  if (!start && !end) return {};
  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lt = end;
  return { [field]: range };
};

export async function getGstSummary(userEmail, periodArgs = {}) {
  const period = resolvePeriod(periodArgs);
  const [invoices, bills] = await Promise.all([
    Invoice.find({ created_by: userEmail, ...dateFilter("invoice_date", period) }).lean(),
    PurchaseBill.find({ created_by: userEmail, ...dateFilter("bill_date", period) }).lean(),
  ]);

  const issued = invoices.filter((i) => ISSUED_STATUSES.includes(i.status));
  const excludedInvoices = invoices.filter((i) => !ISSUED_STATUSES.includes(i.status));
  const outputCGST = issued.reduce((s, i) => s + (i.cgst || 0), 0);
  const outputSGST = issued.reduce((s, i) => s + (i.sgst || 0), 0);
  const outputIGST = issued.reduce((s, i) => s + (i.igst || 0), 0);
  const outputTax = outputCGST + outputSGST + outputIGST;

  const isEligible = (b) => b.status === "recorded" && b.itc_eligible !== false && billTax(b) > 0;
  const eligibleBills = bills.filter(isEligible);
  const excludedBills = bills.filter((b) => !isEligible(b));
  const inputTax = eligibleBills.reduce((s, b) => s + billTax(b), 0);

  const net = outputTax - inputTax;

  return {
    period: period.label,
    output_tax: {
      cgst: round2(outputCGST), sgst: round2(outputSGST), igst: round2(outputIGST), total: round2(outputTax),
      from_invoices: issued.length,
    },
    input_tax_credit: {
      total: round2(inputTax),
      from_purchase_bills: eligibleBills.length,
    },
    net_gst_payable: round2(Math.max(0, net)),
    itc_carried_forward: round2(Math.max(0, -net)),
    excluded_invoices: excludedInvoices.slice(0, MAX_ROWS).map((i) => ({
      invoice_number: i.invoice_number, status: i.status, tax: round2(invoiceTax(i)),
      reason: i.status === "draft" ? "Draft — not issued yet" : i.status === "cancelled" ? "Cancelled" : `Status "${i.status}"`,
    })),
    excluded_purchase_bills: excludedBills.slice(0, MAX_ROWS).map((b) => ({
      bill_number: b.bill_number, supplier: b.supplier_name, tax: round2(billTax(b)),
      reason: b.status !== "recorded" ? "Draft — not recorded yet"
        : b.itc_eligible === false ? `Blocked credit${b.itc_ineligible_reason ? ` (${b.itc_ineligible_reason.replace(/_/g, " ")})` : ""}`
        : "No GST on this bill",
    })),
    rules_applied: [
      "Output tax counts only issued invoices (sent, paid, overdue); drafts and cancelled invoices are excluded.",
      "Input tax credit counts only recorded (non-draft) purchase bills that are ITC-eligible.",
      "Net GST payable = output tax − input tax credit; if negative it is carried forward, not refunded.",
    ],
  };
}

export async function getSalesSummary(userEmail, periodArgs = {}) {
  const period = resolvePeriod(periodArgs);
  const invoices = await Invoice.find({ created_by: userEmail, ...dateFilter("invoice_date", period) }).lean();
  const issued = invoices.filter((i) => ISSUED_STATUSES.includes(i.status));

  const byStatus = {};
  invoices.forEach((i) => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });

  const customers = {};
  const products = {};
  issued.forEach((i) => {
    const c = i.customer_name || "Unknown customer";
    customers[c] = (customers[c] || 0) + (i.total || 0);
    (i.items || []).forEach((it) => {
      const p = it.description || "Unknown item";
      products[p] = products[p] || { revenue: 0, quantity: 0 };
      products[p].revenue += (it.quantity || 0) * (it.rate || 0);
      products[p].quantity += it.quantity || 0;
    });
  });
  const top = (obj, mapFn) => Object.entries(obj).sort((a, b) => mapFn(b[1]) - mapFn(a[1])).slice(0, 10);

  return {
    period: period.label,
    issued_invoices: issued.length,
    taxable_value: round2(issued.reduce((s, i) => s + ((i.subtotal || 0) - (i.discount || 0)), 0)),
    discount_given: round2(issued.reduce((s, i) => s + (i.discount || 0), 0)),
    tax_charged: round2(issued.reduce((s, i) => s + invoiceTax(i), 0)),
    total_billed: round2(issued.reduce((s, i) => s + (i.total || 0), 0)),
    invoice_count_by_status: byStatus,
    top_customers: top(customers, (v) => v).map(([name, total]) => ({ name, billed: round2(total) })),
    top_products: top(products, (v) => v.revenue).map(([name, v]) => ({ name, revenue: round2(v.revenue), quantity: v.quantity })),
    note: "Only issued invoices (sent, paid, overdue) are counted as sales; drafts and cancelled invoices are excluded.",
  };
}

export async function getPurchaseSummary(userEmail, periodArgs = {}) {
  const period = resolvePeriod(periodArgs);
  const bills = await PurchaseBill.find({ created_by: userEmail, ...dateFilter("bill_date", period) }).lean();
  const recorded = bills.filter((b) => b.status === "recorded");
  const drafts = bills.filter((b) => b.status !== "recorded");
  const blocked = recorded.filter((b) => b.itc_eligible === false);

  const suppliers = {};
  recorded.forEach((b) => { suppliers[b.supplier_name] = (suppliers[b.supplier_name] || 0) + (b.total || 0); });

  return {
    period: period.label,
    recorded_bills: recorded.length,
    draft_bills_not_counted: drafts.length,
    taxable_value: round2(recorded.reduce((s, b) => s + (b.taxable_value || 0), 0)),
    tax_paid_on_purchases: round2(recorded.reduce((s, b) => s + billTax(b), 0)),
    itc_eligible_tax: round2(recorded.filter((b) => b.itc_eligible !== false).reduce((s, b) => s + billTax(b), 0)),
    itc_blocked_tax: round2(blocked.reduce((s, b) => s + billTax(b), 0)),
    total_purchases: round2(recorded.reduce((s, b) => s + (b.total || 0), 0)),
    top_suppliers: Object.entries(suppliers).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, total]) => ({ name, total: round2(total) })),
  };
}

export async function getReceivables(userEmail) {
  const invoices = await Invoice.find({ created_by: userEmail, status: { $in: ["sent", "overdue"] } }).lean();
  const now = Date.now();
  const rows = invoices.map((i) => {
    const outstanding = Math.max(0, (i.total || 0) - (i.paid_amount || 0));
    const overdue = i.status === "overdue" || (i.due_date && new Date(i.due_date).getTime() < now);
    return {
      invoice_number: i.invoice_number, customer: i.customer_name || "Unknown customer",
      invoice_date: iso(i.invoice_date), due_date: iso(i.due_date),
      total: round2(i.total), paid: round2(i.paid_amount), outstanding: round2(outstanding), overdue: !!overdue,
    };
  }).filter((r) => r.outstanding > 0);

  const byCustomer = {};
  rows.forEach((r) => { byCustomer[r.customer] = (byCustomer[r.customer] || 0) + r.outstanding; });

  return {
    total_outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
    overdue_amount: round2(rows.filter((r) => r.overdue).reduce((s, r) => s + r.outstanding, 0)),
    unpaid_invoice_count: rows.length,
    by_customer: Object.entries(byCustomer).sort((a, b) => b[1] - a[1]).map(([customer, outstanding]) => ({ customer, outstanding: round2(outstanding) })),
    invoices: rows.sort((a, b) => b.outstanding - a.outstanding).slice(0, MAX_ROWS),
  };
}

export async function getExpenseSummary(userEmail, periodArgs = {}) {
  const period = resolvePeriod(periodArgs);
  const expenses = await Expense.find({ created_by: userEmail, ...dateFilter("date", period) }).lean();
  const byCategory = {};
  const byStatus = {};
  expenses.forEach((e) => {
    byCategory[e.category || "uncategorised"] = (byCategory[e.category || "uncategorised"] || 0) + (e.amount || 0);
    byStatus[e.status || "pending"] = (byStatus[e.status || "pending"] || 0) + 1;
  });
  const approved = expenses.filter((e) => e.status === "approved");
  return {
    period: period.label,
    expense_count: expenses.length,
    total_amount: round2(expenses.reduce((s, e) => s + (e.amount || 0), 0)),
    approved_amount: round2(approved.reduce((s, e) => s + (e.amount || 0), 0)),
    count_by_status: byStatus,
    by_category: Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount: round2(amount) })),
    note: "Expenses are operating costs. GST paid on supplier purchases is tracked through Purchase Bills, not here.",
  };
}

export async function findInvoices(userEmail, { customer, invoice_number, status, min_amount, limit, ...periodArgs } = {}) {
  const period = resolvePeriod(periodArgs);
  const q = { created_by: userEmail, ...dateFilter("invoice_date", period) };
  if (customer) q.customer_name = { $regex: escapeRegex(customer), $options: "i" };
  if (invoice_number) q.invoice_number = { $regex: escapeRegex(invoice_number), $options: "i" };
  if (status) q.status = status;
  if (min_amount) q.total = { $gte: Number(min_amount) };
  const cap = Math.min(Number(limit) || 20, MAX_ROWS);
  const [rows, count] = await Promise.all([
    Invoice.find(q).sort({ invoice_date: -1 }).limit(cap).lean(),
    Invoice.countDocuments(q),
  ]);
  return {
    matched: count,
    showing: rows.length,
    invoices: rows.map((i) => ({
      invoice_number: i.invoice_number, customer: i.customer_name, date: iso(i.invoice_date), status: i.status,
      subtotal: round2(i.subtotal), discount: round2(i.discount), cgst: round2(i.cgst), sgst: round2(i.sgst), igst: round2(i.igst),
      total: round2(i.total), paid: round2(i.paid_amount),
      items: (i.items || []).map((it) => ({ description: it.description, quantity: it.quantity, rate: it.rate, gst_rate: it.gst_rate })),
    })),
  };
}

export async function findPurchaseBills(userEmail, { supplier, bill_number, status, itc_eligible, limit, ...periodArgs } = {}) {
  const period = resolvePeriod(periodArgs);
  const q = { created_by: userEmail, ...dateFilter("bill_date", period) };
  if (supplier) q.supplier_name = { $regex: escapeRegex(supplier), $options: "i" };
  if (bill_number) q.bill_number = { $regex: escapeRegex(bill_number), $options: "i" };
  if (status) q.status = status;
  if (typeof itc_eligible === "boolean") q.itc_eligible = itc_eligible;
  const cap = Math.min(Number(limit) || 20, MAX_ROWS);
  const [rows, count] = await Promise.all([
    PurchaseBill.find(q).sort({ bill_date: -1 }).limit(cap).lean(),
    PurchaseBill.countDocuments(q),
  ]);
  return {
    matched: count,
    showing: rows.length,
    purchase_bills: rows.map((b) => ({
      bill_number: b.bill_number, supplier: b.supplier_name, supplier_gstin: b.supplier_gstin, date: iso(b.bill_date), status: b.status,
      taxable_value: round2(b.taxable_value), discount: round2(b.discount), cgst: round2(b.cgst), sgst: round2(b.sgst), igst: round2(b.igst),
      total: round2(b.total), itc_eligible: b.itc_eligible !== false, itc_ineligible_reason: b.itc_ineligible_reason || null,
    })),
  };
}

export async function getBusinessProfile(userEmail) {
  const b = await Business.findOne({ created_by: userEmail }).sort({ created_date: -1 }).lean();
  if (!b) return { found: false, note: "No business profile has been set up yet (Settings → Business Profile)." };
  return { found: true, name: b.name, legal_name: b.legal_name, gstin: b.gstin || null, state: b.state || null, gst_enabled: b.gst_enabled !== false, business_type: b.business_type };
}
