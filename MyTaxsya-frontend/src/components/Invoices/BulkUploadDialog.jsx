import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  UploadCloud, Loader2, CheckCircle2, AlertCircle, Download, FileText, Database, Info
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import JSZip from 'jszip';

const normalizeInvoiceDate = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  let str = String(value).trim();
  if (!str || ["null", "undefined", "n/a", "none"].includes(str.toLowerCase())) return null;
  if (str.includes('T')) str = str.split('T')[0].trim();
  else if (str.includes(' ')) {
    const parts = str.split(' ');
    if (parts[0].match(/[\/\-\.]/)) str = parts[0];
  }
  let year, month, day;
  const monthMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };
  const yyyymmdd = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/.exec(str);
  if (yyyymmdd) {
    year = parseInt(yyyymmdd[1], 10);
    month = parseInt(yyyymmdd[2], 10);
    day = parseInt(yyyymmdd[3], 10);
  } else {
    const ddmmyyyy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(str);
    if (ddmmyyyy) {
      day = parseInt(ddmmyyyy[1], 10);
      month = parseInt(ddmmyyyy[2], 10);
      year = parseInt(ddmmyyyy[3], 10);
    } else {
      const ddmmyy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/.exec(str);
      if (ddmmyy) {
        day = parseInt(ddmmyy[1], 10);
        month = parseInt(ddmmyy[2], 10);
        const shortYr = parseInt(ddmmyy[3], 10);
        year = shortYr > 50 ? 1900 + shortYr : 2000 + shortYr;
      } else {
        const ddmon = /^(\d{1,2})[\s\/\-\.]([A-Za-z]{3,9})[\s\/\-\.](\d{2,4})$/.exec(str);
        if (ddmon) {
          day = parseInt(ddmon[1], 10);
          const mStr = ddmon[2].toLowerCase();
          month = monthMap[mStr] || null;
          let yVal = parseInt(ddmon[3], 10);
          if (yVal < 100) yVal = yVal > 50 ? 1900 + yVal : 2000 + yVal;
          year = yVal;
        } else return null;
      }
    }
  }
  if (isNaN(year) || !month || isNaN(month) || isNaN(day)) return null;
  if (month < 1 || month > 12) return null;
  if (year < 1000 || year > 9999) return null;
  const daysInMonth = (y, m) => {
    if (m === 2) {
      const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return isLeap ? 29 : 28;
    }
    if ([4, 6, 9, 11].includes(m)) return 30;
    return 31;
  };
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

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
  if (conf >= 0.90) return 'text-secondary bg-secondary/10 border-secondary/20';
  if (conf >= 0.70) return 'text-accent bg-accent/10 border-accent/20';
  return 'text-destructive bg-destructive/10 border-destructive/20';
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
  const [lastUploadedFile, setLastUploadedFile] = useState(null);
  const [isRetryable, setIsRetryable] = useState(true);

  const inputRef = useRef(null);

  const reset = () => {
    setStatus('');
    setStatusType('info');
    setProcessing(false);
    setProgress({ current: 0, total: 0 });
    setImportSummary(null);
    setExtractedDocs([]);
    setSelectedDocIndex(0);
    setLastUploadedFile(null);
    setIsRetryable(true);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const handleRetry = () => {
    if (lastUploadedFile) {
      const fileToRetry = lastUploadedFile;
      setExtractedDocs([]);
      setSelectedDocIndex(0);
      setImportSummary(null);
      processUploadedFile(fileToRetry);
    } else if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset previous extraction state completely before starting fresh upload
    setExtractedDocs([]);
    setSelectedDocIndex(0);
    setImportSummary(null);
    setLastUploadedFile(null);
    
    processUploadedFile(file);
    if (e.target) e.target.value = '';
  };

  const processUploadedFile = async (file) => {
    if (!file) return;
    console.log(`[FRONTEND-DEBUG] Processing file upload: '${file.name}' (${file.size} bytes, MIME: ${file.type})`);

    // Purge any stale UI extraction state
    setExtractedDocs([]);
    setSelectedDocIndex(0);
    setImportSummary(null);
    setLastUploadedFile(file);
    setProcessing(true);
    setStatusType('info');
    setStatus('Loading file...');
    setIsRetryable(true);

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
                description: invNo || `Item ${idx + 1}`,
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
          // PDFs / Images / ZIPs using FormData for streaming 100MB uploads with progress
          const jobId = item.jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const formData = new FormData();
          formData.append('file', item);
          formData.append('jobId', jobId);

          setStatus(`Reading document & extracting text from ${item.name}...`);

          const res = await api.post('/assistant/extract-invoice', formData, {
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                if (percent < 100) {
                  setStatus(`Uploading ${item.name} (${percent}%)...`);
                } else {
                  setStatus(`Extracting text, running OCR & AI analysis for ${item.name}...`);
                }
              }
            }
          });

          setStatus(`Validating extracted invoice data for ${item.name}...`);

          const data = res.data || {};

          // Verify job identity match
          if (data.jobId && data.jobId !== jobId) {
            console.warn(`[FRONTEND-WARN] Mismatched response jobId (${data.jobId}) vs active jobId (${jobId}). Ignoring result.`);
          }

          const valStatus = data.status || data.validation_status || (data.fields?.invoice_number ? "success" : "needs_review");

          // If backend returned multiple documents (e.g. from a ZIP archive)
          if (data.documents && Array.isArray(data.documents) && data.documents.length > 0) {
            data.documents.forEach(doc => {
              docResults.push({
                jobId: doc.jobId || jobId,
                fileHash: doc.fileHash || null,
                fileName: doc.fileName || item.name,
                status: doc.status || valStatus,
                documentType: doc.documentType || "Sales Invoice",
                confidence: doc.confidence !== undefined ? doc.confidence : (doc.confidence_score || 0.95),
                fields: doc.fields || {},
                products: doc.products || doc.line_items || [],
                rows: doc.rows || [],
                seller_information: doc.seller_information,
                buyer_information: doc.buyer_information,
                invoice_information: doc.invoice_information,
                totals: doc.totals,
                line_items: doc.line_items,
                warnings: doc.warnings,
                debug: doc.debug
              });
            });
          } else {
            docResults.push({
              jobId: data.jobId || jobId,
              fileHash: data.fileHash || null,
              fileName: item.name,
              status: valStatus,
              documentType: data.documentType || "Sales Invoice",
              confidence: data.confidence !== undefined ? data.confidence : (data.confidence_score || 0.95),
              fields: data.fields || {},
              products: data.products || data.line_items || [],
              rows: data.rows || [],
              seller_information: data.seller_information,
              buyer_information: data.buyer_information,
              invoice_information: data.invoice_information,
              totals: data.totals,
              line_items: data.line_items,
              warnings: data.warnings || (valStatus === "needs_review" ? ["Invoice number could not be confidently read"] : []),
              debug: data.debug
            });
          }
        }
      }

      setExtractedDocs(docResults);
      setSelectedDocIndex(0);
      setProcessing(false);
      setStatus('');
    } catch (err) {
      setStatusType('error');
      let errorMsg = 'Invoice extraction failed';
      const errData = err.data || {};
      const errorCode = errData.error_code || errData.diagnostic?.error_code;
      const retrySec = errData.diagnostic?.retry_after_seconds || 19;

      const nonRetryableCodes = ['AI_DAILY_QUOTA_EXHAUSTED', 'AI_UNAUTHORIZED', 'AI_MODEL_NOT_FOUND', 'AI_CONFIG_ERROR'];

      const canRetry = errData.diagnostic?.retryable !== undefined
        ? errData.diagnostic.retryable
        : !nonRetryableCodes.includes(errorCode);
      setIsRetryable(canRetry);

      if (errorCode === 'AI_UNAUTHORIZED') {
        errorMsg = errData.error || 'Invalid Gemini API key provided. Please verify your GEMINI_API_KEY configuration.';
      } else if (errorCode === 'AI_MODEL_NOT_FOUND') {
        errorMsg = errData.error || 'Configured Gemini model was not found (HTTP 404). Please verify your GEMINI_MODEL setting.';
      } else if (errorCode === 'AI_DAILY_QUOTA_EXHAUSTED') {
        errorMsg = 'AI extraction quota is currently exhausted. Please try again when your Gemini quota resets or configure a higher API quota.';
      } else if (errorCode === 'AI_RATE_LIMITED' || errorCode === 'AI_QUOTA_EXCEEDED') {
        errorMsg = `AI rate limit reached. Please try again after ${retrySec} seconds.`;
      } else if (err.status === 413) {
        errorMsg = 'Invoice extraction failed (File Size Exceeded): File exceeds 100 MB limit.';
      } else if (errData.error) {
        errorMsg = errData.error;
      } else if (err.message) {
        errorMsg = err.message.startsWith('Invoice extraction failed') ? err.message : `Invoice extraction failed: ${err.message}`;
      }
      setStatus(errorMsg);
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

  const downloadReport = () => {
    if (!importSummary || !importSummary.failedReport) return;
    const reportContent = importSummary.failedReport.map((item, idx) => ({
      Index: item.rowNumber || idx + 1,
      InvoiceNumber: item.invoiceNumber || 'N/A',
      Error: item.error || 'Unknown processing error'
    }));
    const blob = new Blob([JSON.stringify(reportContent, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error_report_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        api.get('/entities/Invoice', { params: { limit: 100000 } }),
        api.get('/entities/Customer', { params: { limit: 100000 } }),
        api.get('/entities/Supplier', { params: { limit: 100000 } }),
        api.get('/entities/Product', { params: { limit: 100000 } })
      ]);

      const dbInvoices = existingInvoicesRes.data || [];
      const dbCustomers = existingCustomersRes.data || [];
      const dbSuppliers = existingSuppliersRes.data || [];
      const dbProducts = existingProductsRes.data || [];

      // dbCustomers/dbSuppliers are returned newest-first; if duplicate names exist,
      // keep the first (newest) match instead of letting a later (older) duplicate
      // silently overwrite it.
      const customerMap = {};
      dbCustomers.forEach(c => { const k = c.name.toLowerCase(); if (!customerMap[k]) customerMap[k] = c.id || c._id; });
      const supplierMap = {};
      dbSuppliers.forEach(s => { const k = s.name.toLowerCase(); if (!supplierMap[k]) supplierMap[k] = s.id || s._id; });
      const productMap = {};
      dbProducts.forEach(p => { if (p.sku) productMap[p.sku.toLowerCase()] = p.id || p._id; });
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
            const rawDate = doc.fields.invoice_date || doc.invoice_information?.invoice_date || '';
            const date = normalizeInvoiceDate(rawDate) || new Date().toISOString().split('T')[0];

            if (!invoiceNumber) throw new Error('Missing invoice number.');

            // Create customer if missing — carry over the extracted buyer's
            // state/GSTIN/address so downstream intra-/inter-state (CGST+SGST
            // vs IGST) detection has the data it needs.
            let customerId = customerMap[customerName.toLowerCase()];
            if (!customerId) {
              const buyerInfo = doc.buyer_information || {};
              const res = await api.post('/entities/Customer', {
                name: customerName,
                status: 'active',
                state: buyerInfo.state || undefined,
                gstin: buyerInfo.gstin || undefined,
                billing_address: buyerInfo.address || undefined
              });
              customerId = res.data.id || res.data._id;
              customerMap[customerName.toLowerCase()] = customerId;
            }

            const itemsSum = doc.products.reduce((s, p) => s + (Number(p.total) || (Number(p.quantity) * Number(p.rate)) || 0), 0);
            const discount = Number(doc.totals?.discount) || 0;
            const cgst = Number(doc.totals?.cgst) || 0;
            const sgst = Number(doc.totals?.sgst) || 0;
            const igst = Number(doc.totals?.igst) || 0;
            // Prefer the invoice's own printed/extracted grand total when available —
            // line-item totals may already include tax, so re-adding cgst/sgst/igst
            // on top of them would double-count it.
            const total = Number(doc.totals?.grand_total) || Math.max(0, itemsSum - discount);

            const record = {
              invoice_number: invoiceNumber,
              customer_id: customerId,
              customer_name: customerName,
              invoice_date: date,
              subtotal: itemsSum,
              discount,
              cgst,
              sgst,
              igst,
              total,
              status: 'draft',
              items: doc.products.map(p => ({
                description: p.description || 'Imported Item',
                quantity: Number(p.quantity) || 1,
                rate: Number(p.rate) || itemsSum,
                amount: p.total || itemsSum,
                gst_rate: Number(p.gst_rate) || 0
              })),
              ai_confidence: doc.confidence,
              ai_category: 'AI Imported'
            };

            const existingId = invoiceMap[invoiceNumber.toLowerCase()];
            if (existingId) {
              if (updateExisting) {
                await api.put(`/entities/Invoice/${existingId}`, record);
              } else {
                throw new Error(`Invoice number "${invoiceNumber}" already exists.`);
              }
            } else {
              await api.post('/entities/Invoice', record);
            }
            successDocsCount++;

          } else if (docType === "Purchase Invoice" || docType === "Expense Receipt" || docType === "Vendor Bill") {
            const vendorName = String(doc.fields.supplier || doc.fields.business_name || 'Generic Vendor').trim();
            const rawDate = doc.fields.invoice_date || doc.invoice_information?.invoice_date || '';
            const date = normalizeInvoiceDate(rawDate) || new Date().toISOString().split('T')[0];
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

            await api.post('/entities/Expense', record);
            successDocsCount++;

          } else if (docType === "Customer List") {
            let added = 0;
            for (const row of doc.rows) {
              const name = String(row.name || row.Customer_Name || '').trim();
              if (name && !customerMap[name.toLowerCase()]) {
                const res = await api.post('/entities/Customer', {
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
                const res = await api.post('/entities/Supplier', {
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
                const res = await api.post('/entities/Product', {
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
                await api.post('/entities/Payment', {
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
              <CheckCircle2 className="w-6 h-6 text-secondary" /> Universal Import Results
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
              <div className="bg-secondary/10 p-4 rounded-xl text-center border border-secondary/20">
                <p className="text-xs text-secondary font-medium uppercase tracking-wider">Success</p>
                <p className="text-3xl font-extrabold mt-1 text-secondary">{importSummary.successCount}</p>
              </div>
              <div className={`p-4 rounded-xl text-center border ${importSummary.failedCount > 0
                  ? 'bg-destructive/10 border-destructive/20'
                  : 'bg-muted/50 border-border'
                }`}>
                <p className={`text-xs font-medium uppercase tracking-wider ${importSummary.failedCount > 0 ? 'text-destructive' : 'text-muted-foreground'
                  }`}>Failed/Skipped</p>
                <p className={`text-3xl font-extrabold mt-1 ${importSummary.failedCount > 0 ? 'text-destructive' : 'text-foreground'
                  }`}>{importSummary.failedCount}</p>
              </div>
            </div>

            {importSummary.failedCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-destructive" /> Failures / Warnings
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
                          <td className="p-2 text-destructive">{item.error}</td>
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
  if (Array.isArray(extractedDocs) && extractedDocs.length > 0) {
    const safeIndex = Math.min(Math.max(0, selectedDocIndex), extractedDocs.length - 1);
    const rawSelected = extractedDocs[safeIndex] || {};
    const selectedDoc = {
      fileName: rawSelected.fileName || 'Document.pdf',
      documentType: rawSelected.documentType || 'Sales Invoice',
      confidence: rawSelected.confidence !== undefined ? rawSelected.confidence : 0.95,
      status: rawSelected.status || rawSelected.validation_status || "SUCCESS",
      field_validation: rawSelected.field_validation || {},
      fields: rawSelected.fields || {},
      products: rawSelected.products || [],
      rows: rawSelected.rows || [],
      seller_information: rawSelected.seller_information || {},
      buyer_information: rawSelected.buyer_information || {},
      invoice_information: rawSelected.invoice_information || {},
      totals: rawSelected.totals || {},
      line_items: rawSelected.line_items || rawSelected.products || [],
      warnings: rawSelected.warnings || []
    };

    const docType = selectedDoc.documentType || "Sales Invoice";
    const typeInfo = DOCUMENT_TYPES[docType] || DOCUMENT_TYPES["Sales Invoice"] || { dest: "Invoices", collection: "Invoice" };
    const showDestination = !!typeInfo.dest;
    const isImportable = !!typeInfo.collection;
    const confidenceColor = getConfidenceColor(selectedDoc.confidence);

    const valStatus = (selectedDoc.status || "SUCCESS").toUpperCase();
    const statusBadgeClass = valStatus === "SUCCESS"
      ? "bg-secondary/15 text-secondary border-secondary/30"
      : valStatus === "NEEDS_REVIEW"
        ? "bg-accent/15 text-accent border-accent/30"
        : "bg-destructive/15 text-destructive border-destructive/30";

    const docProducts = Array.isArray(selectedDoc.products) ? selectedDoc.products : [];
    const docRows = Array.isArray(selectedDoc.rows) ? selectedDoc.rows : [];
    const docFields = selectedDoc.fields && typeof selectedDoc.fields === 'object' ? selectedDoc.fields : {};

    // Check if nothing meaningful found
    const hasNoData = !selectedDoc.documentType || selectedDoc.documentType === 'Unknown Document' ||
      (docProducts.length === 0 && docRows.length === 0 && Object.keys(docFields).length === 0);

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
                {extractedDocs.map((doc, idx) => {
                  const docStatus = (doc.status || doc.validation_status || "SUCCESS").toUpperCase();
                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedDocIndex(idx)}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${idx === selectedDocIndex
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
                          className="text-muted-foreground hover:text-destructive font-bold text-xs"
                        >
                          ×
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <p className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${doc.documentType === 'Unknown Document' ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-muted text-muted-foreground border-border'
                          }`}>
                          {doc.documentType}
                        </p>
                        <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${docStatus === "SUCCESS" ? "bg-secondary/10 text-secondary border-secondary/20" : docStatus === "NEEDS_REVIEW" ? "bg-accent/10 text-accent border-accent/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
                          {docStatus === "NEEDS_REVIEW" ? "Needs Review" : docStatus}
                        </span>
                      </div>
                    </div>
                  );
                })}
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
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${statusBadgeClass}`}>
                      Status: {valStatus === "NEEDS_REVIEW" ? "Needs Review" : valStatus}
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
                <div className="flex flex-col items-center justify-center p-8 border border-destructive/20 bg-destructive/5 rounded-xl space-y-3">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                  <p className="text-sm font-semibold text-destructive">No valid business data could be detected.</p>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    This file does not appear to contain readable invoices, lists, statements, or recognized receipts. Fake records will not be created.
                  </p>
                </div>
              ) : (
                <>
                  {/* Validation Warnings Callout */}
                  {selectedDoc.warnings && selectedDoc.warnings.length > 0 && (
                    <div className="p-4 border border-accent/20 bg-accent/10 text-accent rounded-xl space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                        <AlertCircle className="w-4 h-4 text-accent" /> Validation Warnings ({selectedDoc.warnings.length})
                      </div>
                      <ul className="list-disc list-inside text-xs space-y-0.5 pl-1">
                        {selectedDoc.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warning if recognized but unsupported */}
                  {!isImportable && selectedDoc.documentType !== "Unknown Document" && (
                    <div className="p-4 border border-primary/20 bg-primary/5 text-primary rounded-xl flex items-start gap-2.5">
                      <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
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
                            className="p-0 h-auto font-bold text-xs text-primary"
                          >
                            Navigate to {typeInfo.dest} &rarr;
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Header / Fields Form with Raw vs Normalized display and Field Validation Badges */}
                  {Object.keys(docFields).length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-foreground">Extracted Header Fields</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(docFields).map(([key, val]) => {
                          const fValKey = key === "customer" ? "customer" : key === "supplier" ? "supplier" : key === "invoice_number" ? "invoice_number" : key === "invoice_date" ? "invoice_date" : key === "due_date" ? "due_date" : key;
                          const fVal = selectedDoc.field_validation?.[fValKey] || {};
                          const fieldStatus = fVal.status || (val ? "SUCCESS" : "NEEDS_REVIEW");
                          const rawVal = fVal.raw ?? (key === "invoice_date" ? docFields.invoice_date_raw : key === "due_date" ? docFields.due_date_raw : null);

                          return (
                            <div key={key} className={`space-y-1 p-2.5 border rounded-lg transition-colors ${fieldStatus === "SUCCESS" ? "bg-muted/10 border-border" : fieldStatus === "NEEDS_REVIEW" ? "bg-accent/10 border-accent/30" : "bg-destructive/10 border-destructive/30"}`}>
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{key.replace(/_/g, ' ')}</label>
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${fieldStatus === "SUCCESS" ? "bg-secondary/10 text-secondary border-secondary/20" : fieldStatus === "NEEDS_REVIEW" ? "bg-accent/10 text-accent border-accent/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
                                  {fieldStatus}
                                </span>
                              </div>
                              <input
                                type="text"
                                value={val || ''}
                                onChange={(e) => handleUpdateField(selectedDocIndex, key, e.target.value)}
                                className="w-full text-xs font-semibold bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-foreground"
                                placeholder={`Enter ${key.replace(/_/g, ' ')}`}
                              />
                              {rawVal && rawVal !== val && (
                                <p className="text-[10px] text-muted-foreground font-mono truncate">Raw: "{rawVal}"</p>
                              )}
                              {fVal.warning && (
                                <p className="text-[10px] text-accent font-semibold">{fVal.warning}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Products Table (for Invoices/Receipts) */}
                  {docProducts.length > 0 && (
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
                                    step="any"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <input
                                    type="number"
                                    value={item.rate || 0}
                                    onChange={(e) => handleUpdateProduct(selectedDocIndex, idx, 'rate', Number(e.target.value))}
                                    className="w-20 bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-right"
                                    step="0.01"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <input
                                    type="number"
                                    value={item.total || (item.quantity * item.rate) || 0}
                                    onChange={(e) => handleUpdateProduct(selectedDocIndex, idx, 'total', Number(e.target.value))}
                                    className="w-20 bg-transparent border-none p-0.5 focus:ring-1 focus:ring-primary rounded text-right"
                                    step="0.01"
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
            <div className="space-y-2">
              <div className={`flex items-center justify-between text-sm p-3 rounded-lg ${statusType === 'error' ? 'bg-destructive/10 text-destructive'
                  : statusType === 'success' ? 'bg-secondary/10 text-secondary'
                    : 'bg-muted text-muted-foreground'
                }`}>
                <div className="flex items-start gap-2 flex-1">
                  {statusType === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    : statusType === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      : <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />}
                  <span>{status}</span>
                </div>
                {statusType === 'error' && isRetryable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetry}
                    disabled={processing}
                    className="ml-3 shrink-0 border-destructive/30 hover:bg-destructive/10"
                  >
                    Retry Extraction
                  </Button>
                )}
              </div>
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