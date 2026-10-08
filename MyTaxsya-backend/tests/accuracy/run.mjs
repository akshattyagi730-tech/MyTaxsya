// Field-level accuracy check for the invoice extraction pipeline.
//
//   npm run accuracy                    run every case
//   npm run accuracy -- --only=Medical  run cases whose file name contains the text
//   ACCURACY_DIR=/a:/b                  folder(s) with the sample files, colon-separated (default ~/Downloads)
//   ACCURACY_MIN=95                     exit with an error below this overall % (default 90)
//
// It calls the same pipeline the upload endpoint uses, saves nothing to the database, and calls the
// real Gemini API (so it costs quota). A result read by a backup model is flagged: those runs measure
// the backup model, not your main one.
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "../../.env") });
const { processDocumentPipeline } = await import("../../services/extractionEngine.js");

const dirs = (process.env.ACCURACY_DIR || path.join(os.homedir(), "Downloads")).split(path.delimiter);
const minPct = Number(process.env.ACCURACY_MIN || 90);
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).toLowerCase();
const truthFile = ["ground-truth.json", "ground-truth.example.json"].map((f) => path.join(here, f)).find((f) => fs.existsSync(f));
if (truthFile.endsWith("example.json")) console.log("No ground-truth.json found: using the fictional example. Copy it to ground-truth.json and add your own invoices.");
const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (a, b) => Math.abs((Number(a) || 0) - Number(b)) <= 0.51; // within 50 paise
const mime = (f) => (/\.pdf$/i.test(f) ? "application/pdf" : /\.png$/i.test(f) ? "image/png" : "image/jpeg");

// What the pipeline returned, flattened to the same keys as ground-truth.
const flatten = (d) => ({
  invoice_number: d.fields?.invoice_number, invoice_date: d.fields?.invoice_date, due_date: d.fields?.due_date,
  seller_name: d.seller_information?.name, seller_gstin: d.seller_information?.gstin,
  buyer_name: d.buyer_information?.name, buyer_gstin: d.buyer_information?.gstin,
  taxable: d.totals?.taxable_value, cgst: d.totals?.cgst, sgst: d.totals?.sgst, igst: d.totals?.igst,
  discount: d.totals?.discount, total: d.totals?.grand_total,
});
const NUMERIC = new Set(["taxable", "cgst", "sgst", "igst", "discount", "total"]);
const equal = (key, got, want) => {
  if (NUMERIC.has(key)) return money(got, want);
  if (/name$/.test(key)) { const g = norm(got), w = norm(want); return g === w || (g && w && (g.includes(w) || w.includes(g))); }
  return norm(got) === norm(want);
};

const rows = [];
const perField = {};
let scored = 0, correct = 0;
const note = (file, field, got, want, ok) => {
  rows.push({ file, field, got, want, ok });
  const k = field.replace(/^item\d+\./, "item.");
  perField[k] ||= { ok: 0, n: 0 };
  perField[k].n++; scored++;
  if (ok) { perField[k].ok++; correct++; }
};

for (const c of truth.cases) {
  if (only && !c.file.toLowerCase().includes(only)) continue;
  const full = dirs.map((d) => path.join(d, c.file)).find((f) => fs.existsSync(f));
  if (!full) { console.log(`SKIP (file not found in ${dirs.join(", ")}): ${c.file}`); continue; }
  console.log(`\n>> ${c.file}`);
  const started = Date.now();
  const res = await processDocumentPipeline(fs.readFileSync(full), c.file, mime(c.file));
  if (!res.success) { console.log(`   pipeline failed: ${res.diagnostic?.error_message}`); Object.entries(c.expect).forEach(([k]) => k !== "items" && note(c.file, k, null, c.expect[k], false)); continue; }
  const d = res.data;
  const model = res.diagnostic?.ai_extraction?.provider_model || "NO AI (text matching only)";
  const backup = res.diagnostic?.ai_extraction?.fallback_used || !res.diagnostic?.ai_extraction?.provider_model;
  console.log(`   model: ${model}${backup ? "   <-- BACKUP/NO MODEL: this run does not measure your main model" : ""} | ${((Date.now() - started) / 1000).toFixed(1)}s | confidence ${d.confidence} | reconcile: ${d.reconciliation?.mode}`);

  const got = flatten(d);
  for (const [k, want] of Object.entries(c.expect)) {
    if (k === "items") continue;
    note(c.file, k, got[k], want, equal(k, got[k], want));
  }
  const items = d.products || [];
  if (c.expect.items) {
    note(c.file, "item_count", items.length, c.expect.items.length, items.length === c.expect.items.length);
    c.expect.items.forEach((w, i) => {
      if (w.qty !== undefined) note(c.file, `item${i + 1}.qty`, items[i]?.quantity, w.qty, Number(items[i]?.quantity) === w.qty);
      if (w.rate !== undefined) note(c.file, `item${i + 1}.rate`, items[i]?.rate, w.rate, money(items[i]?.rate, w.rate));
    });
  }
}

const bad = rows.filter((r) => !r.ok);
console.log("\n================ ACCURACY REPORT ================");
Object.entries(perField).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).forEach(([k, v]) =>
  console.log(`${k.padEnd(16)} ${String(v.ok).padStart(2)}/${v.n}  ${Math.round((v.ok / v.n) * 100)}%`));
const pct = scored ? Math.round((correct / scored) * 1000) / 10 : 0;
console.log(`\nOVERALL: ${correct}/${scored} fields correct = ${pct}%`);
if (bad.length) {
  console.log("\nWrong fields:");
  bad.forEach((r) => console.log(`  [${r.file.slice(0, 28)}] ${r.field}: got ${JSON.stringify(r.got)}  expected ${JSON.stringify(r.want)}`));
}
fs.writeFileSync(path.join(here, "last-report.json"), JSON.stringify({ at: new Date().toISOString(), pct, correct, scored, perField, wrong: bad }, null, 2));
process.exit(pct >= minPct || scored === 0 ? 0 : 1);
