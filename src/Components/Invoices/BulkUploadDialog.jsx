import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { 
  UploadCloud, Loader2, CheckCircle2, AlertCircle, Download, FileSpreadsheet, ArrowRight, Check, FileText, Database, Info, Edit3
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import JSZip from 'jszip';

// Synonyms mapping definition
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
    { term: 'voucher', weight: 0.8 }
  ],
  invoice_date: [
    { term: 'invoice_date', weight: 1.0 },
    { term: 'invoicedate', weight: 1.0 },
    { term: 'date', weight: 0.95 },
    { term: 'inv_date', weight: 0.95 },
    { term: 'invdate', weight: 0.95 },
    { term: 'bill_date', weight: 0.95 },
    { term: 'billdate', weight: 0.95 }
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
    { term: 'buyer', weight: 0.8 }
  ],
  quantity: [
    { term: 'quantity', weight: 1.0 },
    { term: 'qty', weight: 1.0 },
    { term: 'pieces', weight: 0.95 },
    { term: 'pcs', weight: 0.95 },
    { term: 'units', weight: 0.9 }
  ],
  unit_price: [
    { term: 'unit_price', weight: 1.0 },
    { term: 'unitprice', weight: 1.0 },
    { term: 'price', weight: 0.95 },
    { term: 'rate', weight: 0.95 },
    { term: 'amount', weight: 0.9 },
    { term: 'cost', weight: 0.8 }
  ]
};

