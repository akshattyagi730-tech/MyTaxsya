import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMongod, startApp, makeClient } from "./helpers/testServer.js";

// Regression guard for the everyday accounting flows that run through the generic
// /api/entities routes: stock, payments, balances, bulk import, settings saves.
// These are the behaviours the security hardening of that controller must not change.

let mongod;
let app;
let call;
let outbox;
let token;

before(async () => {
  mongod = await startMongod();
  if (!mongod) return;
  app = await startApp(mongod.uri);
  call = makeClient(app.base);
  ({ outbox } = await import("../../services/emailService.js"));

  const address = "flows@example.com";
  await call("POST", "/api/auth/register", { body: { email: address, password: "correct-horse-battery" } });
  const otp = [...outbox].reverse().find((m) => m.to === address).text.match(/\b(\d{6})\b/)[1];
  const verified = await call("POST", "/api/auth/verify-otp", { body: { email: address, otpCode: otp } });
  token = verified.body.access_token;
});

after(async () => {
  if (app) await app.close();
  if (mongod) await mongod.stop();
});

const dbTest = (name, fn) => test(name, async (t) => {
  if (!mongod) return t.skip("mongod is not installed; set MONGOD_BIN to run the API tests");
  await fn(t);
});

const api = (method, path, body) => call(method, `/api/entities/${path}`, { token, body });
const idOf = (doc) => doc.id || doc._id;

// State shared by the ordered steps below (node:test runs tests in a file sequentially).
const s = {};

dbTest("create a product, a customer and a supplier", async () => {
  const product = await api("POST", "Product", { name: "Widget", sku: "W-1", stock_quantity: 10, purchase_price: 50, selling_price: 100, gst_rate: 18 });
  assert.equal(product.status, 201);
  s.product = idOf(product.body);

  const customer = await api("POST", "Customer", { name: "Acme Traders", state: "Maharashtra" });
  assert.equal(customer.status, 201);
  s.customer = idOf(customer.body);

  const supplier = await api("POST", "Supplier", { name: "Sup Co" });
  assert.equal(supplier.status, 201);
  s.supplier = idOf(supplier.body);

  // Duplicates are still refused
  assert.equal((await api("POST", "Product", { name: "Another", sku: "W-1" })).status, 400);
  assert.equal((await api("POST", "Customer", { name: "acme traders" })).status, 400);
});

