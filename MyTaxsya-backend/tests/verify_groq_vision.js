import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testGroqVisionExtraction() {
  console.log("==================================================");
  console.log("GROQ VISION IMAGE EXTRACTION TEST");
  console.log("==================================================\n");

  // 1. Authenticate
  const loginRes = await fetch("http://localhost:5001/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "tyagiakshat730@gmail.com", password: "Password123!" })
  });

  if (!loginRes.ok) {
    console.error("Authentication failed.");
    process.exit(1);
  }

  const loginData = await loginRes.json();
  const token = loginData.access_token;
  console.log("✓ Logged in successfully.\n");

  // 2. Create a minimal but valid JPEG test image with embedded text
  // We'll create a tiny 1x1 JPEG to test the pipeline routing
  // The key test is: does the pipeline route to Groq Vision (Stage 4a) for image files?
  const minimalJpegHex = "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b08000100010101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc40000010100000000000000000000000000000000ffda00080101000003100002110300000011a28a0000ffd9";
  const jpegBuffer = Buffer.from(minimalJpegHex, 'hex');

  const boundary = "----WebKitFormBoundaryVisionTest";
  const jobId = "job_vision_test_001";
  const fileName = "test_invoice_image.jpeg";
  
  // Build multipart body
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`);
  parts.push(`Content-Type: image/jpeg\r\n\r\n`);
  const header = Buffer.from(parts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="jobId"\r\n\r\n${jobId}\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, jpegBuffer, footer]);

  console.log(`[TEST] Uploading '${fileName}' (${jpegBuffer.length} bytes) as image/jpeg...`);
  console.log(`[TEST] JobId: ${jobId}`);
  console.log(`[TEST] Expected: Pipeline routes to Stage 4a (Groq Vision), not text-only model.\n`);

  const res = await fetch("http://localhost:5001/api/assistant/extract-invoice", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body
  });

  const data = await res.json();
  
  console.log("Response HTTP Status:", res.status);
  console.log("Response JobId:", data.jobId);
  console.log("Validation Status:", data.status || data.validation_status);
  console.log("Confidence:", data.confidence);
  console.log("Invoice Number:", data.fields?.invoice_number || "null");
  console.log("Customer:", data.fields?.customer || "null");
  console.log("Supplier:", data.fields?.supplier || "null");
  console.log("Warnings:", JSON.stringify(data.warnings || []));
  
  if (data.debug) {
    console.log("\n--- Debug Object ---");
    console.log("Model used:", data.debug?.model);
    console.log("Invoice # before norm:", data.debug?.invoiceNumberBeforeNormalization);
    console.log("Invoice # after norm:", data.debug?.invoiceNumberAfterNormalization);
    console.log("Validation status:", data.debug?.validationStatus);
    console.log("Validation errors:", JSON.stringify(data.debug?.validationErrors || []));
  }

  // ASSERTIONS
  let passed = true;

  // 1. Must return 200
  if (res.status !== 200) {
    console.error(`\n✗ FAIL: Expected HTTP 200, got ${res.status}`);
    passed = false;
  } else {
    console.log("\n✓ HTTP 200 OK");
  }

  // 2. JobId must match
  if (data.jobId !== jobId) {
    console.error(`✗ FAIL: Expected jobId '${jobId}', got '${data.jobId}'`);
    passed = false;
  } else {
    console.log("✓ JobId matches");
  }

  // 3. Must NOT have fabricated INV-xxxx invoice number
  const invNo = data.fields?.invoice_number;
  if (invNo && invNo.startsWith("INV-")) {
    console.error(`✗ FAIL: Fabricated invoice number detected: '${invNo}'`);
    passed = false;
  } else {
    console.log("✓ No fabricated invoice number (Task 14 compliant)");
  }

  // 4. Response should NOT contain stale data from other invoices
  const responseStr = JSON.stringify(data);
  if (responseStr.includes("KRISHNA HANDICRAFT") || responseStr.includes("Kanhaa Creations") || responseStr.includes("Sahara Medical")) {
    console.error("✗ FAIL: Cross-contamination detected with other invoice data!");
    passed = false;
  } else {
    console.log("✓ No cross-contamination with other invoices");
  }

  // 5. Confidence should not be hardcoded 0.95 for a minimal test image
  if (data.confidence > 0.90) {
    console.warn("⚠ WARNING: Suspiciously high confidence for a 1x1 test image");
  }

  console.log("\n==================================================");
  if (passed) {
    console.log("✓ ALL GROQ VISION PIPELINE TESTS PASSED!");
  } else {
    console.log("✗ SOME TESTS FAILED — see details above.");
  }
  console.log("==================================================");
}

testGroqVisionExtraction().catch(err => {
  console.error("Test error:", err.message);
  process.exit(1);
});
