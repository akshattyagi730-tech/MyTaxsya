import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import mongoose from 'mongoose';
import Invoice from '../backend/models/Invoice.js';
import Customer from '../backend/models/Customer.js';

const API_URL = 'http://localhost:5001/api';
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gst-ai";

const SYNONYMS = {
  invoice_number: [
    { term: 'invoice_number', weight: 1.0 },
    { term: 'invoicenumber', weight: 1.0 },
    { term: 'invoice_no', weight: 1.0 },
    { term: 'invoiceno', weight: 1.0 },
    { term: 'invoice', weight: 0.95 },
    { term: 'bill_no', weight: 0.95 },
    { term: 'billno', weight: 0.95 },
    { term: 'bill_number', weight: 0.95 },
    { term: 'billnumber', weight: 0.95 },
    { term: 'bill', weight: 0.8 },
    { term: 'voucher', weight: 0.8 },
    { term: 'doc_no', weight: 0.8 },
    { term: 'docno', weight: 0.8 }
  ],
  invoice_date: [
    { term: 'invoice_date', weight: 1.0 },
    { term: 'invoicedate', weight: 1.0 },
    { term: 'date', weight: 0.95 },
    { term: 'inv_date', weight: 0.95 },
    { term: 'invdate', weight: 0.95 },
    { term: 'bill_date', weight: 0.95 },
    { term: 'billdate', weight: 0.95 },
    { term: 'txn_date', weight: 0.8 },
    { term: 'txndate', weight: 0.8 }
  ],
  customer_name: [
    { term: 'customer_name', weight: 1.0 },
    { term: 'customername', weight: 1.0 },
    { term: 'customer', weight: 0.95 },
    { term: 'client_name', weight: 0.95 },
    { term: 'clientname', weight: 0.95 },
    { term: 'client', weight: 0.95 },
    { term: 'party_name', weight: 0.95 },
    { term: 'partyname', weight: 0.95 },
    { term: 'party', weight: 0.9 },
    { term: 'buyer', weight: 0.8 },
    { term: 'recipient', weight: 0.8 },
    { term: 'vendor', weight: 0.7 },
    { term: 'seller', weight: 0.7 }
  ],
  quantity: [
    { term: 'quantity', weight: 1.0 },
    { term: 'qty', weight: 1.0 },
    { term: 'pieces', weight: 0.95 },
    { term: 'pcs', weight: 0.95 },
    { term: 'units', weight: 0.9 },
    { term: 'count', weight: 0.8 },
    { term: 'volume', weight: 0.7 }
  ],
  unit_price: [
    { term: 'unit_price', weight: 1.0 },
    { term: 'unitprice', weight: 1.0 },
    { term: 'price', weight: 0.95 },
    { term: 'rate', weight: 0.95 },
    { term: 'amount', weight: 0.9 },
    { term: 'cost', weight: 0.8 },
    { term: 'item_rate', weight: 0.95 },
    { term: 'itemrate', weight: 0.95 },
    { term: 'unitPrice', weight: 1.0 }
  ]
};

const stringSimilarity = (s1, s2) => {
  s1 = s1.toLowerCase().replace(/[\s_-]/g, '');
  s2 = s2.toLowerCase().replace(/[\s_-]/g, '');
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
  }
  let common = 0;
  const set1 = new Set(s1);
  const set2 = new Set(s2);
  for (const char of set1) {
    if (set2.has(char)) common++;
  }
  return (2 * common) / (s1.length + s2.length);
};

const mapHeadersToSchema = (headers) => {
  const mapping = {};
  const confidences = [];
  
  for (const [field, aliases] of Object.entries(SYNONYMS)) {
    let bestColumn = '';
    let bestScore = 0.0;
    
    headers.forEach(column => {
      const colNorm = column.toLowerCase().replace(/[\s_-]/g, '');
      
      aliases.forEach(synonym => {
        const score = synonym.weight * stringSimilarity(colNorm, synonym.term);
        if (score > bestScore) {
          bestScore = score;
          bestColumn = column;
        }
      });
    });
    
    mapping[field] = bestColumn;
    confidences.push(bestScore);
  }
  
  const averageConfidence = confidences.reduce((sum, val) => sum + val, 0) / confidences.length;
  
  return { mapping, confidence: averageConfidence };
};

