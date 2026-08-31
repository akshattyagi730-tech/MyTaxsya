import assert from "assert";
import { normalizeNumber, normalizeExtractedJson } from "../services/extractionEngine.js";

console.log("=== RUNNING NUMERIC & KEY ALIAS NORMALIZATION SUITE ===");

// 1. Numeric Normalization Tests
assert.strictEqual(normalizeNumber("₹ 1,50,000.50"), 150000.50, "Indian currency with commas failed");
assert.strictEqual(normalizeNumber("Rs. 45,800.00"), 45800.00, "Rs. prefix with commas failed");
assert.strictEqual(normalizeNumber("1,66,468.50 INR"), 166468.50, "INR suffix failed");
assert.strictEqual(normalizeNumber("18%"), 18, "Percentage failed");
assert.strictEqual(normalizeNumber(12450), 12450, "Number type failed");
assert.strictEqual(normalizeNumber(0), 0, "Zero failed");
assert.strictEqual(normalizeNumber("N/A"), null, "N/A string should return null");
assert.strictEqual(normalizeNumber("-"), null, "Dash string should return null");
assert.strictEqual(normalizeNumber(""), null, "Empty string should return null");
assert.strictEqual(normalizeNumber(null), null, "null should return null");
assert.strictEqual(normalizeNumber(undefined), null, "undefined should return null");

console.log("✓ Numeric normalization unit tests passed (11/11).");

// 2. Key Alias Normalization Tests
const rawPayload = {
  invoiceNumber: "INV/2026/001",
  inv_date: "15/07/2026",
  payment_due: "30/07/2026",
  vendor: {
    business_name: "Krishna Handicraft",
    gstin: "27AAAAA0000A1Z5"
  },
  client: {
    name: "Kanhaa Creations",
    gstin: "27BBBBB1111B1Z2"
  },
  subtotal: "₹ 1,00,000.00",
  grand_total: "₹ 1,18,000.00",
  products: [
    {
      item_name: "God Statue",
      qty: "10",
      unit_price: "₹ 10,000.00",
      line_total: "₹ 1,00,000.00"
    }
  ]
};

const canonical = normalizeExtractedJson(rawPayload);

assert.strictEqual(canonical.invoice_number, "INV/2026/001", "invoiceNumber alias failed");
assert.strictEqual(canonical.invoice_date, "2026-07-15", "inv_date alias failed");
assert.strictEqual(canonical.invoice_date_raw, "15/07/2026", "invoice_date_raw failed");
assert.strictEqual(canonical.due_date, "2026-07-30", "payment_due alias failed");
assert.strictEqual(canonical.seller.name, "Krishna Handicraft", "vendor alias failed");
assert.strictEqual(canonical.buyer.name, "Kanhaa Creations", "client alias failed");
assert.strictEqual(canonical.taxable_amount, 100000, "subtotal numeric alias failed");
assert.strictEqual(canonical.total_amount, 118000, "grand_total numeric alias failed");
assert.strictEqual(canonical.items.length, 1, "products alias failed");
assert.strictEqual(canonical.items[0].description, "God Statue", "item_name alias failed");
assert.strictEqual(canonical.items[0].quantity, 10, "qty alias failed");
assert.strictEqual(canonical.items[0].rate, 10000, "unit_price alias failed");
assert.strictEqual(canonical.items[0].total, 100000, "line_total alias failed");

console.log("✓ Key alias normalization unit tests passed (13/13).");
console.log("\n==================================================");
console.log("✅ ALL NUMERIC & ALIAS NORMALIZATION TESTS PASSED SUCCESSFULLY!");
console.log("==================================================");
