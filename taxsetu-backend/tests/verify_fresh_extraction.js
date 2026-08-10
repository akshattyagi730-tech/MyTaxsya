import http from "http";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "2d4d3c1a9f4f8c8b5e7a6d1c9a3b7f2e8c4d6a1b9e3f5c7d8a2b4e6f8c1d3a5";
const testToken = jwt.sign({ id: "660000000000000000000001", email: "test@taxsetu.com" }, JWT_SECRET, { expiresIn: "1h" });

const sendMultipartRequest = (buffer, fileName, mimeType, port = 5001) => {
  return new Promise((resolve, reject) => {
    const boundary = "----TaxSetuTestBoundary" + Math.random().toString(36).substring(2);
    let body = [];
    body.push(Buffer.from(`--${boundary}\r\n`));
    body.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`));
    body.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
    body.push(buffer);
    body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const payloadBuffer = Buffer.concat(body);

    const req = http.request({
      hostname: "127.0.0.1",
      port: port,
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

    req.on("error", async (err) => {
      if (port === 5001) {
        try {
          const res = await sendMultipartRequest(buffer, fileName, mimeType, 5000);
          resolve(res);
        } catch (e) {
          reject(err);
        }
      } else {
        reject(err);
      }
    });
    req.write(payloadBuffer);
    req.end();
  });
};

const runFreshExtractionVerification = async () => {
  console.log("==================================================");
  console.log("   VERIFYING FRESH EXTRACTION & ZERO STALE DATA  ");
  console.log("==================================================\n");

  // 1. Upload Invoice A: Medical GST Invoice (Saharan Medical Store)
  const csvInvoiceA = `Invoice_Number,Date,Supplier,Customer,Total\nA000328,2026-08-01,Saharan Medical Store,Patient Care Clinic,2271.00`;
  console.log("Uploading Invoice A (Saharan Medical Store, No: A000328, Total: ₹2271)...");
  const resA = await sendMultipartRequest(Buffer.from(csvInvoiceA), "Saharan_Medical_Store.csv", "text/csv");
  console.log("Response A fields:", JSON.stringify(resA.body.fields || resA.body, null, 2));

  // 2. Upload Invoice B: Kanhaa Creations (KC/SL/26-27/39)
  const csvInvoiceB = `Invoice_Number,Date,Supplier,Customer,Total\nKC/SL/26-27/39,2026-08-04,Kanhaa Creations,KRISHNA HANDICRAFT,166468.50`;
  console.log("\nUploading Invoice B (Kanhaa Creations, No: KC/SL/26-27/39, Total: ₹166468.50)...");
  const resB = await sendMultipartRequest(Buffer.from(csvInvoiceB), "Kanhaa_Creations.csv", "text/csv");
  console.log("Response B fields:", JSON.stringify(resB.body.fields || resB.body, null, 2));

  // 3. Upload Invoice C: Medical GST Invoice AGAIN
  console.log("\nRe-uploading Invoice A (Saharan Medical Store)...");
  const resA2 = await sendMultipartRequest(Buffer.from(csvInvoiceA), "Saharan_Medical_Store.csv", "text/csv");
  console.log("Response A2 fields:", JSON.stringify(resA2.body.fields || resA2.body, null, 2));

  // Verification checks
  const invA_No = resA.body.fields?.invoice_number || resA.body.invoice_information?.invoice_number;
  const invA_Supplier = resA.body.fields?.supplier || resA.body.fields?.business_name || resA.body.seller_information?.name;

  const invB_No = resB.body.fields?.invoice_number || resB.body.invoice_information?.invoice_number;
  const invB_Supplier = resB.body.fields?.supplier || resB.body.fields?.business_name || resB.body.seller_information?.name;

  const invA2_No = resA2.body.fields?.invoice_number || resA2.body.invoice_information?.invoice_number;

  console.log("\n--------------------------------------------------");
  console.log(" VERIFICATION RESULTS:");
  console.log("--------------------------------------------------");
  console.log(`Invoice A Invoice No: '${invA_No}' (Expected: 'A000328') -> ${invA_No === 'A000328' ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Invoice A Supplier: '${invA_Supplier}' (Expected: 'Saharan Medical Store') -> ${invA_Supplier === 'Saharan Medical Store' ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Invoice B Invoice No: '${invB_No}' (Expected: 'KC/SL/26-27/39') -> ${invB_No === 'KC/SL/26-27/39' ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Invoice A2 Invoice No: '${invA2_No}' (Expected: 'A000328') -> ${invA2_No === 'A000328' ? '✅ PASS' : '❌ FAIL'}`);

  if (invA_No === 'A000328' && invB_No === 'KC/SL/26-27/39' && invA2_No === 'A000328' && invA_Supplier === 'Saharan Medical Store') {
    console.log("\n🎉 ALL TESTS PASSED! No stale data leakage between uploads.");
  } else {
    console.error("\n❌ TEST FAILED: Data leakage or fallback detected!");
    process.exit(1);
  }
};

runFreshExtractionVerification().catch(err => {
  console.error(err);
  process.exit(1);
});
