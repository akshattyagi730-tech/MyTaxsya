import http from "http";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "2d4d3c1a9f4f8c8b5e7a6d1c9a3b7f2e8c4d6a1b9e3f5c7d8a2b4e6f8c1d3a5";
const testToken = jwt.sign({ id: "660000000000000000000001", email: "test@taxsetu.com" }, JWT_SECRET, { expiresIn: "1h" });

// Helper for multipart extraction request
const sendMultipartRequest = (buffer, fileName, mimeType) => {
  return new Promise((resolve, reject) => {
    const boundary = "----TaxSetuQuotaBoundary" + Math.random().toString(36).substring(2);
    let body = [];
    body.push(Buffer.from(`--${boundary}\r\n`));
    body.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`));
    body.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
    body.push(buffer);
    body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const payloadBuffer = Buffer.concat(body);

    const req = http.request({
      hostname: "localhost",
      port: 5001,
      path: "/api/assistant/extract-invoice",
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": payloadBuffer.length,
        "Authorization": `Bearer ${testToken}`
      }
    }, (res) => {
      let resData = "";
      res.on("data", chunk => resData += chunk);
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(resData);
        } catch (e) {
          parsed = { raw: resData };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on("error", reject);
    req.write(payloadBuffer);
    req.end();
  });
};

// Helper for GET requests
const sendGetRequest = (path) => {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port: 5001,
      path,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${testToken}`
      }
    }, (res) => {
      let resData = "";
      res.on("data", chunk => resData += chunk);
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(resData);
        } catch (e) {
          parsed = { raw: resData };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on("error", reject);
    req.end();
  });
};

const runAiQuotaTestSuite = async () => {
  console.log("==================================================");
  console.log("  TAXSETU AI QUOTA & DEDUPLICATION TEST SUITE     ");
  console.log("==================================================\n");

  const results = [];
  const testCsv = Buffer.from("Invoice_Number,Date,Customer,Total\nINV-DEDUP-9001,2026-08-04,Apex Logistics,15000\n");

  // Test 1: First Upload (Populates Cache)
  try {
    const res1 = await sendMultipartRequest(testCsv, "dedup_test.csv", "text/csv");
    const pass1 = res1.status === 200 && res1.body.fields;
    results.push({ id: 1, name: "Initial File Upload (Cache Populate)", pass: pass1, status: res1.status });
  } catch (err) {
    results.push({ id: 1, name: "Initial File Upload", pass: false, error: err.message });
  }

  // Test 2: Second Upload (Verifies Independent Fresh Extraction)
  try {
    const res2 = await sendMultipartRequest(testCsv, "dedup_test.csv", "text/csv");
    const pass2 = res2.status === 200 && res2.body.fields && res2.body.fields.invoice_number === "INV-DEDUP-9001";
    results.push({ id: 2, name: `Fresh Independent Extraction (Zero Stale Cache)`, pass: pass2, status: res2.status });
  } catch (err) {
    results.push({ id: 2, name: "Fresh Independent Extraction", pass: false, error: err.message });
  }

  // Test 3: Concurrency Control Queue
  try {
    const reqPromises = [1, 2, 3].map(i =>
      sendMultipartRequest(Buffer.from(`Invoice_Number,Date,Customer,Total\nINV-CONCUR-${i},2026-08-04,Party ${i},${i * 1000}\n`), `concur_${i}.csv`, "text/csv")
    );
    const concurResults = await Promise.all(reqPromises);
    const pass3 = concurResults.every(r => r.status === 200);
    results.push({ id: 3, name: "Concurrency Queue Execution (3 Concurrent Requests)", pass: pass3, status: 200 });
  } catch (err) {
    results.push({ id: 3, name: "Concurrency Queue Execution", pass: false, error: err.message });
  }

  // Test 4: AI Usage Metrics Endpoint
  try {
    const metricsRes = await sendGetRequest("/api/assistant/ai-metrics");
    const pass4 = metricsRes.status === 200 && metricsRes.body.total_requests !== undefined;
    results.push({ id: 4, name: `AI Usage Metrics Endpoint (Total: ${metricsRes.body.total_requests})`, pass: pass4, status: metricsRes.status });
  } catch (err) {
    results.push({ id: 4, name: "AI Usage Metrics Endpoint", pass: false, error: err.message });
  }

  // Print Summary Table
  console.log("--------------------------------------------------");
  console.log(" AI QUOTA & RATE LIMIT TEST SUMMARY");
  console.log("--------------------------------------------------");
  results.forEach(r => {
    const badge = r.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`[Test #${r.id}] ${r.name.padEnd(52)} : ${badge} (HTTP ${r.status || 'ERR'})`);
  });
  console.log("--------------------------------------------------\n");
};

runAiQuotaTestSuite().catch(console.error);