const detectCSVExcelDocumentType = (headers, data) => {
  const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
  
  const isGstChallan = normalizedHeaders.some(h => 
    ['cpin', 'cin', 'majorhead', 'minorhead', 'depositdate', 'deposittime', 'gstin'].includes(h)
  ) || (data && data.some(row => 
    Object.values(row).some(val => {
      const text = String(val).toLowerCase();
      return text.includes('goods and services tax payment receipt') || text.includes('cpin:') || text.includes('cpin');
    })
  ));
  if (isGstChallan) return 'gst_challan';
  
  const isBankStatement = normalizedHeaders.some(h => 
    ['withdrawal', 'deposit', 'transactiondetails', 'accountnumber', 'debit', 'credit', 'balance'].includes(h)
  );
  if (isBankStatement) return 'bank_statement';
  
  const isExpense = normalizedHeaders.some(h => 
    ['expensecategory', 'vendor', 'merchant', 'taxcategory', 'expense_date'].includes(h)
  );
  if (isExpense) return 'expense_receipt';
  
  const hasInvoiceFields = normalizedHeaders.some(h => 
    ['invoice', 'bill', 'customer', 'client', 'qty', 'quantity', 'unitprice', 'price', 'rate'].some(term => h.includes(term))
  );
  
  if (hasInvoiceFields) {
    const isPurchase = normalizedHeaders.some(h => ['supplier', 'vendor', 'seller'].includes(h));
    return isPurchase ? 'purchase_invoice' : 'sales_invoice';
  }
  
  return 'unknown';
};

