import http from "http";
import jwt from "jsonwebtoken";
import AdmZip from "adm-zip";

const JWT_SECRET = process.env.JWT_SECRET || "2d4d3c1a9f4f8c8b5e7a6d1c9a3b7f2e8c4d6a1b9e3f5c7d8a2b4e6f8c1d3a5";
const testToken = jwt.sign({ id: "660000000000000000000001", email: "test@taxsetu.com" }, JWT_SECRET, { expiresIn: "1h" });

// Helper to make multipart request to extraction endpoint
const sendMultipartRequest = (buffer, fileName, mimeType) => {
  return new Promise((resolve, reject) => {
    const boundary = "----TaxSetuSuiteBoundary" + Math.random().toString(36).substring(2);
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

const runFullTestSuite = async () => {
  console.log("==================================================");
  console.log("   TAXSETU COMPREHENSIVE EXTRACTION TEST SUITE    ");
  console.log("==================================================\n");

  const results = [];

  // Scenario 1: Normal Text CSV Invoice
  try {
    const csvContent = `Invoice_Number,Date,Customer,Quantity,Rate,Total\nKC/SL/26-27/39,2026-08-04,KRISHNA HANDICRAFT,6,27744.75,166468.50`;
    const res = await sendMultipartRequest(Buffer.from(csvContent), "invoice_normal.csv", "text/csv");
    const pass = res.status === 200 && res.body.fields?.invoice_date;
    results.push({ id: 1, name: "Normal Text CSV Invoice", pass, status: res.status });
  } catch (err) {
    results.push({ id: 1, name: "Normal Text CSV Invoice", pass: false, error: err.message });
  }

  // Scenario 2: Invoice without GSTIN (Optional field test)
  try {
    const csvNoGst = `Invoice_Number,Date,Customer,Total\nINV-8801,2026-08-04,Rohan Traders,5000`;
    const res = await sendMultipartRequest(Buffer.from(csvNoGst), "no_gstin_invoice.csv", "text/csv");
    const pass = res.status === 200 && res.body.fields?.gstin === null;
    results.push({ id: 2, name: "Invoice without GSTIN (Optional field)", pass, status: res.status });
  } catch (err) {
    results.push({ id: 2, name: "Invoice without GSTIN", pass: false, error: err.message });
  }

  // Scenario 3: Invoice without HSN (Optional field test)
  try {
    const csvNoHsn = `Invoice_Number,Date,Customer,Item,Total\nINV-9902,2026-08-04,Mehta Steel,Steel Plates,12000`;
    const res = await sendMultipartRequest(Buffer.from(csvNoHsn), "no_hsn_invoice.csv", "text/csv");
    const pass = res.status === 200 && (res.body.products?.[0]?.hsn === null || res.body.products?.[0]?.hsn === undefined);
    results.push({ id: 3, name: "Invoice without HSN (Optional field)", pass, status: res.status });
  } catch (err) {
    results.push({ id: 3, name: "Invoice without HSN", pass: false, error: err.message });
  }

  // Scenario 4: Invoice with Multiple Line Items
  try {
    const multiLineCsv = `Invoice_Number,Date,Customer,Quantity,Rate,Total\nINV-1001,2026-08-04,Alpha Corp,2,500,1000\nINV-1001,2026-08-04,Alpha Corp,5,200,1000`;
    const res = await sendMultipartRequest(Buffer.from(multiLineCsv), "multiline_invoice.csv", "text/csv");
    const pass = res.status === 200 && res.body.products;
    results.push({ id: 4, name: "Invoice with Multiple Line Items", pass, status: res.status });
  } catch (err) {
    results.push({ id: 4, name: "Invoice with Multiple Line Items", pass: false, error: err.message });
  }

  // Scenario 5: ZIP Archive with Multiple Invoices
  try {
    const zip = new AdmZip();
    zip.addFile("batch_inv_1.csv", Buffer.from("Invoice_Number,Date,Customer,Total\nINV-7001,2026-08-04,Sun Enterprises,4500\n"));
    zip.addFile("batch_inv_2.csv", Buffer.from("Invoice_Number,Date,Customer,Total\nINV-7002,2026-08-04,Moon Logistics,9200\n"));
    const zipBuffer = zip.toBuffer();

    const res = await sendMultipartRequest(zipBuffer, "invoices_batch.zip", "application/zip");
    const pass = res.status === 200 && Array.isArray(res.body.successful) && res.body.successful.length === 2;
    results.push({ id: 5, name: "ZIP Archive Batch Processing", pass, status: res.status });
  } catch (err) {
    results.push({ id: 5, name: "ZIP Archive Batch Processing", pass: false, error: err.message });
  }

  // Scenario 6: Corrupted File / Unsupported Format
  try {
    const badBuffer = Buffer.from("CORRUPTED_BINARY_DATA_NON_INVOICE_XYZ_12345");
    const res = await sendMultipartRequest(badBuffer, "random_corrupted_file.bin", "application/octet-stream");
    const pass = res.status === 422 && res.body.error_code !== undefined && !res.body.fields?.customer;
    results.push({ id: 6, name: "Corrupted File Graceful Failure", pass, status: res.status });
  } catch (err) {
    results.push({ id: 6, name: "Corrupted File Graceful Failure", pass: false, error: err.message });
  }

  // Print Results Summary Table
  console.log("--------------------------------------------------");
  console.log(" TEST SCENARIO SUMMARY RESULTS");
  console.log("--------------------------------------------------");
  results.forEach(r => {
    const badge = r.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`[Test #${r.id}] ${r.name.padEnd(42)} : ${badge} (HTTP ${r.status || 'ERR'})`);
  });
  console.log("--------------------------------------------------\n");
};

runFullTestSuite().catch(console.error);
