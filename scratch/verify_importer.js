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

const REQUIRED_FIELDS = {
  invoice_number: ['Invoice_Number', 'InvoiceNumber', 'Invoice_No', 'InvoiceNo', 'Invoice'],
  invoice_date: ['Invoice_Date', 'InvoiceDate', 'Date'],
  customer_name: ['Customer_Name', 'CustomerName', 'Customer', 'Client_Name', 'ClientName', 'Client'],
  quantity: ['Quantity', 'Qty'],
  unit_price: ['Unit_Price', 'UnitPrice', 'Price', 'Rate']
};

const getRowValue = (row, possibleKeys) => {
  const normalizedKeys = possibleKeys.map(k => k.toLowerCase().replace(/[\s_-]/g, ''));
  const foundKey = Object.keys(row).find(k => {
    const normK = k.toLowerCase().replace(/[\s_-]/g, '');
    return normalizedKeys.includes(normK);
  });
  return foundKey ? String(row[foundKey] !== undefined && row[foundKey] !== null ? row[foundKey] : '').trim() : '';
};

const validateRow = (row) => {
  const errors = [];
  const invoiceNumber = getRowValue(row, REQUIRED_FIELDS.invoice_number);
  const invoiceDate = getRowValue(row, REQUIRED_FIELDS.invoice_date);
  const customerName = getRowValue(row, REQUIRED_FIELDS.customer_name);
  const quantityStr = getRowValue(row, REQUIRED_FIELDS.quantity);
  const unitPriceStr = getRowValue(row, REQUIRED_FIELDS.unit_price);
  
  if (!invoiceNumber) {
    errors.push("Missing Invoice Number");
  }
  if (!invoiceDate) {
    errors.push("Missing Invoice Date");
  } else {
    const d = new Date(invoiceDate);
    if (isNaN(d.getTime())) {
      errors.push(`Invalid Invoice Date: "${invoiceDate}"`);
    }
  }
  if (!customerName) {
    errors.push("Missing Customer Name");
  }
  
  const quantity = Number(quantityStr);
  if (quantityStr === '' || isNaN(quantity)) {
    errors.push(`Invalid Quantity: "${quantityStr}" (must be a number)`);
  }
  
  const unitPrice = Number(unitPriceStr);
  if (unitPriceStr === '' || isNaN(unitPrice)) {
    errors.push(`Invalid Unit Price: "${unitPriceStr}" (must be a number)`);
  }
  
  return errors;
};

