import { test } from "node:test";
import assert from "node:assert/strict";
import Invoice from "../../models/Invoice.js";
import User from "../../models/User.js";
import {
  HttpError,
  buildListFilters,
  exactMatchCI,
  parsePagination,
  parseSort,
  sanitizeWriteBody,
} from "../../utils/entityGuard.js";
import { assertProductionEnv, getAllowedOrigins, getFrontendOrigin, isOriginAllowed } from "../../config/env.js";

const VALID_ID = "64b7f0c2a1b2c3d4e5f60718";

test("sanitizeWriteBody strips server-controlled fields but keeps real data", () => {
  const clean = sanitizeWriteBody({ notes: "hi", created_by: "evil@x.com", id: VALID_ID, _id: VALID_ID, created_date: "2020-01-01", "created_by.x": 1 });
  assert.deepEqual(clean, { notes: "hi" });
});

test("sanitizeWriteBody rejects Mongo update operators and non-objects", () => {
  assert.throws(() => sanitizeWriteBody({ $set: { created_by: "evil@x.com" } }), HttpError);
  assert.throws(() => sanitizeWriteBody([]), HttpError);
  assert.throws(() => sanitizeWriteBody(null), HttpError);
  assert.throws(() => sanitizeWriteBody("x"), HttpError);
});

test("buildListFilters accepts plain schema fields and maps id to _id", () => {
  assert.deepEqual(buildListFilters(Invoice, { customer_id: "abc", sort: "-created_date", limit: "5" }), { customer_id: "abc" });
  assert.deepEqual(buildListFilters(Invoice, { id: VALID_ID }), { _id: VALID_ID });
});

test("buildListFilters blocks ownership override, secrets, unknown fields and operators", () => {
  const bad = [
    { created_by: "victim@x.com" },
    { "created_by[$ne]": "x" },
    { created_by: { $ne: "x" } },
    { customer_id: { $ne: "x" } },
    { customer_id: ["a", "b"] },
    { password: "x" },
    { refresh_token: "x" },
    { not_a_field: "x" },
    { id: "not-an-object-id" },
    { customer_id: "x".repeat(201) },
  ];
  for (const query of bad) {
    assert.throws(() => buildListFilters(Invoice, query), HttpError, JSON.stringify(query));
  }
});

test("parseSort only allows real fields, or an explicit allow-list", () => {
  assert.deepEqual(parseSort(Invoice, undefined), { created_date: -1 });
  assert.deepEqual(parseSort(Invoice, "-total"), { total: -1 });
  assert.throws(() => parseSort(Invoice, "nope"), HttpError);
  assert.throws(() => parseSort(Invoice, { $ne: 1 }), HttpError);
  // Sorting users by password hash would leak information through ordering.
  assert.throws(() => parseSort(User, "password", ["created_date", "email"]), HttpError);
  assert.deepEqual(parseSort(User, "email", ["created_date", "email"]), { email: 1 });
});

test("parsePagination clamps to sane bounds and keeps the bulk-import limit working", () => {
  assert.deepEqual(parsePagination({}), { limit: 200, skip: 0 });
  assert.deepEqual(parsePagination({ limit: "100000", skip: "5" }), { limit: 100000, skip: 5 });
  assert.deepEqual(parsePagination({ limit: "999999999", skip: "-3" }), { limit: 100000, skip: 0 });
  assert.deepEqual(parsePagination({ limit: "0" }), { limit: 1, skip: 0 });
  assert.deepEqual(parsePagination({ limit: "abc" }), { limit: 200, skip: 0 });
});

test("exactMatchCI treats user text literally", () => {
  assert.ok(exactMatchCI("Sharma & Sons (Pvt").test("sharma & sons (pvt"));
  assert.ok(!exactMatchCI(".*").test("anything"));
  assert.ok(!exactMatchCI("a").test("ab"));
  // Would hang a naive `new RegExp(name)`: catastrophic backtracking pattern.
  const started = Date.now();
  exactMatchCI("(a+)+$").test("a".repeat(40) + "!");
  assert.ok(Date.now() - started < 200);
});

