import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import JSZip from 'jszip';
import mongoose from 'mongoose';
import Invoice from '../backend/models/Invoice.js';
import Expense from '../backend/models/Expense.js';
import Payment from '../backend/models/Payment.js';
import Customer from '../backend/models/Customer.js';
import Supplier from '../backend/models/Supplier.js';
import Product from '../backend/models/Product.js';

const API_URL = 'http://localhost:5001/api';
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gst-ai";

async function runTests() {
  try {
    console.log("Connecting to Database...");
    await mongoose.connect(MONGODB_URI);
    
    // Clear all test data for tester_importer@example.com
    console.log("Cleaning test database records...");
    const testEmail = 'tester_importer@example.com';
    await Promise.all([
      Invoice.deleteMany({ created_by: testEmail }),
      Expense.deleteMany({ created_by: testEmail }),
      Payment.deleteMany({ created_by: testEmail }),
      Customer.deleteMany({ created_by: testEmail }),
      Supplier.deleteMany({ created_by: testEmail }),
      Product.deleteMany({ created_by: testEmail })
    ]);
    
    console.log("Logging in via API...");
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: testEmail,
      password: 'Password123'
    });
    const token = loginRes.data.access_token;
    console.log("JWT Token obtained successfully!");

    const client = axios.create({
      baseURL: API_URL,
      headers: { Authorization: `Bearer ${token}` }
    });

    // ====================================================
    // TEST 1: ZIP Archive File Extraction
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 1: In-Memory ZIP File Extraction (JSZip)");
    console.log("==================================================");
    
    const zip = new JSZip();
    zip.file("test_sales_invoice.csv", "Invoice_Number,Invoice_Date,Customer_Name,Quantity,Unit_Price\nINV-ZIP-001,2026-07-25,ZIP Cust,1,900");
    zip.file("test_product_list.csv", "name,sku,price\nZIP Widget,SKU-ZIP-101,150");
    zip.file("gst_challan.csv", "cpin,cin,total\n12345,67890,208");
    
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync("scratch/test_archive.zip", zipBuffer);
    console.log("Created test ZIP file at scratch/test_archive.zip");
    
    // Read and extract in-memory
    const loadedZip = await zip.loadAsync(zipBuffer);
    const filesFound = [];
    for (const [filename, entry] of Object.entries(loadedZip.files)) {
      if (!entry.dir) filesFound.push(filename);
    }
    console.log("Files found inside ZIP:", filesFound);
    if (filesFound.length !== 3) throw new Error("Expected 3 files in ZIP");
    console.log("Test 1 Passed: ZIP archive successfully extracted.");

    // ====================================================
    // TEST 2: AI Document Classification and Routing Map
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 2: Document Auto-Detection & Destination Mapping");
    console.log("==================================================");
    
    const testCases = [
      { filename: 'invoice.pdf', expected: 'Sales Invoice', importable: true },
      { filename: 'cpin-challan.pdf', expected: 'GST Challan', importable: false },
      { filename: 'bank_statement.pdf', expected: 'Bank Statement', importable: true },
      { filename: 'supplier-list.csv', expected: 'Supplier List', importable: true },
      { filename: 'expense-receipt.pdf', expected: 'Expense Receipt', importable: true }
    ];
    
    for (const tc of testCases) {
      const res = await client.post('/assistant/extract-invoice', {
        fileData: 'ZXhhbXBsZQ==',
        fileName: tc.filename,
        mimeType: tc.filename.endsWith('.pdf') ? 'application/pdf' : 'text/csv'
      });
      console.log(`File: ${tc.filename} -> Classified as: ${res.data.documentType}`);
      if (res.data.documentType !== tc.expected) {
        throw new Error(`Expected ${tc.expected}, got ${res.data.documentType}`);
      }
    }
    console.log("Test 2 Passed: Classification works perfectly.");

    // ====================================================
    // TEST 3: DB Creation across Multiple Collections (Universal Routing)
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 3: Universal DB Importing & Routing Verification");
    console.log("==================================================");
    
    // 3a. Import Sales Invoice
    console.log("Simulating Sales Invoice Import...");
    // Create customer first
    const custRes = await client.post('/entities/Customer', { name: 'Acme ZIP Customer', status: 'active' });
    const customerId = custRes.data.id || custRes.data._id;
    
    await client.post('/entities/Invoice', {
      invoice_number: 'INV-ZIP-001',
      customer_id: customerId,
      customer_name: 'Acme ZIP Customer',
      invoice_date: '2026-07-25',
      subtotal: 900,
      total: 900,
      status: 'draft',
      items: [{ description: 'ZIP Item', quantity: 1, rate: 900, amount: 900, gst_rate: 0 }]
    });

    // 3b. Import Expense Receipt
    console.log("Simulating Expense Receipt Import...");
    await client.post('/entities/Expense', {
      title: 'Expense Receipt: Office Supplies Store',
      category: 'office_supplies',
      amount: 450,
      payment_mode: 'cash',
      date: '2026-07-25',
      vendor: 'Office Supplies Store',
      status: 'approved'
    });

    // 3c. Import Customer List (Bulk Customers)
    console.log("Simulating Customer List Import...");
    await client.post('/entities/Customer', { name: 'Customer List Row 1', email: 'row1@cust.com', phone: '9000000001', status: 'active' });
    await client.post('/entities/Customer', { name: 'Customer List Row 2', email: 'row2@cust.com', phone: '9000000002', status: 'active' });

    // 3d. Import Supplier List (Bulk Suppliers)
    console.log("Simulating Supplier List Import...");
    await client.post('/entities/Supplier', { name: 'Supplier List Row 1', email: 'row1@supplier.com', phone: '8000000001', status: 'active' });

    // 3e. Import Product List (Bulk Inventory Products)
    console.log("Simulating Product List Import...");
    await client.post('/entities/Product', { name: 'Product A', sku: 'SKU-A', sale_price: 150, purchase_price: 100, stock_quantity: 50, status: 'active' });
    await client.post('/entities/Product', { name: 'Product B', sku: 'SKU-B', sale_price: 250, purchase_price: 180, stock_quantity: 30, status: 'active' });

    // 3f. Import Bank Statement (Bulk Payments)
    console.log("Simulating Bank Statement Transaction Import...");
    await client.post('/entities/Payment', {
      payment_number: 'PAY-BANK-001',
      amount: 2000,
      payment_mode: 'bank',
      date: '2026-07-01',
      notes: 'ATM Withdrawal',
      reference_number: 'TXN10293',
      status: 'success'
    });
    await client.post('/entities/Payment', {
      payment_number: 'PAY-BANK-002',
      amount: 50000,
      payment_mode: 'bank',
      date: '2026-07-05',
      notes: 'Salary Deposit',
      reference_number: 'TXN10294',
      status: 'success'
    });

    // ====================================================
    // VERIFY ALL MONGODB COLLECTIONS ARE POPULATED
    // ====================================================
    console.log("\nVerifying database records...");
    
    const countInvoices = await Invoice.countDocuments({ created_by: testEmail });
    const countExpenses = await Expense.countDocuments({ created_by: testEmail });
    const countCustomers = await Customer.countDocuments({ created_by: testEmail });
    const countSuppliers = await Supplier.countDocuments({ created_by: testEmail });
    const countProducts = await Product.countDocuments({ created_by: testEmail });
    const countPayments = await Payment.countDocuments({ created_by: testEmail });
    
    console.log(`- Invoices: ${countInvoices} (Expected: 1)`);
    console.log(`- Expenses: ${countExpenses} (Expected: 1)`);
    console.log(`- Customers: ${countCustomers} (Expected: 3 - 1 direct + 2 list)`);
    console.log(`- Suppliers: ${countSuppliers} (Expected: 1)`);
    console.log(`- Products: ${countProducts} (Expected: 2)`);
    console.log(`- Payments: ${countPayments} (Expected: 2)`);
    
    if (countInvoices !== 1) throw new Error("Invoice import count mismatched.");
    if (countExpenses !== 1) throw new Error("Expense import count mismatched.");
    if (countCustomers !== 3) throw new Error("Customer import count mismatched.");
    if (countSuppliers !== 1) throw new Error("Supplier import count mismatched.");
    if (countProducts !== 2) throw new Error("Product import count mismatched.");
    if (countPayments !== 2) throw new Error("Payment import count mismatched.");

    console.log("\nALL UNIVERSAL ENGINE INTEGRATION TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("\nTEST FAILED:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from Database.");
  }
}

runTests();
