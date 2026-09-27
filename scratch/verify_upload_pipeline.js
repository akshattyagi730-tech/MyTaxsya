import http from "http";
import AdmZip from "../MyTaxsya-backend/node_modules/adm-zip/adm-zip.js";
import jwt from "../MyTaxsya-backend/node_modules/jsonwebtoken/index.js";

import mongoose from "../MyTaxsya-backend/node_modules/mongoose/index.js";
import User from "../MyTaxsya-backend/models/User.js";

console.log("=== VERIFYING MYTAXSYA UPLOAD PIPELINE ===");

// Create test JWT token with a mock Mongo Object ID
const JWT_SECRET = process.env.JWT_SECRET;
const testToken = jwt.sign({ id: "660000000000000000000001", email: "tyagiakshat076@gmail.com" }, JWT_SECRET, { expiresIn: "1h" });

// 1. Create a sample CSV file with real GST invoice data matching user request
const sampleCsvText = `Invoice_Number,Date,Customer,Quantity,Rate,Total
KC/SL/26-27/39,2026-08-04,KRISHNA HANDICRAFT,6,27744.75,166468.50`;

const csvBuffer = Buffer.from(sampleCsvText);

console.log(`Generated sample CSV invoice: ${csvBuffer.length} bytes.`);

// 2. Prepare multipart/form-data request
const boundary = "----MyTaxsyaUploadBoundary" + Math.random().toString(36).substring(2);
let body = [];

body.push(Buffer.from(`--${boundary}\r\n`));
body.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="KRISHNA_HANDICRAFT_Sales_Invoice_KC_SL_26_27_39.csv"\r\n`));
body.push(Buffer.from(`Content-Type: text/csv\r\n\r\n`));
body.push(csvBuffer);
body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

const payloadBuffer = Buffer.concat(body);

console.log(`Sending FormData request (${payloadBuffer.length} bytes) to http://localhost:5001/api/assistant/extract-invoice...`);

// Test extract-invoice endpoint
const extractReq = http.request({
  hostname: "localhost",
  port: 5001,
  path: "/api/assistant/extract-invoice",
  method: "POST",
  headers: {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": payloadBuffer.length,
    "Authorization": `Bearer ${testToken}`
  }
}, (extractRes) => {
  let resData = "";
  extractRes.on("data", chunk => resData += chunk);
  extractRes.on("end", () => {
    console.log(`\nResponse HTTP Status: ${extractRes.statusCode}`);
    try {
      const parsed = JSON.parse(resData);
      console.log("Extracted Real Invoice Data JSON:");
      console.log(JSON.stringify(parsed, null, 2));
    } catch (err) {
      console.log("Raw Response Data:", resData);
    }
  });
});

extractReq.on("error", (err) => {
  console.error("Extract Request failed:", err.message);
});

extractReq.write(payloadBuffer);
extractReq.end();