// Simulated importer core logic mimicking BulkUploadDialog.jsx
async function runImportLogic(token, fileContent, fileName, updateExisting) {
  let rawData = [];
  
  // 1. Parsing
  if (fileName.endsWith('.csv')) {
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: 'greedy'
    });
    rawData = parsed.data;
  } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    const workbook = XLSX.read(fileContent, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  }
  
  if (!rawData || rawData.length === 0) {
    return { error: 'No data rows found' };
  }
  
  // 2. Validate columns
  const firstRow = rawData[0];
  const headers = Object.keys(firstRow);
  const missing = [];
  const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
  for (const [field, aliases] of Object.entries(REQUIRED_FIELDS)) {
    const normalizedAliases = aliases.map(a => a.toLowerCase().replace(/[\s_-]/g, ''));
    const found = normalizedHeaders.some(h => normalizedAliases.includes(h));
    if (!found) missing.push(aliases[0]);
  }
  
  if (missing.length > 0) {
    return { error: `Missing required columns: ${missing.join(', ')}` };
  }
  
  // Create Axios client with JWT authorization
  const client = axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` }
  });
  
  // Fetch existing invoices
  const existingInvoicesRes = await client.get('/entities/Invoice', { params: { limit: 100000 } });
  const existingInvoices = existingInvoicesRes.data || [];
  const dbInvoiceMap = {};
  existingInvoices.forEach(inv => {
    if (inv.invoice_number) {
      dbInvoiceMap[inv.invoice_number.toLowerCase()] = inv.id || inv._id;
    }
  });
  
  // 3. Pre-process and validate each row
  const failedReport = [];
  const importableRows = [];
  const seenInWorkbook = new Set();
  
  rawData.forEach((row, idx) => {
    const rowNum = idx + 2;
    const valErrors = validateRow(row);
    const invoiceNumber = getRowValue(row, REQUIRED_FIELDS.invoice_number);
    
    if (valErrors.length > 0) {
      failedReport.push({
        rowNumber: rowNum,
        invoiceNumber: invoiceNumber || 'N/A',
        error: valErrors.join(', ')
      });
    } else {
      const lowerInvNum = invoiceNumber.toLowerCase();
      if (seenInWorkbook.has(lowerInvNum)) {
        failedReport.push({
          rowNumber: rowNum,
          invoiceNumber,
          error: 'Duplicate invoice number in spreadsheet'
        });
      } else {
        seenInWorkbook.add(lowerInvNum);
        const existingId = dbInvoiceMap[lowerInvNum];
        if (existingId && !updateExisting) {
          failedReport.push({
            rowNumber: rowNum,
            invoiceNumber,
            error: 'Skipped: Invoice number already exists (update not selected)'
          });
        } else {
          row._originalRowNumber = rowNum;
          importableRows.push(row);
        }
      }
    }
  });
  
  if (importableRows.length === 0) {
    return {
      totalRows: rawData.length,
      successCount: 0,
      failedCount: failedReport.length,
      failedReport
    };
  }
  
  // 4. Resolve customers
  const customerNames = [...new Set(
    importableRows.map(r => getRowValue(r, REQUIRED_FIELDS.customer_name)).filter(Boolean)
  )];
  
  const existingCustomersRes = await client.get('/entities/Customer', { params: { limit: 100000 } });
  const existingCustomers = existingCustomersRes.data || [];
  const customerMap = {};
  existingCustomers.forEach(c => {
    customerMap[c.name.toLowerCase()] = c.id || c._id;
  });
  
  for (const name of customerNames) {
    if (!customerMap[name.toLowerCase()]) {
      const createdRes = await client.post('/entities/Customer', { name, status: 'active' });
      const created = createdRes.data;
      customerMap[name.toLowerCase()] = created.id || created._id;
    }
  }
  
  // 5. Concurrency queue processing
  const tasks = importableRows.map(row => async () => {
    const invoiceNumber = getRowValue(row, REQUIRED_FIELDS.invoice_number);
    const customerName = getRowValue(row, REQUIRED_FIELDS.customer_name);
    const quantity = Number(getRowValue(row, REQUIRED_FIELDS.quantity));
    const unitPrice = Number(getRowValue(row, REQUIRED_FIELDS.unit_price));
    const total = quantity * unitPrice;
    const invoiceDate = getRowValue(row, REQUIRED_FIELDS.invoice_date);
    
    let customerId = customerMap[customerName.toLowerCase()];
    if (!customerId) {
      customerId = customerMap['general customer'] || Object.values(customerMap)[0] || '';
    }
    
    const record = {
      invoice_number: invoiceNumber,
      customer_id: customerId,
      customer_name: customerName,
      invoice_date: invoiceDate,
      subtotal: total,
      total,
      status: 'draft',
      items: [{
        description: invoiceNumber || 'Imported Item',
        quantity,
        rate: unitPrice,
        amount: total,
        gst_rate: 0,
      }],
      ai_confidence: 1.0,
      ai_category: 'Imported (bulk)',
    };
    
    const existingId = dbInvoiceMap[invoiceNumber.toLowerCase()];
    if (existingId && updateExisting) {
      await client.put(`/entities/Invoice/${existingId}`, record);
      return { success: true, updated: true, invoiceNumber };
    } else {
      await client.post('/entities/Invoice', record);
      return { success: true, created: true, invoiceNumber };
    }
  });
  
  // Execute sequentially or concurrently
  const results = [];
  for (const t of tasks) {
    try {
      results.push(await t());
    } catch (err) {
      results.push({ error: err.response?.data?.error || err.message });
    }
  }
  
  // 6. Gather statistics
  let successCount = 0;
  results.forEach((res, idx) => {
    const row = importableRows[idx];
    const rowNum = row._originalRowNumber;
    const invoiceNumber = getRowValue(row, REQUIRED_FIELDS.invoice_number);
    
    if (res.error) {
      failedReport.push({
        rowNumber: rowNum,
        invoiceNumber,
        error: res.error
      });
    } else {
      successCount++;
    }
  });
  
  failedReport.sort((a, b) => a.rowNumber - b.rowNumber);
  
  return {
    totalRows: rawData.length,
    successCount,
    failedCount: failedReport.length,
    failedReport
  };
}

async function runTests() {
  try {
    console.log("Connecting to Database...");
    await mongoose.connect(MONGODB_URI);
    
    // Clear any existing test data for test user to start clean
    console.log("Cleaning old test database records...");
    await Invoice.deleteMany({ created_by: 'tester_importer@example.com' });
    await Customer.deleteMany({ created_by: 'tester_importer@example.com' });
    
    console.log("Logging in via API...");
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'tester_importer@example.com',
      password: 'Password123'
    });
    const token = loginRes.data.access_token;
    console.log("JWT Token obtained successfully!");
    
    // ----------------------------------------------------
    // TEST 1: Import valid CSV file (3 valid rows)
    // ----------------------------------------------------
    console.log("\n==================================================");
    console.log("TEST 1: Import valid CSV file ('scratch/import_valid.csv')");
    console.log("==================================================");
    
    const csvContent = fs.readFileSync(path.resolve('scratch/import_valid.csv'), 'utf8');
    const summary1 = await runImportLogic(token, csvContent, 'import_valid.csv', false);
    
    console.log("Test 1 Result Summary:", summary1);
    
    // Assert stats
    if (summary1.totalRows !== 3) throw new Error(`Expected 3 total rows, got ${summary1.totalRows}`);
    if (summary1.successCount !== 3) throw new Error(`Expected 3 successes, got ${summary1.successCount}`);
    if (summary1.failedCount !== 0) throw new Error(`Expected 0 failures, got ${summary1.failedCount}`);
    
    // Verify in database
    const dbInvoices1 = await Invoice.find({ created_by: 'tester_importer@example.com' });
    if (dbInvoices1.length !== 3) throw new Error(`Expected 3 invoices in db, found ${dbInvoices1.length}`);
    console.log("Test 1 Passed: 3 invoices successfully created in database.");
    
    // ----------------------------------------------------
    // TEST 2: Import mixed CSV file with errors, duplicates, and skip existing
    // ----------------------------------------------------
    console.log("\n==================================================");
    console.log("TEST 2: Import mixed CSV file ('scratch/import_mixed.csv') without updateExisting");
    console.log("==================================================");
    
    const mixedContent = fs.readFileSync(path.resolve('scratch/import_mixed.csv'), 'utf8');
    const summary2 = await runImportLogic(token, mixedContent, 'import_mixed.csv', false);
    
    console.log("Test 2 Result Summary:", summary2);
    
    // Total rows: 6
    // Success: 1 (INV-TEST-006)
    // Failed: 5
    //   - Row 2 (INV-TEST-001): Already exists in DB and updateExisting=false (Skipped)
    //   - Row 3 (INV-TEST-005): Missing Invoice_Date (Validation failure)
    //   - Row 5 (INV-TEST-006): Duplicate of Row 4 in sheet (Duplicate error)
    //   - Row 6 (INV-TEST-007): Quantity/Unit Price numeric check failed (abc is not a number)
    //   - Row 7 (INV-TEST-008): Date is not valid (not-a-date)
    if (summary2.totalRows !== 6) throw new Error(`Expected 6 total rows, got ${summary2.totalRows}`);
    if (summary2.successCount !== 1) throw new Error(`Expected 1 success, got ${summary2.successCount}`);
    if (summary2.failedCount !== 5) throw new Error(`Expected 5 failures, got ${summary2.failedCount}`);
    
    console.log("Test 2 Error Details:");
    summary2.failedReport.forEach(f => {
      console.log(`- Row ${f.rowNumber} (${f.invoiceNumber}): ${f.error}`);
    });
    
    const dbInvoices2 = await Invoice.find({ created_by: 'tester_importer@example.com' });
    if (dbInvoices2.length !== 4) throw new Error(`Expected 4 invoices in db now, found ${dbInvoices2.length}`);
    console.log("Test 2 Passed: 1 invoice created, 5 errors correctly filtered and reported.");

    // ----------------------------------------------------
    // TEST 3: Import mixed CSV file with updateExisting = true
    // ----------------------------------------------------
    console.log("\n==================================================");
    console.log("TEST 3: Import mixed CSV file ('scratch/import_mixed.csv') with updateExisting=true");
    console.log("==================================================");
    
    const summary3 = await runImportLogic(token, mixedContent, 'import_mixed.csv', true);
    console.log("Test 3 Result Summary:", summary3);
    
    // Total rows: 6
    // Success: 2 (updates INV-TEST-001, updates INV-TEST-006)
    // Failed: 4 (invalid validation rows)
    if (summary3.totalRows !== 6) throw new Error(`Expected 6 total rows, got ${summary3.totalRows}`);
    if (summary3.successCount !== 2) throw new Error(`Expected 2 successes, got ${summary3.successCount}`);
    if (summary3.failedCount !== 4) throw new Error(`Expected 4 failures, got ${summary3.failedCount}`);
    
    console.log("Test 3 Error Details:");
    summary3.failedReport.forEach(f => {
      console.log(`- Row ${f.rowNumber} (${f.invoiceNumber}): ${f.error}`);
    });
    
    console.log("Test 3 Passed: Existing invoices successfully updated.");
    
    // ----------------------------------------------------
    // TEST 4: Import valid Excel file (SheetJS integration)
    // ----------------------------------------------------
    console.log("\n==================================================");
    console.log("TEST 4: Import valid Excel file ('scratch/import_valid.xlsx')");
    console.log("==================================================");
    
    const xlsxBuffer = fs.readFileSync(path.resolve('scratch/import_valid.xlsx'));
    const summary4 = await runImportLogic(token, xlsxBuffer, 'import_valid.xlsx', false);
    
    console.log("Test 4 Result Summary:", summary4);
    
    if (summary4.totalRows !== 2) throw new Error(`Expected 2 total rows, got ${summary4.totalRows}`);
    if (summary4.successCount !== 2) throw new Error(`Expected 2 successes, got ${summary4.successCount}`);
    if (summary4.failedCount !== 0) throw new Error(`Expected 0 failures, got ${summary4.failedCount}`);
    
    const dbInvoices4 = await Invoice.find({ created_by: 'tester_importer@example.com' });
    // Initial 4 + 2 new Excel invoices = 6 invoices
    if (dbInvoices4.length !== 6) throw new Error(`Expected 6 invoices in db, found ${dbInvoices4.length}`);
    console.log("Test 4 Passed: Excel parsing and importing verified.");
    
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
