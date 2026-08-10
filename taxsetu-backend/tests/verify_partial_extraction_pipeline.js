import assert from "assert";
import fetch from "node-fetch";

async function runPartialExtractionSuite() {
  console.log("==================================================");
  console.log("RUNNING PARTIAL EXTRACTION & BAD DATE ISOLATION SUITE");
  console.log("==================================================\n");

  // 1. Login
  const loginRes = await fetch("http://localhost:5001/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "tyagiakshat730@gmail.com", password: "Password123!" })
  });

  if (!loginRes.ok) {
    console.error("Auth failed. Ensure backend is running on 5001.");
    process.exit(1);
  }

  const { access_token: token } = await loginRes.json();
  console.log("✓ Logged in successfully.");

  // Test Invoice CSV with an impossible date (31/02/2026) but valid invoice number, supplier, customer, line items, and totals
  const badDateCsv = "Invoice_Number,Date,Supplier,Customer,Total\nINV-BAD-DATE-999,31/02/2026,Apollo Health,Krishna Handicraft,125000.00";
  const jobId = "job_partial_date_test";
  const fileName = "Invoice_Bad_Date.csv";

  const boundary = "----WebKitFormBoundaryPartialDateTest";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/csv\r\n\r\n${badDateCsv}\r\n--${boundary}\r\nContent-Disposition: form-data; name="jobId"\r\n\r\n${jobId}\r\n--${boundary}--\r\n`;

  console.log(`\n[TEST 1] Uploading invoice '${fileName}' with invalid date '31/02/2026'...`);
  const extractRes = await fetch("http://localhost:5001/api/assistant/extract-invoice", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "multipart/form-data; boundary=" + boundary
    },
    body
  });

  console.log("Extract HTTP Status:", extractRes.status);
  assert.strictEqual(extractRes.ok, true, "Extraction request should succeed even with a bad date field");

  const extractData = await extractRes.json();
  console.log("Response Status:", extractData.status);
  console.log("Response Job ID:", extractData.jobId);
  console.log("Invoice Number:", extractData.fields?.invoice_number);
  console.log("Supplier:", extractData.fields?.supplier);
  console.log("Customer:", extractData.fields?.customer);
  console.log("Raw Date:", extractData.fields?.invoice_date_raw);
  console.log("Normalized Date:", extractData.fields?.invoice_date);
  console.log("Field Validation:", JSON.stringify(extractData.field_validation));
  console.log("Dynamic Confidence:", extractData.confidence);

  // Assertions:
  assert.strictEqual(extractData.jobId, jobId, "Job ID mismatch");
  assert.strictEqual(extractData.status, "NEEDS_REVIEW", "Document status should be NEEDS_REVIEW due to bad date");
  assert.strictEqual(extractData.fields?.invoice_number, "INV-BAD-DATE-999", "Invoice number must NOT be blanked");
  assert.strictEqual(extractData.fields?.supplier, "Apollo Health", "Supplier must NOT be erased");
  assert.strictEqual(extractData.fields?.customer, "Krishna Handicraft", "Customer must NOT be erased");
  assert.strictEqual(extractData.fields?.invoice_date_raw, "31/02/2026", "Raw date string must be preserved");
  assert.strictEqual(extractData.fields?.invoice_date, null, "Normalized date for 31/02/2026 must be null");

  assert.strictEqual(extractData.field_validation?.invoice_number?.status, "SUCCESS", "Invoice number status should be SUCCESS");
  assert.strictEqual(extractData.field_validation?.invoice_date?.status, "NEEDS_REVIEW", "Invoice date status should be NEEDS_REVIEW");
  assert.strictEqual(extractData.field_validation?.supplier?.status, "SUCCESS", "Supplier status should be SUCCESS");

  assert(extractData.confidence > 0.50, `Dynamic confidence (${extractData.confidence}) should reflect preserved valid fields, not hardcoded 0.50`);

  console.log("✓ Extraction assertions passed 100%! Data preserved with field-level NEEDS_REVIEW status.");

  // Test Database Save (Entity Creation) with null normalized date and raw date string
  console.log("\n[TEST 2] Saving partial invoice to database via /api/entities/Invoice...");
  const createRes = await fetch("http://localhost:5001/api/entities/Invoice", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      invoice_number: extractData.fields.invoice_number,
      customer_id: "cust_test_123",
      customer_name: extractData.fields.customer,
      invoice_date: extractData.fields.invoice_date, // null
      invoice_date_raw: extractData.fields.invoice_date_raw, // "31/02/2026"
      subtotal: extractData.totals.grand_total,
      total: extractData.totals.grand_total,
      status: "draft",
      validation_status: extractData.status,
      items: extractData.line_items,
      ai_confidence: extractData.confidence
    })
  });

  console.log("Database Create HTTP Status:", createRes.status);
  assert.strictEqual(createRes.status, 201, "Database save should succeed (201 Created) without Date cast error");

  const createdDoc = await createRes.json();
  console.log("Saved Document ID:", createdDoc.id || createdDoc._id);
  console.log("Saved invoice_date:", createdDoc.invoice_date);
  console.log("Saved invoice_date_raw:", createdDoc.invoice_date_raw);

  assert.strictEqual(createdDoc.invoice_number, "INV-BAD-DATE-999", "Saved invoice number mismatch");
  assert.strictEqual(createdDoc.invoice_date, null, "Saved invoice_date should be null");
  assert.strictEqual(createdDoc.invoice_date_raw, "31/02/2026", "Saved invoice_date_raw should be preserved");

  console.log("\n==================================================");
  console.log("✅ ALL PARTIAL EXTRACTION & DATABASE IMPORT TESTS PASSED!");
  console.log("==================================================");
}

runPartialExtractionSuite().catch(err => {
  console.error("Partial extraction test failed:", err.message);
  process.exit(1);
});