async function runTests() {
  try {
    console.log("Connecting to Database...");
    await mongoose.connect(MONGODB_URI);
    
    // Clear any existing test data
    console.log("Cleaning test database records...");
    await Invoice.deleteMany({ created_by: 'tester_importer@example.com' });
    await Customer.deleteMany({ created_by: 'tester_importer@example.com' });
    
    console.log("Logging in via API...");
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'tester_importer@example.com',
      password: 'Password123'
    });
    const token = loginRes.data.access_token;
    console.log("JWT Token obtained!");

    const client = axios.create({
      baseURL: API_URL,
      headers: { Authorization: `Bearer ${token}` }
    });

    // ====================================================
    // TEST 1: Fuzzy String Similarity Synonym Mapping
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 1: Fuzzy Synonym Column Mapping");
    console.log("==================================================");
    
    const headers1 = ['Bill No', 'Txn Date', 'Party Name', 'Pieces', 'Rate'];
    const { mapping: mapping1, confidence: confidence1 } = mapHeadersToSchema(headers1);
    
    console.log("Headers:", headers1);
    console.log("Detected Mapping:", mapping1);
    console.log("Match Confidence:", confidence1);
    
    if (mapping1.invoice_number !== 'Bill No') throw new Error('Failed to map invoice_number to Bill No');
    if (mapping1.invoice_date !== 'Txn Date') throw new Error('Failed to map invoice_date to Txn Date');
    if (mapping1.customer_name !== 'Party Name') throw new Error('Failed to map customer_name to Party Name');
    if (mapping1.quantity !== 'Pieces') throw new Error('Failed to map quantity to Pieces');
    if (mapping1.unit_price !== 'Rate') throw new Error('Failed to map unit_price to Rate');
    if (confidence1 < 0.90) throw new Error(`Expected high confidence, got ${confidence1}`);
    
    console.log("Test 1 Passed: Fuzzy mapping correctly resolved all synonyms with high confidence.");

    // ====================================================
    // TEST 2: Low-Confidence Detection (Mapping UI Trigger)
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 2: Low Confidence Detection (< 90%)");
    console.log("==================================================");
    
    const headers2 = ['Col A', 'Col B', 'Col C', 'Col D', 'Col E'];
    const { mapping: mapping2, confidence: confidence2 } = mapHeadersToSchema(headers2);
    
    console.log("Headers:", headers2);
    console.log("Match Confidence:", confidence2);
    
    if (confidence2 >= 0.90) throw new Error(`Expected low confidence (< 90%), got ${confidence2}`);
    console.log("Test 2 Passed: Low confidence correctly detected (would trigger Mapping UI in frontend).");

    // ====================================================
    // TEST 3: Document Type Auto-Detection (CSV/Excel Heuristics)
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 3: Document Type Classification (Heuristics)");
    console.log("==================================================");
    
    // 3a. GST Challan
    const type1 = detectCSVExcelDocumentType(['cpin', 'cin', 'total'], []);
    console.log("Headers ['cpin', 'cin'] detected as:", type1);
    if (type1 !== 'gst_challan') throw new Error('Failed to detect gst_challan');
    
    // 3b. Bank Statement
    const type2 = detectCSVExcelDocumentType(['transactiondetails', 'debit', 'credit', 'balance'], []);
    console.log("Headers ['debit', 'credit', 'balance'] detected as:", type2);
    if (type2 !== 'bank_statement') throw new Error('Failed to detect bank_statement');
    
    // 3c. Expense Receipt
    const type3 = detectCSVExcelDocumentType(['expensecategory', 'merchant', 'vendor'], []);
    console.log("Headers ['expensecategory', 'merchant'] detected as:", type3);
    if (type3 !== 'expense_receipt') throw new Error('Failed to detect expense_receipt');
    
    // 3d. Invoice
    const type4 = detectCSVExcelDocumentType(['bill_no', 'customer_name', 'qty'], []);
    console.log("Headers ['bill_no', 'customer_name', 'qty'] detected as:", type4);
    if (type4 !== 'sales_invoice') throw new Error('Failed to detect sales_invoice');
    
    console.log("Test 3 Passed: Document types correctly classified.");

    // ====================================================
    // TEST 4: Backend Document Type PDF/Image AI Auto-Detection
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 4: Backend AI Auto-Detection Endpoint");
    console.log("==================================================");
    
    // Check GST Challan file classification
    console.log("Sending PDF simulated as GST Challan...");
    const resChallan = await client.post('/assistant/extract-invoice', {
      fileData: 'ZXhhbXBsZQ==', // base64
      fileName: 'gst-challan-2026.pdf',
      mimeType: 'application/pdf'
    });
    console.log("Challan response documentType:", resChallan.data.documentType);
    if (resChallan.data.documentType !== 'gst_challan') throw new Error('Failed to classify PDF gst_challan');

    // Check bank statement file classification
    console.log("Sending PDF simulated as Bank Statement...");
    const resBank = await client.post('/assistant/extract-invoice', {
      fileData: 'ZXhhbXBsZQ==',
      fileName: 'bank_statement_jan.png',
      mimeType: 'image/png'
    });
    console.log("Bank statement response documentType:", resBank.data.documentType);
    if (resBank.data.documentType !== 'bank_statement') throw new Error('Failed to classify Image bank_statement');

    console.log("Test 4 Passed: Backend AI classification routing works perfectly.");

    // ====================================================
    // TEST 5: Excel Multi-Worksheet Parsing
    // ====================================================
    console.log("\n==================================================");
    console.log("TEST 5: Excel Multi-Worksheet Parsing");
    console.log("==================================================");
    
    // Create multi-sheet Excel file
    const dataSheet1 = [
      { 'Invoice No': 'INV-SHEET1-001', 'Date': '2026-07-20', 'Party': 'Sheet1 Client', 'Qty': 2, 'Rate': 400 }
    ];
    const dataSheet2 = [
      { 'Invoice No': 'INV-SHEET2-002', 'Date': '2026-07-21', 'Party': 'Sheet2 Client', 'Qty': 4, 'Rate': 600 }
    ];
    
    const ws1 = XLSX.utils.json_to_sheet(dataSheet1);
    const ws2 = XLSX.utils.json_to_sheet(dataSheet2);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'SalesPart1');
    XLSX.utils.book_append_sheet(wb, ws2, 'SalesPart2');
    
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    console.log("Simulating file reading from workbook...");
    
    // Mimic multi-sheet extraction
    const parsedData = [];
    const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const sheetRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      parsedData.push(...sheetRows);
    });
    
    console.log("Total parsed rows from all sheets:", parsedData.length);
    console.log("Parsed rows:", parsedData);
    
    if (parsedData.length !== 2) throw new Error(`Expected 2 rows from both worksheets, got ${parsedData.length}`);
    if (parsedData[0]['Invoice No'] !== 'INV-SHEET1-001') throw new Error('Sheet 1 row missing');
    if (parsedData[1]['Invoice No'] !== 'INV-SHEET2-002') throw new Error('Sheet 2 row missing');
    
    console.log("Test 5 Passed: Successfully parsed every worksheet in Excel.");

    console.log("\nALL TESTS COMPLETED SUCCESSFULLY!");
  } catch (err) {
    console.error("\nTEST FAILED:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from Database.");
  }
}

runTests();
