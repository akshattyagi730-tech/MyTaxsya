import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import assert from 'assert';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';

const API_URL = 'http://localhost:5001/api';
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

async function verifyDatePipeline() {
  try {
    console.log("==================================================");
    console.log("INVOICE DATE IMPORT & VALIDATION E2E SUITE");
    console.log("==================================================");

    console.log("\n1. Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("   MongoDB connected!");

    console.log("\n2. Cleaning test user invoices...");
    await Invoice.deleteMany({ created_by: 'tester_date_pipeline@example.com' });
    await Customer.deleteMany({ created_by: 'tester_date_pipeline@example.com' });

    let user = await User.findOne({ email: 'tester_date_pipeline@example.com' });
    if (!user) {
      user = await User.create({
        email: 'tester_date_pipeline@example.com',
        password: 'Password123',
        full_name: 'Date Tester',
        role: 'admin'
      });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // ----------------------------------------------------
    // TEST 1: Process CSV with DD/MM/YYYY date "15/07/2026"
    // ----------------------------------------------------
    console.log("\n3. Testing Invoice A extraction with DD/MM/YYYY date ('15/07/2026')...");
    const csvContentA = `Invoice Number,Invoice Date,Supplier Name,Customer Name,Item Description,Quantity,Rate,Total Amount
INV-DATE-001,15/07/2026,Acme Corp,Apex Retail,Widget A,10,100,1000`;

    const boundaryA = '----WebKitFormBoundaryDateA';
    let bodyA = `--${boundaryA}\r\n`;
    bodyA += `Content-Disposition: form-data; name="file"; filename="invoice_15_07_2026.csv"\r\n`;
    bodyA += `Content-Type: text/csv\r\n\r\n`;
    bodyA += `${csvContentA}\r\n`;
    bodyA += `--${boundaryA}--\r\n`;

    const resA = await fetch(`${API_URL}/assistant/extract-invoice`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundaryA}`
      },
      body: bodyA
    });

    assert.strictEqual(resA.status, 200, "Invoice A extraction failed");
    const dataA = await resA.json();
    console.log("   Invoice A Extracted fields:", dataA.fields);

    assert.strictEqual(dataA.fields.invoice_date, "2026-07-15", "Normalized date must be 2026-07-15");
    assert.strictEqual(dataA.fields.invoice_date_raw, "15/07/2026", "Raw date must be 15/07/2026");
    assert.strictEqual(dataA.status, "success", "Validation status must be success");

    console.log("   [PASS] Invoice A date normalized from 15/07/2026 to 2026-07-15!");

    // ----------------------------------------------------
    // TEST 2: Save Invoice A to database
    // ----------------------------------------------------
    console.log("\n4. Saving Invoice A to database via POST /api/entities/Invoice...");
    const custResA = await fetch(`${API_URL}/entities/Customer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Apex Retail', status: 'active' })
    });
    const custDataA = await custResA.json();

    const recordA = {
      invoice_number: dataA.fields.invoice_number,
      customer_id: custDataA.id || custDataA._id,
      customer_name: 'Apex Retail',
      invoice_date: dataA.fields.invoice_date,
      subtotal: 1000,
      total: 1000,
      status: 'draft',
      items: [{ description: 'Widget A', quantity: 10, rate: 100, amount: 1000, gst_rate: 18 }]
    };

    const saveResA = await fetch(`${API_URL}/entities/Invoice`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(recordA)
    });
    assert.strictEqual(saveResA.status, 201, "Invoice A database save failed");
    const saveDataA = await saveResA.json();
    console.log("   [PASS] Invoice A saved to database, ID:", saveDataA.id || saveDataA._id);

    const dbInvA = await Invoice.findOne({ invoice_number: 'INV-DATE-001', created_by: 'tester_date_pipeline@example.com' });
    assert.ok(dbInvA, "Invoice A record not found in MongoDB");
    assert.strictEqual(dbInvA.invoice_date.toISOString().split('T')[0], '2026-07-15', "Stored DB date must match 2026-07-15");
    console.log("   [PASS] Invoice A verified in MongoDB as Date object 2026-07-15!");

    // ----------------------------------------------------
    // TEST 3: Direct POST with un-normalized date string "15/07/2026"
    // (Testing Controller Guard)
    // ----------------------------------------------------
    console.log("\n5. Testing entityController guard with raw string date '15/07/2026'...");
    const recordRaw = {
      invoice_number: 'INV-DATE-RAW-001',
      customer_id: custDataA.id || custDataA._id,
      customer_name: 'Apex Retail',
      invoice_date: '15/07/2026', // Raw string date!
      subtotal: 500,
      total: 500,
      status: 'draft',
      items: [{ description: 'Raw Date Widget', quantity: 5, rate: 100, amount: 500, gst_rate: 18 }]
    };

    const saveResRaw = await fetch(`${API_URL}/entities/Invoice`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(recordRaw)
    });
    assert.strictEqual(saveResRaw.status, 201, "Raw string date POST should be normalized by controller guard");
    const dbInvRaw = await Invoice.findOne({ invoice_number: 'INV-DATE-RAW-001', created_by: 'tester_date_pipeline@example.com' });
    assert.ok(dbInvRaw, "Invoice RAW record not found in MongoDB");
    assert.strictEqual(dbInvRaw.invoice_date.toISOString().split('T')[0], '2026-07-15', "Controller must normalize string 15/07/2026 to 2026-07-15");
    console.log("   [PASS] Controller guard normalized '15/07/2026' to '2026-07-15' before saving to MongoDB!");

    // ----------------------------------------------------
    // TEST 4: Process Invoice B with different date "20/08/2026"
    // (Testing stale-state protection & isolation)
    // ----------------------------------------------------
    console.log("\n6. Testing Invoice B extraction with date '20/08/2026'...");
    const csvContentB = `Invoice Number,Invoice Date,Supplier Name,Customer Name,Item Description,Quantity,Rate,Total Amount
INV-DATE-002,20/08/2026,Acme Corp,Beta Traders,Widget B,20,50,1000`;

    const boundaryB = '----WebKitFormBoundaryDateB';
    let bodyB = `--${boundaryB}\r\n`;
    bodyB += `Content-Disposition: form-data; name="file"; filename="invoice_20_08_2026.csv"\r\n`;
    bodyB += `Content-Type: text/csv\r\n\r\n`;
    bodyB += `${csvContentB}\r\n`;
    bodyB += `--${boundaryB}--\r\n`;

    const resB = await fetch(`${API_URL}/assistant/extract-invoice`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundaryB}`
      },
      body: bodyB
    });

    assert.strictEqual(resB.status, 200, "Invoice B extraction failed");
    const dataB = await resB.json();
    assert.strictEqual(dataB.fields.invoice_date, "2026-08-20", "Invoice B date must be 2026-08-20");
    assert.notStrictEqual(dataB.fields.invoice_date, dataA.fields.invoice_date, "Invoice B date must not equal Invoice A date!");
    console.log("   [PASS] Invoice B extraction succeeded with isolated date 2026-08-20!");

    console.log("\n==================================================");
    console.log("ALL INVOICE DATE IMPORT PIPELINE CHECKS PASSED!");
    console.log("==================================================");

  } catch (err) {
    console.error("\n[FAIL] Pipeline verification error:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

verifyDatePipeline();
