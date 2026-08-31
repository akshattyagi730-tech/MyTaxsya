import assert from "assert";
import { normalizeInvoiceDate } from "../services/extractionEngine.js";

console.log("=== RUNNING INVOICE DATE NORMALIZATION SUITE ===");

// Requirement 14 Test Cases:
// 1. "15/07/2026" -> "2026-07-15"
assert.strictEqual(normalizeInvoiceDate("15/07/2026"), "2026-07-15", "DD/MM/YYYY failed");

// 2. "15-07-2026" -> "2026-07-15"
assert.strictEqual(normalizeInvoiceDate("15-07-2026"), "2026-07-15", "DD-MM-YYYY failed");

// 3. "15.07.2026" -> "2026-07-15"
assert.strictEqual(normalizeInvoiceDate("15.07.2026"), "2026-07-15", "DD.MM.YYYY failed");

// 4. "2026-07-15" -> "2026-07-15"
assert.strictEqual(normalizeInvoiceDate("2026-07-15"), "2026-07-15", "YYYY-MM-DD failed");

// 5. "15/07/26" -> "2026-07-15"
assert.strictEqual(normalizeInvoiceDate("15/07/26"), "2026-07-15", "DD/MM/YY failed");

// 6. Text date formats: "15-Jul-2026" -> "2026-07-15"
assert.strictEqual(normalizeInvoiceDate("15-Jul-2026"), "2026-07-15", "DD-Mon-YYYY failed");

// 7. Invalid date: "31/02/2026" -> null
assert.strictEqual(normalizeInvoiceDate("31/02/2026"), null, "Impossible date 31/02/2026 should return null");

// 8. Invalid month/day: "45/15/2026" -> null
assert.strictEqual(normalizeInvoiceDate("45/15/2026"), null, "Invalid date 45/15/2026 should return null");

// 9. Empty strings & nulls: "" -> null, null -> null, undefined -> null
assert.strictEqual(normalizeInvoiceDate(""), null, "Empty string should return null");
assert.strictEqual(normalizeInvoiceDate(null), null, "null should return null");
assert.strictEqual(normalizeInvoiceDate(undefined), null, "undefined should return null");
assert.strictEqual(normalizeInvoiceDate("   "), null, "whitespace should return null");
assert.strictEqual(normalizeInvoiceDate("n/a"), null, "n/a should return null");

// 10. Date object
const dateObj = new Date(Date.UTC(2026, 6, 15));
assert.strictEqual(normalizeInvoiceDate(dateObj), "2026-07-15", "Date object should return 2026-07-15");

console.log("✅ ALL DATE NORMALIZATION UNIT TESTS PASSED SUCCESSFULLY!");
