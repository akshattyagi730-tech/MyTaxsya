import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExtractedJson } from "../../services/extractionEngine.js";

// The per-line "quantity or rate may have been misread" warning must fire for a
// genuinely inconsistent line, but not for the two normal ways a bill prints its
// Amount column (ex-tax on B2B tax invoices, GST-inclusive on MRP-style bills).

const lineWarning = (item) => normalizeExtractedJson({ items: [item] }).items[0].warning;

test("ex-tax amount column (usual B2B tax invoice) is not flagged", () => {
  assert.equal(lineWarning({ description: "Widget A", quantity: 10, rate: 100, gst_rate: 18, total: 1000 }), null);
});

test("GST-inclusive amount column (MRP-style bill) is not flagged", () => {
  assert.equal(lineWarning({ description: "Tablet", quantity: 10, rate: 100, gst_rate: 18, total: 1180 }), null);
});

test("lines without GST, or without a printed amount, are not flagged", () => {
  assert.equal(lineWarning({ description: "Exempt", quantity: 2, rate: 50, gst_rate: 0, total: 100 }), null);
  assert.equal(lineWarning({ description: "No amount", quantity: 2, rate: 50, gst_rate: 18 }), null);
});

test("small rounding differences are tolerated", () => {
  assert.equal(lineWarning({ description: "Rounded", quantity: 3, rate: 33.33, gst_rate: 18, total: 100 }), null);
});

test("a line matching neither convention is flagged (e.g. a misread quantity)", () => {
  const warning = lineWarning({ description: "Widget B", quantity: 4, rate: 100, gst_rate: 18, total: 1000 });
  assert.match(warning, /Widget B/);
  assert.match(warning, /misread/);
  assert.match(warning, /400\.00/, "shows what qty x rate gives");
  assert.match(warning, /472\.00/, "and the GST-inclusive figure");
});

// --- When the AI itself fails, the caller must be able to tell -------------------------------
//
// The pipeline never crashes: with no AI answer and no readable text it returns a blank
// editable draft. It now also says *why* (`ai_failure`), so a bulk import can show "rate
// limited, retry" instead of a mysterious empty document.

import sharp from "sharp";
import { processDocumentPipeline } from "../../services/extractionEngine.js";
import { resetGeminiCooldowns } from "../../services/aiProvider.js";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const quiet = { log: console.log, warn: console.warn, error: console.error };

const setUpAi = (respond) => {
  resetGeminiCooldowns();
  Object.assign(process.env, {
    GEMINI_API_KEY: "test-key", GEMINI_MODEL: "primary-model", GEMINI_FALLBACK_MODELS: "",
    GEMINI_RETRY_BASE_MS: "1", GEMINI_MAX_RETRIES: "2",
  });
  delete process.env.GROQ_API_KEY;
  console.log = console.warn = console.error = () => {};
  globalThis.fetch = async (url) => respond(String(url));
};
const tearDownAi = () => {
  globalThis.fetch = realFetch;
  Object.assign(console, quiet);
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
};

// A small but real blank image: it survives the image preprocessing, and OCR finds no text in it.
const blankImage = () => sharp({ create: { width: 200, height: 120, channels: 3, background: "#ffffff" } }).png().toBuffer();

test("a temporary AI outage is reported as retryable on the blank draft", async (t) => {
  setUpAi(() => new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 }));
  t.after(tearDownAi);
  const result = await processDocumentPipeline(await blankImage(), "outage.png", "image/png");
  assert.equal(result.success, true, "still a draft, never a crash");
  assert.equal(result.data.ai_failure.retryable, true);
  assert.match(result.data.ai_failure.message, /high demand/i);
  assert.ok(result.data.warnings.some((w) => /AI extraction methods failed/i.test(w)));
});

test("an exhausted quota or bad key is reported as not retryable", async (t) => {
  setUpAi(() => new Response(JSON.stringify({ error: { message: "API key invalid" } }), { status: 401 }));
  t.after(tearDownAi);
  const result = await processDocumentPipeline(await blankImage(), "badkey.png", "image/png");
  assert.equal(result.data.ai_failure.code, "AI_UNAUTHORIZED");
  assert.equal(result.data.ai_failure.retryable, false);
});

test("a rate limit says how long to wait", async (t) => {
  setUpAi(() => new Response(JSON.stringify({ error: { message: "Rate limited", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "45s" }] } }), { status: 429 }));
  t.after(tearDownAi);
  const result = await processDocumentPipeline(await blankImage(), "limited.png", "image/png");
  assert.equal(result.data.ai_failure.code, "AI_RATE_LIMITED");
  assert.equal(result.data.ai_failure.retryable, true);
  assert.equal(result.data.ai_failure.retry_after_seconds, 45);
});

test("a successful extraction carries no ai_failure", async (t) => {
  const invoice = { invoice_number: "INV-9", invoice_date: "2026-09-01", seller: { name: "Krishna Traders" }, buyer: { name: "Acme" }, items: [{ description: "Widget", quantity: 1, rate: 100, taxable_value: 100, gst_rate: 18 }], total_amount: 118, cgst: 9, sgst: 9, taxable_amount: 100, extraction_confidence: 0.98 };
  setUpAi(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(invoice) }] } }] }), { status: 200 }));
  t.after(tearDownAi);
  const result = await processDocumentPipeline(await blankImage(), "ok.png", "image/png");
  assert.equal(result.success, true);
  assert.equal(result.data.ai_failure, undefined);
  assert.equal(result.data.fields.invoice_number, "INV-9");
});

test("data that only came from plain text matching (AI failed) is never passed off as a confident read", async (t) => {
  setUpAi(() => new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 }));
  t.after(tearDownAi);
  const text = "TAX INVOICE\nKrishna Traders\nGSTIN: 27AAPFU0939F1ZV\nInvoice No: INV/2026/0042\nInvoice Date: 05-09-2026\nBill To: Acme Traders\nWidget A 10 100.00 1,000.00\nGrand Total: Rs. 1,180.00\n";
  const result = await processDocumentPipeline(Buffer.from(text), "invoice.txt", "text/plain");
  assert.equal(result.success, true);
  assert.equal(result.data.ai_failure, undefined, "there is data, so this is not the blank-draft case");
  assert.equal(result.data.status, "needs_review");
  assert.ok(result.data.warnings.some((w) => /basic text matching/i.test(w) && /high demand/i.test(w)), JSON.stringify(result.data.warnings));
});
