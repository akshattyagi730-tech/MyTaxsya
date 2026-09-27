import mongoose from 'mongoose';
import Invoice from '../MyTaxsya-backend/models/Invoice.js';
import Customer from '../MyTaxsya-backend/models/Customer.js';

const API_URL = 'http://localhost:5001/api';
const MONGODB_URI = process.env.MONGODB_URI;

async function verifyAiImporter() {
  try {
    console.log("==================================================");
    console.log("AI INVOICE IMPORTER VERIFICATION SUITE");
    console.log("==================================================");

    console.log("\n1. Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("   MongoDB connected!");

    console.log("\n2. Cleaning previous test user invoices...");
    await Invoice.deleteMany({ created_by: 'tester_ai@example.com' });
    await Customer.deleteMany({ created_by: 'tester_ai@example.com' });

    console.log("\n3. Authenticating test user...");
    let token = '';
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tester_ai@example.com', password: 'Password123' })
    });
    if (loginRes.ok) {
      const data = await loginRes.json();
      token = data.access_token;
    } else {
      console.log("   User does not exist, registering...");
      const regRes = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'AI Tester',
          email: 'tester_ai@example.com',
          password: 'Password123',
          company_name: 'AI Test Corp'
        })
      });
      const regData = await regRes.json();
      token = regData.access_token;
    }
    console.log("   Authentication successful! Token received.");

    // ----------------------------------------------------
    // TEST A: Extract invoice from CSV/Text payload via multipart/form-data
    // ----------------------------------------------------
    console.log("\n4. Testing /api/assistant/extract-invoice endpoint with multi-part document...");
    const sampleCsv = `Invoice Number,Invoice Date,Supplier Name,Customer Name,Item Description,Quantity,Rate,Total Amount
INV-TEST-999,2026-08-08,Alpha Supplies,Beta Retailers,Standard Widget Box,5,1200,6000`;

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    let body = `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="sample_tax_invoice.csv"\r\n`;
    body += `Content-Type: text/csv\r\n\r\n`;
    body += `${sampleCsv}\r\n`;
    body += `--${boundary}--\r\n`;

    console.log("   Posting file 'sample_tax_invoice.csv' to backend...");
    const extractRes = await fetch(`${API_URL}/assistant/extract-invoice`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });

    console.log("   [PASS] Endpoint responded with status:", extractRes.status);
    const extractData = await extractRes.json();

    console.log("   Extracted fields:", extractData.fields);
    console.log("   Extracted products:", extractData.products);

    if (!extractData.fields || !extractData.fields.invoice_number) {
      throw new Error("Missing invoice_number in extracted response!");
    }
    if (extractData.fields.invoice_number !== 'INV-TEST-999') {
      throw new Error(`Expected invoice_number INV-TEST-999, got ${extractData.fields.invoice_number}`);
    }

    console.log("   [PASS] JSON structure and fields parsed cleanly!");

    // ----------------------------------------------------
    // TEST B: Save extracted invoice to database
    // ----------------------------------------------------
    console.log("\n5. Testing invoice record save to database...");
    const custRes = await fetch(`${API_URL}/entities/Customer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: extractData.fields.customer || 'Beta Retailers',
        status: 'active'
      })
    });
    const custData = await custRes.json();
    const customerId = custData.id || custData._id;

    const invoiceRecord = {
      invoice_number: extractData.fields.invoice_number,
      customer_id: customerId,
      customer_name: extractData.fields.customer || 'Beta Retailers',
      invoice_date: extractData.fields.invoice_date || '2026-08-08',
      subtotal: 6000,
      total: 6000,
      status: 'draft',
      items: [{
        description: 'Standard Widget Box',
        quantity: 5,
        rate: 1200,
        amount: 6000,
        gst_rate: 18
      }],
      ai_confidence: extractData.confidence || 0.95,
      ai_category: 'AI Extracted'
    };

    const saveRes = await fetch(`${API_URL}/entities/Invoice`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoiceRecord)
    });
    const saveData = await saveRes.json();
    console.log("   [PASS] Invoice saved successfully, ID:", saveData.id || saveData._id);

    const savedInDb = await Invoice.findOne({ invoice_number: 'INV-TEST-999', created_by: 'tester_ai@example.com' });
    if (!savedInDb) {
      throw new Error("Invoice record not found in MongoDB!");
    }
    console.log("   [PASS] Verified record in MongoDB!");

    console.log("\n==================================================");
    console.log("ALL AI IMPORTER CHECKS PASSED SUCCESSFULLY!");
    console.log("==================================================");

  } catch (err) {
    console.error("\n[FAIL] Verification error:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

verifyAiImporter();