dbTest("an issued invoice reduces stock; overselling is refused", async () => {
  const invoice = await api("POST", "Invoice", {
    invoice_number: "INV-1", customer_id: s.customer, customer_name: "Acme Traders", status: "sent",
    invoice_date: "2026-09-01", due_date: "2026-09-30",
    subtotal: 300, cgst: 27, sgst: 27, total: 354, balance_due: 354,
    items: [{ product_id: s.product, description: "Widget", quantity: 3, rate: 100, gst_rate: 18 }],
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
  s.invoice = idOf(invoice.body);

  assert.equal((await api("GET", `Product/${s.product}`)).body.stock_quantity, 7);

  const oversell = await api("POST", "Invoice", {
    invoice_number: "INV-2", customer_id: s.customer, status: "sent", total: 1, items: [{ product_id: s.product, quantity: 20, rate: 1 }],
  });
  assert.equal(oversell.status, 400);
  assert.match(oversell.body.error, /Insufficient stock/);
  assert.equal((await api("GET", `Product/${s.product}`)).body.stock_quantity, 7);

  // A draft does not touch stock
  const draft = await api("POST", "Invoice", { invoice_number: "INV-3", customer_id: s.customer, status: "draft", items: [{ product_id: s.product, quantity: 2, rate: 1 }] });
  assert.equal(draft.status, 201);
  assert.equal((await api("GET", `Product/${s.product}`)).body.stock_quantity, 7);
});

dbTest("customer outstanding reflects unpaid invoices", async () => {
  assert.equal((await api("GET", `Customer/${s.customer}`)).body.outstanding_amount, 354);
  const list = await api("GET", "Customer");
  assert.equal(list.body.find((c) => idOf(c) === s.customer).outstanding_amount, 354);
});

dbTest("payments update the invoice balance and status, and revert cleanly", async () => {
  const p1 = await api("POST", "Payment", { payment_number: "PAY-1", invoice_id: s.invoice, customer_id: s.customer, amount: 154, status: "success", date: "2026-09-05" });
  assert.equal(p1.status, 201);
  let inv = (await api("GET", `Invoice/${s.invoice}`)).body;
  assert.equal(inv.paid_amount, 154);
  assert.equal(inv.balance_due, 200);
  assert.equal(inv.status, "sent");

  const p2 = await api("POST", "Payment", { payment_number: "PAY-2", invoice_id: s.invoice, customer_id: s.customer, amount: 200, status: "success", date: "2026-09-06" });
  assert.equal(p2.status, 201);
  inv = (await api("GET", `Invoice/${s.invoice}`)).body;
  assert.equal(inv.status, "paid");
  assert.equal(inv.balance_due, 0);

  // Marking the second payment failed puts the invoice back to partly paid
  assert.equal((await api("PUT", `Payment/${idOf(p2.body)}`, { status: "failed" })).status, 200);
  inv = (await api("GET", `Invoice/${s.invoice}`)).body;
  assert.equal(inv.paid_amount, 154);
  assert.equal(inv.balance_due, 200);
  assert.notEqual(inv.status, "paid");

  // Deleting the first payment reverts it too
  assert.equal((await api("DELETE", `Payment/${idOf(p1.body)}`)).status, 200);
  inv = (await api("GET", `Invoice/${s.invoice}`)).body;
  assert.equal(inv.paid_amount, 0);
  assert.equal(inv.balance_due, 354);
});

dbTest("editing an invoice moves stock by the difference; deleting restores it", async () => {
  // 3 -> 5 units
  const edit = await api("PUT", `Invoice/${s.invoice}`, { items: [{ product_id: s.product, description: "Widget", quantity: 5, rate: 100, gst_rate: 18 }] });
  assert.equal(edit.status, 200);
  assert.equal((await api("GET", `Product/${s.product}`)).body.stock_quantity, 5);

  assert.equal((await api("DELETE", `Invoice/${s.invoice}`)).status, 200);
  assert.equal((await api("GET", `Product/${s.product}`)).body.stock_quantity, 10);
  assert.equal((await api("GET", `Invoice/${s.invoice}`)).status, 404);
});

dbTest("purchase bills save with dates, refuse duplicates, and supplier balances use pending expenses", async () => {
  const bill = {
    bill_number: "B-1", supplier_name: "Sup Co", supplier_gstin: "27AAAAA0000A1Z5", bill_date: "2026-09-01",
    items: [{ description: "Raw material", hsn: "1234", quantity: 1, rate: 100, taxable_value: 100, gst_rate: 18 }],
    taxable_value: 100, cgst: 9, sgst: 9, total: 118, status: "recorded",
  };
  const created = await api("POST", "PurchaseBill", bill);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(new Date(created.body.bill_date).toISOString().slice(0, 10), "2026-09-01");
  assert.equal((await api("POST", "PurchaseBill", bill)).status, 400);

  await api("POST", "Expense", { title: "Freight", amount: 500, date: "2026-09-02", vendor: "Sup Co", status: "pending" });
  assert.equal((await api("GET", `Supplier/${s.supplier}`)).body.outstanding_amount, 500);
});

dbTest("bulk import creates every row, owned by the caller, and rejects duplicates", async () => {
  const rows = ["A", "B", "C"].map((n) => ({ invoice_number: `BULK-${n}`, customer_id: s.customer, customer_name: "Acme Traders", status: "draft", invoice_date: "2026-08-15", total: 10 }));
  const res = await api("POST", "Invoice", rows);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.length, 3);
  assert.ok(res.body.every((r) => r.created_by === "flows@example.com"));

  assert.equal((await api("POST", "Invoice", [rows[0]])).status, 400);

  // The bulk-import dialog loads everything with a huge limit
  const all = await api("GET", "Invoice?limit=100000");
  assert.equal(all.status, 200);
  assert.ok(all.body.length >= 4);
});

dbTest("listing supports the filters, sort and paging the app uses", async () => {
  const byCustomer = await api("GET", `Invoice?customer_id=${s.customer}&limit=50`);
  assert.equal(byCustomer.status, 200);
  assert.ok(byCustomer.body.length >= 3 && byCustomer.body.every((i) => i.customer_id === s.customer));

  const sorted = await api("GET", "Customer?sort=name&limit=200");
  assert.equal(sorted.status, 200);

  const page = await api("GET", "Invoice?sort=-created_date&limit=2&skip=1");
  assert.equal(page.body.length, 2);
});

dbTest("Settings can save the whole business object it loaded", async () => {
  const created = await api("POST", "Business", { name: "My Co", gstin: "27AAAAA0000A1Z5", state: "Maharashtra", gst_enabled: true });
  assert.equal(created.status, 201);

  // The page PUTs back everything it received: id, created_by, timestamps and all
  const loaded = (await api("GET", "Business")).body[0];
  const saved = await api("PUT", `Business/${idOf(loaded)}`, { ...loaded, name: "My Co Pvt Ltd", city: "Pune" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.name, "My Co Pvt Ltd");
  assert.equal(saved.body.city, "Pune");
  assert.equal(saved.body.created_by, "flows@example.com");
});

dbTest("notifications, current user and AI metrics endpoints still respond", async () => {
  const note = await api("POST", "Notification", { title: "Low stock", message: "Widget is running low", type: "warning", category: "inventory" });
  assert.equal(note.status, 201);
  assert.equal((await api("PUT", `Notification/${idOf(note.body)}`, { read: true })).body.read, true);

  assert.equal((await call("GET", "/api/auth/me", { token })).status, 200);
  assert.equal((await call("GET", "/api/assistant/ai-metrics", { token })).status, 200);
  assert.equal((await call("GET", "/api/assistant/ai-metrics")).status, 401);
  assert.equal((await call("GET", "/api/health")).status, 200);
});

dbTest("delete-all only removes the caller's own records of that type", async () => {
  assert.equal((await api("DELETE", "Invoice/all")).status, 200);
  assert.deepEqual((await api("GET", "Invoice")).body, []);
  // Other record types are untouched
  assert.ok((await api("GET", "Customer")).body.length >= 1);
});