test("assertProductionEnv fails closed on missing, placeholder, short or shared secrets", () => {
  const saved = { ...process.env };
  const setEnv = (env) => {
    for (const k of ["NODE_ENV", "JWT_SECRET", "JWT_REFRESH_SECRET"]) delete process.env[k];
    Object.assign(process.env, env);
  };
  try {
    const strongA = "a".repeat(40);
    const strongB = "b".repeat(40);

    setEnv({ NODE_ENV: "development" });
    assert.doesNotThrow(() => assertProductionEnv());

    setEnv({ NODE_ENV: "production" });
    assert.throws(() => assertProductionEnv(), /JWT_SECRET is missing/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: "your_jwt_access_secret_key_here", JWT_REFRESH_SECRET: strongB });
    assert.throws(() => assertProductionEnv(), /placeholder/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: "short", JWT_REFRESH_SECRET: strongB });
    assert.throws(() => assertProductionEnv(), /at least 32/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: strongA, JWT_REFRESH_SECRET: strongA });
    assert.throws(() => assertProductionEnv(), /must be different/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: strongA, JWT_REFRESH_SECRET: strongB, EMAIL_TRANSPORT: "console" });
    assert.doesNotThrow(() => assertProductionEnv());
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("getFrontendOrigin uses only the first of several comma-separated origins", () => {
  const saved = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://app.example.com/, https://other.example.com";
  try {
    assert.equal(getFrontendOrigin(), "https://app.example.com");
  } finally {
    if (saved === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved;
  }
});

test("FRONTEND_URL entries are normalised: a trailing slash must not break CORS", () => {
  const saved = { url: process.env.FRONTEND_URL, env: process.env.NODE_ENV };
  try {
    process.env.NODE_ENV = "production";
    // The exact mistake that locked users out: URL pasted with a trailing slash.
    process.env.FRONTEND_URL = "https://mytaxsya-ecru.vercel.app/";
    assert.deepEqual(getAllowedOrigins(), ["https://mytaxsya-ecru.vercel.app"]);
    assert.equal(isOriginAllowed("https://mytaxsya-ecru.vercel.app"), true, "browser Origin has no trailing slash");
    assert.equal(getFrontendOrigin(), "https://mytaxsya-ecru.vercel.app", "redirects must not become //login");

    process.env.FRONTEND_URL = " https://a.example.com// , https://b.example.com ,, ";
    assert.deepEqual(getAllowedOrigins(), ["https://a.example.com", "https://b.example.com"]);
    assert.equal(isOriginAllowed("https://b.example.com"), true);
  } finally {
    if (saved.url === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved.url;
    if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
  }
});

test("production CORS is strict, development and origin-less requests are open", () => {
  const saved = { url: process.env.FRONTEND_URL, env: process.env.NODE_ENV };
  try {
    process.env.FRONTEND_URL = "https://mytaxsya-ecru.vercel.app";
    process.env.NODE_ENV = "production";
    assert.equal(isOriginAllowed("https://evil.example.com"), false);
    assert.equal(isOriginAllowed("https://mytaxsya-ecru.vercel.app.evil.com"), false, "no prefix matching");
    assert.equal(isOriginAllowed(undefined), true, "health checks and curl send no Origin");
    process.env.NODE_ENV = "development";
    assert.equal(isOriginAllowed("https://evil.example.com"), true);
  } finally {
    if (saved.url === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved.url;
    if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
  }
});

import { isValidGstin } from "../../services/invoiceMath.js";
test("isValidGstin checks format, state code and check digit", () => {
  assert.equal(isValidGstin("27AAPFU0939F1ZV"), true);
  assert.equal(isValidGstin("27AAPFU0939F1ZW"), false); // wrong check digit
  assert.equal(isValidGstin("99AAPFU0939F1ZV"), false); // no such state
  assert.equal(isValidGstin(""), false);
});

import { reconcileInvoice } from "../../services/invoiceMath.js";
test("an implausibly large round-off cannot make a wrong bill reconcile as GST-inclusive", () => {
  const r = reconcileInvoice({ items: [{ quantity: 1050, rate: 35, taxable_value: 36750 }], igst: 1837.5, round_off: 1838, declaredTotal: 38588 });
  assert.equal(r.mode, "exclusive");
  assert.ok(r.warnings.some((w) => /round-off/i.test(w)));
});

import { normalizeInvoiceDate } from "../../services/extractionEngine.js";
test("a handwritten 3-digit year such as 026 is read as 2026, not dropped", () => {
  assert.equal(normalizeInvoiceDate("15/07/026"), "2026-07-15");
  assert.equal(normalizeInvoiceDate("15/07/2026"), "2026-07-15");
  assert.equal(normalizeInvoiceDate("15/07/26"), "2026-07-15");
});

import { verifyAgainstSource, numbersInText } from "../../services/invoiceMath.js";
const PDF_TEXT = "TAX INVOICE\nExample Traders GSTIN: 27AAPFU0939F1ZV\nInvoice No. KC/SL/26-27/39\nGrand Total ₹ 1,66,468.5\nIGST 25,393.5\n" + "x".repeat(40);
test("numbersInText reads Indian and plain formats alike", () => {
  const n = numbersInText("₹ 1,66,468.50 and 166468.5 and 25,393.5");
  assert.ok(n.has(166468.5) && n.has(25393.5));
});
test("grounding accepts values found in the PDF text", () => {
  const r = verifyAgainstSource({ invoice_number: "KC/SL/26-27/39", total_amount: 166468.5, igst: 25393.5, seller: { gstin: "27AAPFU0939F1ZV" }, buyer: {} }, PDF_TEXT);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.corrections, []);
});
test("grounding snaps a misread GSTIN to the valid one in the text, and flags an amount that is not there", () => {
  const ex = { invoice_number: "KC/SL/26-27/39", total_amount: 166486.5, seller: { gstin: "27AAPFU0939F1ZW" }, buyer: {} };
  const r = verifyAgainstSource(ex, PDF_TEXT);
  assert.equal(ex.seller.gstin, "27AAPFU0939F1ZV");
  assert.equal(r.corrections.length, 1);
  assert.ok(r.warnings.some((w) => /Grand total/.test(w)));
});
test("grounding does nothing without a usable text layer", () => {
  assert.deepEqual(verifyAgainstSource({ invoice_number: "X" }, ""), { warnings: [], corrections: [] });
});

test("OCR text only repairs a GSTIN that already fails its check digit", () => {
  const ocr = "Seller GSTIN: 27AAPFU0939F1ZV ... " + "x".repeat(40);
  const bad = { seller: { gstin: "27AAPFU0939F1ZW" }, buyer: {} };
  assert.equal(verifyAgainstSource(bad, ocr, { gstinOnly: true }).corrections.length, 1);
  assert.equal(bad.seller.gstin, "27AAPFU0939F1ZV");
  const valid = { seller: { gstin: "09AABCU9603R1ZM" }, buyer: {} };
  verifyAgainstSource(valid, ocr, { gstinOnly: true });
  assert.equal(valid.seller.gstin, "09AABCU9603R1ZM");
});