// 37 Supported Document Types configuration
const DOCUMENT_TYPES = {
  "Sales Invoice": { label: "Sales Invoice", dest: "Invoices Table", path: "/invoices", collection: "Invoice" },
  "Purchase Invoice": { label: "Purchase Invoice", dest: "Expenses Table", path: "/expenses", collection: "Expense" },
  "GST Invoice": { label: "GST Invoice", dest: "Invoices Table", path: "/invoices", collection: "Invoice" },
  "GST Challan": { label: "GST Challan", dest: "GST Center Page", path: "/gst", collection: null },
  "GST Return": { label: "GST Return", dest: "GST Center Page", path: "/gst", collection: null },
  "Credit Note": { label: "Credit Note", dest: "Invoices Table", path: "/invoices", collection: null },
  "Debit Note": { label: "Debit Note", dest: "Invoices Table", path: "/invoices", collection: null },
  "Quotation": { label: "Quotation", dest: "Invoices Table", path: "/invoices", collection: null },
  "Estimate": { label: "Estimate", dest: "Invoices Table", path: "/invoices", collection: null },
  "Purchase Order": { label: "Purchase Order", dest: "Expenses Table", path: "/expenses", collection: null },
  "Sales Order": { label: "Sales Order", dest: "Invoices Table", path: "/invoices", collection: null },
  "Delivery Challan": { label: "Delivery Challan", dest: "Invoices Table", path: "/invoices", collection: null },
  "E-way Bill": { label: "E-way Bill", dest: "GST Center Page", path: "/gst", collection: null },
  "Payment Receipt": { label: "Payment Receipt", dest: "Payments Table", path: "/payments", collection: "Payment" },
  "Expense Receipt": { label: "Expense Receipt", dest: "Expenses Table", path: "/expenses", collection: "Expense" },
  "Vendor Bill": { label: "Vendor Bill", dest: "Expenses Table", path: "/expenses", collection: "Expense" },
  "Bank Statement": { label: "Bank Statement", dest: "Ledger Table (as Payments)", path: "/ledger", collection: "Payment" },
  "Customer Statement": { label: "Customer Statement", dest: "Ledger Table", path: "/ledger", collection: null },
  "Ledger": { label: "Ledger", dest: "Ledger Table", path: "/ledger", collection: null },
  "Trial Balance": { label: "Trial Balance", dest: "Ledger Table", path: "/ledger", collection: null },
  "Balance Sheet": { label: "Balance Sheet", dest: "Ledger Table", path: "/ledger", collection: null },
  "Profit & Loss Statement": { label: "Profit & Loss Statement", dest: "Ledger Table", path: "/ledger", collection: null },
  "Cash Book": { label: "Cash Book", dest: "Ledger Table", path: "/ledger", collection: null },
  "Stock Report": { label: "Stock Report", dest: "Inventory Table", path: "/inventory", collection: null },
  "Inventory Report": { label: "Inventory Report", dest: "Inventory Table", path: "/inventory", collection: null },
  "Product List": { label: "Product List", dest: "Products Inventory Table", path: "/products", collection: "Product" },
  "Customer List": { label: "Customer List", dest: "Customers Table", path: "/customers", collection: "Customer" },
  "Supplier List": { label: "Supplier List", dest: "Suppliers Table", path: "/suppliers", collection: "Supplier" },
  "Employee Salary Sheet": { label: "Employee Salary Sheet", dest: "Ledger Table", path: "/ledger", collection: null },
  "Payroll": { label: "Payroll", dest: "Ledger Table", path: "/ledger", collection: null },
  "Tax Report": { label: "Tax Report", dest: "GST Center Page", path: "/gst", collection: null },
  "TDS Certificate": { label: "TDS Certificate", dest: "GST Center Page", path: "/gst", collection: null },
  "Form 16": { label: "Form 16", dest: "GST Center Page", path: "/gst", collection: null },
  "Form 26AS": { label: "Form 26AS", dest: "GST Center Page", path: "/gst", collection: null },
  "GST Registration Certificate": { label: "GST Registration", dest: "GST Center Page", path: "/gst", collection: null },
  "Cancelled Invoice": { label: "Cancelled Invoice", dest: "Invoices Table", path: "/invoices", collection: null },
  "Unknown Document": { label: "Unknown", dest: null, path: null, collection: null }
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

const detectSpreadsheetType = (headers, data) => {
  const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
  
  // 1. Customer List Check
  if (normalizedHeaders.some(h => ['email', 'phone', 'address'].includes(h)) && normalizedHeaders.some(h => ['customer', 'party', 'client', 'name'].includes(h))) {
    return "Customer List";
  }
  // 2. Supplier List Check
  if (normalizedHeaders.some(h => ['email', 'phone', 'address'].includes(h)) && normalizedHeaders.some(h => ['supplier', 'vendor', 'seller'].includes(h))) {
    return "Supplier List";
  }
  // 3. Product List Check
  if (normalizedHeaders.some(h => ['sku', 'price', 'quantity', 'stock'].includes(h)) && normalizedHeaders.some(h => ['product', 'item', 'description'].includes(h))) {
    return "Product List";
  }
  // 4. GST Challan Check
  if (normalizedHeaders.some(h => ['cpin', 'cin', 'gstin'].includes(h)) || (data && data.some(row => Object.values(row).some(v => String(v).toLowerCase().includes('payment receipt') || String(v).toLowerCase().includes('challan'))))) {
    return "GST Challan";
  }
  // 5. Bank Statement Check
  if (normalizedHeaders.some(h => ['withdrawal', 'deposit', 'debit', 'credit', 'balance'].includes(h))) {
    return "Bank Statement";
  }
  // 6. Ledger Check
  if (normalizedHeaders.some(h => ['ledger', 'openingbalance', 'journal'].includes(h))) {
    return "Ledger";
  }
  // 7. General Invoices Check
  if (normalizedHeaders.some(h => ['invoice', 'bill', 'qty', 'rate', 'price'].includes(h))) {
    const isPurchase = normalizedHeaders.some(h => ['vendor', 'supplier'].includes(h));
    return isPurchase ? "Purchase Invoice" : "Sales Invoice";
  }
  
  return "Unknown Document";
};

const getConfidenceColor = (conf) => {
  if (conf >= 0.90) return 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200';
  if (conf >= 0.70) return 'text-amber-700 bg-amber-50 dark:bg-amber-950/20 border-amber-200';
  return 'text-rose-700 bg-rose-50 dark:bg-rose-950/20 border-rose-200';
};

export default function BulkUploadDialog({ open, onClose, onDone }) {
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState('info');
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  
  // Workspace preview list of parsed files
  const [extractedDocs, setExtractedDocs] = useState([]);
  const [selectedDocIndex, setSelectedDocIndex] = useState(0);
  
  const inputRef = useRef(null);

  const reset = () => {
    setStatus('');
    setStatusType('info');
    setProcessing(false);
    setProgress({ current: 0, total: 0 });
    setImportSummary(null);
    setExtractedDocs([]);
    setSelectedDocIndex(0);
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    setStatusType('info');
    setStatus('Loading file...');
    
    try {
      const filesToProcess = [];
      
      // ====================================================
      // 1. Process ZIP File
      // ====================================================
      if (file.name.toLowerCase().endsWith('.zip')) {
        setStatus('Extracting ZIP archive in-memory...');
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        
        for (const [filename, entry] of Object.entries(loadedZip.files)) {
          if (entry.dir) continue; // skip directories
          
          const isText = filename.toLowerCase().match(/\.(csv)$/);
          const isExcel = filename.toLowerCase().match(/\.(xlsx|xls)$/);
          const isMedia = filename.toLowerCase().match(/\.(pdf|png|jpg|jpeg)$/);
          
          if (!isText && !isExcel && !isMedia) continue; // skip other formats
          
          let content;
          if (isMedia) {
            content = await entry.async('blob');
          } else {
            content = await entry.async('string');
          }
          
          const mimeType = isText ? 'text/csv' 
            : isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
            : isMedia && filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' 
            : 'image/jpeg';
            
          const extractedFile = new File([content], filename, { type: mimeType });
          filesToProcess.push(extractedFile);
        }
        
        if (filesToProcess.length === 0) {
          throw new Error('No supported documents (CSV, Excel, PDF, PNG, JPG) found inside ZIP archive.');
        }
      } else {
        filesToProcess.push(file);
      }
      
      // ====================================================
      // 2. Classify and Extract each file
      // ====================================================
      const docResults = [];
      let currentFileIdx = 0;
      
      for (const item of filesToProcess) {
        currentFileIdx++;
        setStatus(`Analyzing file ${currentFileIdx} of ${filesToProcess.length}: ${item.name}...`);
        
        const fileName = item.name;
        const fileNameLower = fileName.toLowerCase();
        
        // CSV / Excel sheets
        if (fileNameLower.endsWith('.csv') || fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls')) {
          let rawRows = [];
          if (fileNameLower.endsWith('.csv')) {
            const csvText = await item.text();
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: 'greedy' });
            rawRows = parsed.data || [];
          } else {
            const dataBuffer = await item.arrayBuffer();
            const workbook = XLSX.read(dataBuffer, { type: 'array' });
            workbook.SheetNames.forEach(sheetName => {
              const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
              rows.forEach(r => { r._sheetName = sheetName; });
              rawRows.push(...rows);
            });
          }
          
          if (rawRows.length === 0) {
            docResults.push({
              fileName: item.name,
              documentType: 'Unknown Document',
              confidence: 1.0,
              fields: {},
              products: [],
              rows: [],
              error: 'File contains no data rows.'
            });
            continue;
          }
          
          // Get unique headers
          const headers = [];
          const checkCount = Math.min(rawRows.length, 5);
          const headerSet = new Set();
          for (let i = 0; i < checkCount; i++) {
            Object.keys(rawRows[i]).forEach(k => { if (!k.startsWith('_')) headerSet.add(k); });
          }
          headers.push(...headerSet);
          
          // Classify document type
          const documentType = detectSpreadsheetType(headers, rawRows);
          
          // Perform synonyms schema mapping
          const { mapping, confidence } = mapHeadersToSchema(headers);
          
          // Map values
          const fields = {};
          const products = [];
          const rows = [];
          
          const mappedTypeInfo = DOCUMENT_TYPES[documentType];
          
          // If it's a statement or list, map rows
          if (["Customer List", "Supplier List", "Product List", "Bank Statement", "Ledger"].includes(documentType)) {
            rawRows.forEach(r => {
              rows.push({ ...r });
            });
          } else {
            // Treat as invoices/receipts, populate products
            rawRows.forEach((r, idx) => {
              const invNo = mapping.invoice_number ? String(r[mapping.invoice_number] || '').trim() : '';
              const date = mapping.invoice_date ? String(r[mapping.invoice_date] || '').trim() : '';
              const cust = mapping.customer_name ? String(r[mapping.customer_name] || '').trim() : '';
              const qty = Number(r[mapping.quantity]) || 1;
              const price = Number(r[mapping.unit_price]) || 0;
              
              if (idx === 0) {
                fields.invoice_number = invNo;
                fields.invoice_date = date;
                fields.customer = cust;
                fields.supplier = cust;
              }
              
              products.push({
                description: invNo || `Item ${idx+1}`,
                quantity: qty,
                rate: price,
                total: qty * price,
                taxable_value: qty * price
              });
            });
          }
          
          docResults.push({
            fileName: item.name,
            documentType,
            confidence: Math.round(confidence * 100) / 100,
            fields,
            products,
            rows,
            mapping,
            headers,
            rawData: rawRows
          });
          
        } else {
          // PDFs / Images
          const base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(item);
          });
          
          const res = await apiClient.post('/assistant/extract-invoice', {
            fileData: base64Data,
            fileName: item.name,
            mimeType: item.type
          });
          
          const data = res.data || {};
          docResults.push({
            fileName: item.name,
            documentType: data.documentType || "Unknown Document",
            confidence: data.confidence || 0.95,
            fields: data.fields || {},
            products: data.products || [],
            rows: data.rows || []
          });
        }
      }
      
      setExtractedDocs(docResults);
      setSelectedDocIndex(0);
      setProcessing(false);
      setStatus('');
    } catch (err) {
      setStatusType('error');
      setStatus(err.message || 'Something went wrong while parsing file.');
      setProcessing(false);
    }
  };

  const handleUpdateField = (docIdx, fieldKey, val) => {
    const updated = [...extractedDocs];
    updated[docIdx].fields[fieldKey] = val;
    setExtractedDocs(updated);
  };

  const handleUpdateProduct = (docIdx, prodIdx, colKey, val) => {
    const updated = [...extractedDocs];
    updated[docIdx].products[prodIdx][colKey] = val;
    setExtractedDocs(updated);
  };

  const handleUpdateRow = (docIdx, rowIdx, colKey, val) => {
    const updated = [...extractedDocs];
    updated[docIdx].rows[rowIdx][colKey] = val;
    setExtractedDocs(updated);
  };

  const handleRemoveDoc = (idx) => {
    const updated = extractedDocs.filter((_, i) => i !== idx);
    setExtractedDocs(updated);
    if (selectedDocIndex >= updated.length) {
      setSelectedDocIndex(Math.max(0, updated.length - 1));
    }
  };

  const handleImportAll = async () => {
    setProcessing(true);
    setStatusType('info');
    
    let totalDocsCount = extractedDocs.length;
    let successDocsCount = 0;
    let failDocsCount = 0;
    const failedReport = [];
    
    try {
      // Fetch existing invoices/customers/suppliers/products to map and skip duplicate calls
      setStatus('Connecting to database...');
      const [existingInvoicesRes, existingCustomersRes, existingSuppliersRes, existingProductsRes] = await Promise.all([
        apiClient.get('/entities/Invoice', { params: { limit: 100000 } }),
        apiClient.get('/entities/Customer', { params: { limit: 100000 } }),
        apiClient.get('/entities/Supplier', { params: { limit: 100000 } }),
        apiClient.get('/entities/Product', { params: { limit: 100000 } })
      ]);
      
      const dbInvoices = existingInvoicesRes.data || [];
      const dbCustomers = existingCustomersRes.data || [];
      const dbSuppliers = existingSuppliersRes.data || [];
      const dbProducts = existingProductsRes.data || [];
      
      const customerMap = {};
      dbCustomers.forEach(c => { customerMap[c.name.toLowerCase()] = c.id || c._id; });
      const supplierMap = {};
      dbSuppliers.forEach(s => { supplierMap[s.name.toLowerCase()] = s.id || s._id; });
      const productMap = {};
      dbProducts.forEach(p => { productMap[p.sku.toLowerCase()] = p.id || p._id; });
      const invoiceMap = {};
      dbInvoices.forEach(i => { if (i.invoice_number) invoiceMap[i.invoice_number.toLowerCase()] = i.id || i._id; });
      
      let docIdx = 0;
      for (const doc of extractedDocs) {
        docIdx++;
        setStatus(`Importing document ${docIdx} of ${totalDocsCount}: ${doc.fileName}...`);
        
        const docType = doc.documentType;
        const typeInfo = DOCUMENT_TYPES[docType] || DOCUMENT_TYPES["Unknown Document"];
        
        if (!typeInfo.collection) {
          // Document recognized but no import workflow exists
          failedReport.push({
            rowNumber: docIdx,
            invoiceNumber: doc.fileName,
            error: `Recognized as ${docType} - no import workflow exists.`
          });
          failDocsCount++;
          continue;
        }
        
        try {
          if (docType === "Sales Invoice" || docType === "GST Invoice") {
            const invoiceNumber = String(doc.fields.invoice_number || '').trim();
            const customerName = String(doc.fields.customer || doc.fields.business_name || 'General Customer').trim();
            const date = String(doc.fields.invoice_date || '').trim() || new Date().toISOString().split('T')[0];
            
            if (!invoiceNumber) throw new Error('Missing invoice number.');
            
            // Create customer if missing
            let customerId = customerMap[customerName.toLowerCase()];
            if (!customerId) {
              const res = await apiClient.post('/entities/Customer', { name: customerName, status: 'active' });
              customerId = res.data.id || res.data._id;
              customerMap[customerName.toLowerCase()] = customerId;
            }
            
            const total = doc.products.reduce((s, p) => s + (Number(p.total) || (Number(p.quantity) * Number(p.rate)) || 0), 0);
            
            const record = {
              invoice_number: invoiceNumber,
              customer_id: customerId,
              customer_name: customerName,
              invoice_date: date,
              subtotal: total,
              total,
              status: 'draft',
              items: doc.products.map(p => ({
                description: p.description || 'Imported Item',
                quantity: Number(p.quantity) || 1,
                rate: Number(p.rate) || total,
                amount: p.total || total,
                gst_rate: Number(p.gst_rate) || 0
              })),
              ai_confidence: doc.confidence,
              ai_category: 'AI Imported'
            };
            
            const existingId = invoiceMap[invoiceNumber.toLowerCase()];
            if (existingId) {
              if (updateExisting) {
                await apiClient.put(`/entities/Invoice/${existingId}`, record);
              } else {
                throw new Error(`Invoice number "${invoiceNumber}" already exists.`);
              }
            } else {
              await apiClient.post('/entities/Invoice', record);
            }
            successDocsCount++;
            
          } else if (docType === "Purchase Invoice" || docType === "Expense Receipt" || docType === "Vendor Bill") {
            const vendorName = String(doc.fields.supplier || doc.fields.business_name || 'Generic Vendor').trim();
            const date = String(doc.fields.invoice_date || '').trim() || new Date().toISOString().split('T')[0];
            const amount = doc.products.reduce((s, p) => s + (Number(p.total) || 0), 0) || Number(doc.fields.total) || 0;
            const title = docType === "Purchase Invoice" 
              ? `Purchase Invoice: ${doc.fields.invoice_number || 'N/A'}` 
              : `${docType}: ${vendorName}`;
              
            const record = {
              title,
              category: docType === "Purchase Invoice" ? "raw_materials" : "office_supplies",
              amount,
              payment_mode: doc.fields.payment_mode === "bank" ? "bank" : "upi",
              date,
              vendor: vendorName,
              notes: doc.fields.notes || `AI Extracted from ${doc.fileName}`,
              status: doc.fields.payment_status === "success" ? "approved" : "pending"
            };
            
            await apiClient.post('/entities/Expense', record);
            successDocsCount++;
            
          } else if (docType === "Customer List") {
            let added = 0;
            for (const row of doc.rows) {
              const name = String(row.name || row.Customer_Name || '').trim();
              if (name && !customerMap[name.toLowerCase()]) {
                const res = await apiClient.post('/entities/Customer', {
                  name,
                  email: row.email || '',
                  phone: row.phone || '',
                  status: 'active'
                });
                customerMap[name.toLowerCase()] = res.data.id || res.data._id;
                added++;
              }
            }
            successDocsCount++;
            
          } else if (docType === "Supplier List") {
            let added = 0;
            for (const row of doc.rows) {
              const name = String(row.name || row.Supplier_Name || '').trim();
              if (name && !supplierMap[name.toLowerCase()]) {
                const res = await apiClient.post('/entities/Supplier', {
                  name,
                  email: row.email || '',
                  phone: row.phone || '',
                  status: 'active'
                });
                supplierMap[name.toLowerCase()] = res.data.id || res.data._id;
                added++;
              }
            }
            successDocsCount++;
            
          } else if (docType === "Product List") {
            let added = 0;
            for (const row of doc.rows) {
              const name = String(row.name || row.Product_Name || '').trim();
              const sku = String(row.sku || `SKU-${Date.now().toString().slice(-4)}-${added}`).trim();
              if (name && !productMap[sku.toLowerCase()]) {
                const res = await apiClient.post('/entities/Product', {
                  name,
                  sku,
                  sale_price: Number(row.sale_price || row.price || 0),
                  purchase_price: Number(row.purchase_price || 0),
                  stock_quantity: Number(row.stock_quantity || row.quantity || 0),
                  status: 'active'
                });
                productMap[sku.toLowerCase()] = res.data.id || res.data._id;
                added++;
              }
            }
            successDocsCount++;
            
          } else if (docType === "Bank Statement") {
            let added = 0;
            for (const row of doc.rows) {
              const date = row.date || row.Date || new Date().toISOString().split('T')[0];
              const desc = row.description || row.Description || 'Bank Transaction';
              const credit = Number(row.credit || row.Deposit || row.amount || 0);
              const debit = Number(row.debit || row.Withdrawal || 0);
              const amount = credit || debit;
              
              if (amount > 0) {
                await apiClient.post('/entities/Payment', {
                  payment_number: `PAY-${Date.now().toString().slice(-6)}-${added}`,
                  amount,
                  payment_mode: 'bank',
                  date,
                  notes: desc,
                  reference_number: row.reference_number || row.UTR || '',
                  status: 'success'
                });
                added++;
              }
            }
            successDocsCount++;
          }
          
        } catch (err) {
          failedReport.push({
            rowNumber: docIdx,
            invoiceNumber: doc.fileName,
            error: err.message || 'Validation error'
          });
          failDocsCount++;
        }
      }
      
      setImportSummary({
        totalRows: totalDocsCount,
        successCount: successDocsCount,
        failedCount: failDocsCount,
        failedReport
      });
      setStatusType(failDocsCount === totalDocsCount ? 'error' : 'success');
      setStatus('Import processing complete.');
      setProcessing(false);
      
    } catch (err) {
      setStatusType('error');
      setStatus(err.message || 'Import failed.');
      setProcessing(false);
    }
  };

  // ====================================================
  // SCREEN: Results Summary View
  // ====================================================
  if (importSummary) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" /> Universal Import Results
            </DialogTitle>
            <DialogDescription>
              The document processing queue is complete.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 my-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-muted/50 p-4 rounded-xl text-center border border-border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Documents</p>
                <p className="text-3xl font-extrabold mt-1 text-foreground">{importSummary.totalRows}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-xl text-center border border-emerald-100 dark:border-emerald-900/30">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wider">Success</p>
                <p className="text-3xl font-extrabold mt-1 text-emerald-600 dark:text-emerald-400">{importSummary.successCount}</p>
              </div>
              <div className={`p-4 rounded-xl text-center border ${
                importSummary.failedCount > 0 
                  ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30' 
                  : 'bg-muted/50 border-border'
              }`}>
                <p className={`text-xs font-medium uppercase tracking-wider ${
                  importSummary.failedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                }`}>Failed/Skipped</p>
                <p className={`text-3xl font-extrabold mt-1 ${
                  importSummary.failedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                }`}>{importSummary.failedCount}</p>
              </div>
            </div>

            {importSummary.failedCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-500" /> Failures / Warnings
                  </h4>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={downloadReport} 
                    className="h-8 gap-1.5 text-xs animate-pulse"
                  >
                    <Download className="w-3.5 h-3.5" /> Download Error Report
                  </Button>
                </div>
                
                <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-muted text-muted-foreground font-semibold sticky top-0 border-b border-border">
                      <tr>
                        <th className="p-2 w-16 text-center">Index</th>
                        <th className="p-2 w-28 font-mono">File Name</th>
                        <th className="p-2">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {importSummary.failedReport.map((item, index) => (
                        <tr key={index} className="hover:bg-muted/30 transition-colors">
                          <td className="p-2 text-center text-muted-foreground font-mono">{item.rowNumber}</td>
                          <td className="p-2 font-mono truncate max-w-[120px]">{item.invoiceNumber}</td>
                          <td className="p-2 text-red-600 dark:text-red-400">{item.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={reset} className="flex-1 sm:flex-initial">
              Import Another File
            </Button>
            <Button onClick={() => onDone()} className="flex-1 sm:flex-initial">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ====================================================
  // SCREEN: Multi-Document Preview Workspace
  // ====================================================
  if (extractedDocs.length > 0) {
    const selectedDoc = extractedDocs[selectedDocIndex];
    const typeInfo = DOCUMENT_TYPES[selectedDoc.documentType] || DOCUMENT_TYPES["Unknown Document"];
    const showDestination = !!typeInfo.dest;
    const isImportable = !!typeInfo.collection;
    const confidenceColor = getConfidenceColor(selectedDoc.confidence);
    
    // Check if nothing meaningful found
    const hasNoData = !selectedDoc.documentType || selectedDoc.documentType === 'Unknown Document' || 
      (selectedDoc.products.length === 0 && selectedDoc.rows.length === 0 && Object.keys(selectedDoc.fields).length === 0);

    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="p-6 border-b border-border flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Database className="w-6 h-6 text-primary" /> Business Intelligence Workspace
            </DialogTitle>
            <DialogDescription>
              Review, edit, and confirm AI-extracted fields and tables before importing to database.
            </DialogDescription>
          </DialogHeader>

          {/* Main workspace splits */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* LEFT SIDEBAR: File List */}
            {extractedDocs.length > 1 && (
              <div className="w-64 border-r border-border bg-muted/10 overflow-y-auto flex-shrink-0 p-4 space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Documents Queue ({extractedDocs.length})</p>
                {extractedDocs.map((doc, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedDocIndex(idx)}
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                      idx === selectedDocIndex
                        ? 'bg-primary/5 border-primary text-primary font-semibold'
                        : 'border-border bg-background hover:bg-muted/30 text-foreground'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="text-xs truncate font-mono flex-1">{doc.fileName}</p>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveDoc(idx);
                        }} 
                        className="text-muted-foreground hover:text-red-500 font-bold text-xs"
                      >
                        ×
                      </button>
                    </div>
                    <p className={`text-[10px] mt-1 font-medium px-2 py-0.5 rounded-full inline-block border ${
                      doc.documentType === 'Unknown Document' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-muted text-muted-foreground border-border'
                    }`}>
                      {doc.documentType}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* RIGHT WORKSPACE: Selected File Preview */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="space-y-1">
                  <h3 className="text-base font-bold font-mono text-foreground flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-primary" /> {selectedDoc.fileName}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Detected Type:</span>
                    <span className="text-xs font-bold bg-primary/10 text-primary px-2.5 py-0.5 rounded-full border border-primary/20">
                      {selectedDoc.documentType}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`px-3 py-1.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 ${confidenceColor}`}>
                    Confidence: {Math.round(selectedDoc.confidence * 100)}%
                  </div>
                  {showDestination && (
                    <div className="px-3 py-1.5 border border-border bg-muted/30 text-muted-foreground rounded-lg text-xs font-semibold">
                      Destination: <span className="text-foreground">{typeInfo.dest}</span>
                    </div>
                  )}
                </div>
              </div>

              {hasNoData ? (
                <div className="flex flex-col items-center justify-center p-8 border border-red-200 bg-red-50/10 dark:bg-red-950/10 rounded-xl space-y-3">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">No valid business data could be detected.</p>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    This file does not appear to contain readable invoices, lists, statements, or recognized receipts. Fake records will not be created.
                  </p>
                </div>
              ) : (
                <>
                  {/* Warning if recognized but unsupported */}
                  {!isImportable && selectedDoc.documentType !== "Unknown Document" && (
                    <div className="p-4 border border-blue-200 bg-blue-50/30 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-xl flex items-start gap-2.5">
                      <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-500" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">Recognized Document Type</p>
                        <p className="text-xs">
                          This document is recognized but currently no import workflow exists.
                        </p>
                        {typeInfo.path && (
                          <Button 
                            variant="link" 
                            size="sm" 
                            onClick={() => {
                              navigate(typeInfo.path);
                              onClose();
                            }}
                            className="p-0 h-auto font-bold text-xs text-blue-600 dark:text-blue-400"
                          >
                            Navigate to {typeInfo.dest} &rarr;
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Header / Fields Form */}
                  {Object.keys(selectedDoc.fields).length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-foreground">Extracted Fields</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(selectedDoc.fields).map(([key, val]) => (
                          <div key={key} className="space-y-1 p-2 bg-muted/10 border border-border rounded-lg">
                            <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{key.replace(/_/g, ' ')}</label>
                            <input
                              type="text"
                              value={val || ''}
                              onChange={(e) => handleUpdateField(selectedDocIndex, key, e.target.value)}
                              className="w-full text-xs font-semibold bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-foreground"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Products Table (for Invoices/Receipts) */}
                  {selectedDoc.products.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-foreground">Line Items ({selectedDoc.products.length})</h4>
                      <div className="border border-border rounded-lg overflow-hidden">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground font-semibold border-b border-border">
                            <tr>
                              <th className="p-2.5">Description</th>
                              <th className="p-2.5 w-16 text-center">Qty</th>
                              <th className="p-2.5 w-24 text-right">Rate</th>
                              <th className="p-2.5 w-24 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {selectedDoc.products.map((item, idx) => (
                              <tr key={idx} className="hover:bg-muted/20">
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={item.description || ''}
                                    onChange={(e) => handleUpdateProduct(selectedDocIndex, idx, 'description', e.target.value)}
                                    className="w-full bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="number"
                                    value={item.quantity || 0}
                                    onChange={(e) => handleUpdateProduct(selectedDocIndex, idx, 'quantity', Number(e.target.value))}
                                    className="w-12 bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-center"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <input
                                    type="number"
                                    value={item.rate || 0}
                                    onChange={(e) => handleUpdateProduct(selectedDocIndex, idx, 'rate', Number(e.target.value))}
                                    className="w-20 bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-right"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <input
                                    type="number"
                                    value={item.total || (item.quantity * item.rate) || 0}
                                    onChange={(e) => handleUpdateProduct(selectedDocIndex, idx, 'total', Number(e.target.value))}
                                    className="w-20 bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-right"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Rows Table (for Customer Lists, Product Lists, Bank Statements, Ledgers) */}
                  {selectedDoc.rows.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-foreground">Table Data Rows ({selectedDoc.rows.length})</h4>
                      <div className="border border-border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground font-semibold border-b border-border sticky top-0">
                            <tr>
                              {Object.keys(selectedDoc.rows[0]).filter(k => !k.startsWith('_')).map(header => (
                                <th key={header} className="p-2.5 uppercase tracking-wider">{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {selectedDoc.rows.map((row, idx) => (
                              <tr key={idx} className="hover:bg-muted/20">
                                {Object.keys(row).filter(k => !k.startsWith('_')).map(colKey => (
                                  <td key={colKey} className="p-2">
                                    <input
                                      type="text"
                                      value={row[colKey] !== undefined ? row[colKey] : ''}
                                      onChange={(e) => handleUpdateRow(selectedDocIndex, idx, colKey, e.target.value)}
                                      className="w-full bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Footer Controls */}
          <div className="p-6 border-t border-border flex items-center justify-between flex-shrink-0 bg-muted/10">
            <div className="flex items-center gap-6">
              <Button variant="outline" onClick={reset} disabled={processing}>Reset</Button>
              {extractedDocs.some(d => DOCUMENT_TYPES[d.documentType]?.collection === "Invoice") && (
                <div className="flex items-center gap-2">
                  <input
                    id="workspace-update-checkbox"
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="w-4 h-4 text-primary border-border rounded cursor-pointer accent-primary"
                  />
                  <label htmlFor="workspace-update-checkbox" className="text-xs text-muted-foreground select-none cursor-pointer">
                    Overwrite existing invoices if duplicate
                  </label>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={processing}>Cancel</Button>
              <Button 
                onClick={handleImportAll} 
                disabled={processing || !extractedDocs.some(d => !!DOCUMENT_TYPES[d.documentType]?.collection)}
                className="gap-2"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                Confirm & Import All Queue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ====================================================
  // SCREEN: Initial Upload Dropzone
  // ====================================================
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-primary" /> AI Intelligence Importer
          </DialogTitle>
          <DialogDescription>
            Drop ANY business document: CSV, Excel, PDF, PNG/JPG, scanned files, or ZIP folders with multiple files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            onClick={() => !processing && inputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.zip"
              className="hidden"
              onChange={handleFileChange}
              disabled={processing}
            />
            <UploadCloud className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold">Click to select files or ZIP archive</p>
            <p className="text-xs text-muted-foreground mt-1">Accepts multiple documents via ZIP</p>
          </div>

          {processing && (
            <div className="space-y-2 mt-4 p-4 bg-muted/30 border border-border rounded-lg">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-foreground">Analyzing Document Queue</span>
                <span className="text-muted-foreground font-mono font-bold animate-pulse">Processing...</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden border border-border">
                <div className="bg-primary h-full rounded-full w-1/2 animate-bounce" />
              </div>
            </div>
          )}

          {status && (
            <div className={`flex items-start gap-2 text-sm p-3 rounded-lg ${
              statusType === 'error' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
              : statusType === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
            }`}>
              {statusType === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                : statusType === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                : <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />}
              <span>{status}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={processing}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}