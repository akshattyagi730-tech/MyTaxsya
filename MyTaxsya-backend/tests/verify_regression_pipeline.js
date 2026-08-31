import fetch from 'node-fetch';

async function runRegressionSuite() {
  console.log("==================================================");
  console.log("RUNNING TASK 13 REGRESSION SUITE: FILE ISOLATION & PIPELINE VALIDATION");
  console.log("==================================================\n");

  // 1. Authenticate
  const loginRes = await fetch("http://localhost:5001/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "tyagiakshat730@gmail.com", password: "Password123!" })
  });

  if (!loginRes.ok) {
    console.error("Authentication failed. Ensure local backend is running on port 5001.");
    process.exit(1);
  }

  const loginData = await loginRes.json();
  const token = loginData.access_token;
  console.log("✓ Logged in successfully. Access token retrieved.");

  // Test File 1: Sahara Medical Store
  const file1Name = "Sahara_Medical_Store_Invoice.csv";
  const file1Text = "Invoice_Number,Date,Supplier,Customer,Total\nSMS-2026-991,2026-08-08,Sahara Medical Store,Apex Health Care,45800.00";
  const file1JobId = "job_sahara_101";

  const boundary1 = "----WebKitFormBoundarySaharaTest";
  const body1 = `--${boundary1}\r\nContent-Disposition: form-data; name="file"; filename="${file1Name}"\r\nContent-Type: text/csv\r\n\r\n${file1Text}\r\n--${boundary1}\r\nContent-Disposition: form-data; name="jobId"\r\n\r\n${file1JobId}\r\n--${boundary1}--\r\n`;

  console.log(`\n[TEST 1] Uploading '${file1Name}' with JobId '${file1JobId}'...`);
  const res1 = await fetch("http://localhost:5001/api/assistant/extract-invoice", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "multipart/form-data; boundary=" + boundary1
    },
    body: body1
  });

  const data1 = await res1.json();
  console.log("Response Status 1:", res1.status);
  console.log("Extracted Job ID 1:", data1.jobId);
  console.log("Extracted Invoice No 1:", data1.fields?.invoice_number);
  console.log("Extracted Customer 1:", data1.fields?.customer);

  // Assertions for File 1
  if (data1.jobId !== file1JobId) {
    throw new Error(`Regression Failure: Expected jobId '${file1JobId}', got '${data1.jobId}'`);
  }
  if (data1.fields?.customer !== "Apex Health Care" && data1.fields?.business_name !== "Sahara Medical Store") {
    throw new Error(`Regression Failure: File 1 data mismatch.`);
  }

  // Test File 2: Krishna Handicraft
  const file2Name = "Krishna_Handicraft_Invoice.csv";
  const file2Text = "Invoice_Number,Date,Supplier,Customer,Total\nKC/SL/26-27/39,2026-08-04,Kanhaa Creations,KRISHNA HANDICRAFT,166468.50";
  const file2JobId = "job_krishna_202";

  const boundary2 = "----WebKitFormBoundaryKrishnaTest";
  const body2 = `--${boundary2}\r\nContent-Disposition: form-data; name="file"; filename="${file2Name}"\r\nContent-Type: text/csv\r\n\r\n${file2Text}\r\n--${boundary2}\r\nContent-Disposition: form-data; name="jobId"\r\n\r\n${file2JobId}\r\n--${boundary2}--\r\n`;

  console.log(`\n[TEST 2] Uploading '${file2Name}' with JobId '${file2JobId}'...`);
  const res2 = await fetch("http://localhost:5001/api/assistant/extract-invoice", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "multipart/form-data; boundary=" + boundary2
    },
    body: body2
  });

  const data2 = await res2.json();
  console.log("Response Status 2:", res2.status);
  console.log("Extracted Job ID 2:", data2.jobId);
  console.log("Extracted Invoice No 2:", data2.fields?.invoice_number);
  console.log("Extracted Customer 2:", data2.fields?.customer);

  // Assertions for File 2
  if (data2.jobId !== file2JobId) {
    throw new Error(`Regression Failure: Expected jobId '${file2JobId}', got '${data2.jobId}'`);
  }

  // Cross-Contamination Integrity Check
  console.log("\n[VERIFICATION] Verifying File 1 vs File 2 strict isolation...");
  if (JSON.stringify(data1).includes("KRISHNA HANDICRAFT")) {
    throw new Error("CRITICAL REGRESSION FAILURE: File 1 response contains stale string 'KRISHNA HANDICRAFT'!");
  }
  if (JSON.stringify(data2).includes("Sahara Medical")) {
    throw new Error("CRITICAL REGRESSION FAILURE: File 2 response contains stale string 'Sahara Medical'!");
  }

  console.log("\n==================================================");
  console.log("✓ ALL REGRESSION TESTS PASSED 100%! ZERO CROSS-CONTAMINATION DETECTED.");
  console.log("==================================================");
}

runRegressionSuite().catch(err => {
  console.error("Regression test error:", err.message);
  process.exit(1);
});
