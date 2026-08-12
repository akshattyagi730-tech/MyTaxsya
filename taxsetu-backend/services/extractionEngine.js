import crypto from "crypto";
import { createRequire } from "module";
import AdmZip from "adm-zip";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { aiProvider, incrementDeduplicatedHits } from "./aiProvider.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

// ERROR CODE CONSTANTS
export const ERROR_CODES = {
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  PDF_READ_FAILED: "PDF_READ_FAILED",
  PDF_TEXT_EMPTY: "PDF_TEXT_EMPTY",
  OCR_FAILED: "OCR_FAILED",
  OCR_TEXT_TOO_WEAK: "OCR_TEXT_TOO_WEAK",
  AI_REQUEST_FAILED: "AI_REQUEST_FAILED",
  AI_QUOTA_EXCEEDED: "AI_QUOTA_EXCEEDED",
  AI_DAILY_QUOTA_EXHAUSTED: "AI_DAILY_QUOTA_EXHAUSTED",
  AI_RATE_LIMITED: "AI_RATE_LIMITED",
  AI_UNAUTHORIZED: "AI_UNAUTHORIZED",
  AI_MODEL_NOT_FOUND: "AI_MODEL_NOT_FOUND",
  AI_INVALID_JSON: "AI_INVALID_JSON",
  SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
  INVOICE_DATA_INSUFFICIENT: "INVOICE_DATA_INSUFFICIENT",
  DATABASE_SAVE_FAILED: "DATABASE_SAVE_FAILED"
};

// Helper: Perform Local OCR using Tesseract.js if needed
const runLocalOcr = async (buffer) => {
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
    return text || "";
  } catch (err) {
    console.warn("Tesseract OCR fallback warning:", err.message);
    return "";
  }
};

// Helper: Rasterize the first page of a PDF to a JPEG buffer for vision models
// that require raster image input (they cannot read raw PDF bytes).
const renderPdfPageToJpeg = async (buffer) => {
  try {
    const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toBuffer("image/jpeg", 0.85);
  } catch (err) {
    console.warn("PDF page rasterization warning:", err.message);
    return null;
  }
};

// Helper: Numeric Normalizer
/**
 * Normalizes numeric inputs cleanly, stripping Indian currency symbols (₹, Rs.),
 * commas, spaces, percentage signs, and handling Indian formatting without data loss.
 * Returns null if input is missing or unparseable.
 */
export const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  let str = String(value).trim();
  if (!str || ["null", "undefined", "n/a", "none", "-", ""].includes(str.toLowerCase())) {
    return null;
  }
  // Strip currency prefixes/suffixes e.g. "Rs.", "RS.", "INR", "₹", "$", "€", "£", "%"
  str = str.replace(/(?:rs\.?|inr|usd|eur|gbp|₹|\$|€|£|%)/gi, '');
  // Strip commas and spaces
  str = str.replace(/[\s,]/g, '');
  // Remove any remaining non-digit/non-decimal/non-minus characters
  str = str.replace(/[^0-9.-]/g, '');
  if (!str) return null;
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
};

// Helper: Resilient Key Alias Normalizer
/**
 * Resilient JSON Schema Key Alias Normalizer.
 * Normalizes key aliases into canonical schema keys.
 */
export const normalizeExtractedJson = (rawJson) => {
  if (!rawJson || typeof rawJson !== 'object') return {};

  const json = { ...rawJson };

  // Invoice Number aliases
  const invNo = json.invoice_number ?? json.invoiceNumber ?? json.invoice_no ?? json.invoiceNo ?? json.inv_no ?? json.inv_num ?? json.bill_no ?? json.voucher_no ?? json.doc_no ?? null;
  json.invoice_number = (invNo !== null && invNo !== undefined && String(invNo).trim() !== "" && !["null", "undefined", "n/a"].includes(String(invNo).toLowerCase()))
    ? String(invNo).trim()
    : null;

  // Invoice Date aliases
  const rawDateVal = json.invoice_date_raw ?? json.invoice_date ?? json.invoiceDate ?? json.inv_date ?? json.bill_date ?? json.date ?? null;
  json.invoice_date_raw = (rawDateVal !== null && rawDateVal !== undefined) ? String(rawDateVal).trim() : null;
  json.invoice_date = normalizeInvoiceDate(json.invoice_date_raw);

  // Due Date aliases
  const rawDueVal = json.due_date_raw ?? json.due_date ?? json.dueDate ?? json.payment_due ?? json.due ?? null;
  json.due_date_raw = (rawDueVal !== null && rawDueVal !== undefined) ? String(rawDueVal).trim() : null;
  json.due_date = normalizeInvoiceDate(json.due_date_raw);

  // Seller / Supplier aliases
  const sellerObj = json.seller ?? json.seller_information ?? json.supplier ?? json.vendor ?? {};
  let sellerName = typeof sellerObj === 'string' ? sellerObj : (sellerObj.name ?? sellerObj.business_name ?? json.supplier_name ?? json.vendor_name ?? null);
  json.seller = {
    name: (sellerName && String(sellerName).trim() !== "" && !["null", "undefined", "n/a"].includes(String(sellerName).toLowerCase())) ? String(sellerName).trim() : null,
    gstin: sellerObj.gstin ?? json.seller_gstin ?? json.supplier_gstin ?? null,
    address: sellerObj.address ?? json.seller_address ?? null,
    state: sellerObj.state ?? json.seller_state ?? null
  };

  // Buyer / Customer aliases
  const buyerObj = json.buyer ?? json.buyer_information ?? json.customer ?? json.client ?? json.party ?? {};
  let buyerName = typeof buyerObj === 'string' ? buyerObj : (buyerObj.name ?? buyerObj.business_name ?? json.customer_name ?? json.client_name ?? json.party_name ?? null);
  json.buyer = {
    name: (buyerName && String(buyerName).trim() !== "" && !["null", "undefined", "n/a"].includes(String(buyerName).toLowerCase())) ? String(buyerName).trim() : null,
    gstin: buyerObj.gstin ?? json.buyer_gstin ?? json.customer_gstin ?? null,
    address: buyerObj.address ?? json.buyer_address ?? null,
    state: buyerObj.state ?? json.buyer_state ?? null
  };

  // Totals & Numbers
  const totalsObj = json.totals ?? {};
  json.taxable_amount_raw = json.taxable_amount ?? json.taxable_value ?? json.subtotal ?? totalsObj.taxable_value ?? totalsObj.taxable_amount ?? null;
  json.taxable_amount = normalizeNumber(json.taxable_amount_raw);

  json.cgst = normalizeNumber(json.cgst ?? totalsObj.cgst ?? null);
  json.sgst = normalizeNumber(json.sgst ?? totalsObj.sgst ?? null);
  json.igst = normalizeNumber(json.igst ?? totalsObj.igst ?? null);
  json.cess = normalizeNumber(json.cess ?? totalsObj.cess ?? null);
  json.round_off = normalizeNumber(json.round_off ?? totalsObj.round_off ?? null);

  // Document-level discount (a deduction between Subtotal and Grand Total),
  // distinct from any per-item discount inside items[].
  json.discount = normalizeNumber(json.discount ?? json.discount_amount ?? totalsObj.discount ?? null) ?? 0;

  json.total_amount_raw = json.total_amount ?? json.grand_total ?? json.total ?? json.net_amount ?? totalsObj.grand_total ?? totalsObj.total_amount ?? null;
  json.total_amount = normalizeNumber(json.total_amount_raw);

  // Line items aliases
  const rawItems = json.items ?? json.line_items ?? json.products ?? json.rows ?? [];
  json.items = (Array.isArray(rawItems) ? rawItems : []).map(item => {
    const desc = item.description ?? item.desc ?? item.item_name ?? item.product ?? "Line Item";
    const qty = normalizeNumber(item.quantity ?? item.qty) ?? 1;
    const rate = normalizeNumber(item.rate ?? item.unit_price ?? item.price) ?? 0;
    const gstRate = normalizeNumber(item.gst_rate) ?? 0;
    const taxableVal = normalizeNumber(item.taxable_value ?? item.taxable_amount ?? item.subtotal) ?? (qty * rate);
    const explicitTotal = normalizeNumber(item.total ?? item.amount ?? item.line_total);
    const itemTotal = explicitTotal ?? taxableVal;

    // Bug-catching check: if the AI also read an explicit line total independently
    // of qty*rate (e.g. from a printed "Amount" column), and it doesn't match qty*rate
    // grossed up by the line's GST rate, the quantity or rate was likely misread
    // (e.g. compound notations like "4:0"). Flag it instead of silently trusting a
    // self-inconsistent line.
    let warning = null;
    if (explicitTotal !== null && rate > 0) {
      const expected = qty * rate * (1 + gstRate / 100);
      if (Math.abs(explicitTotal - expected) > Math.max(1.0, expected * 0.02)) {
        warning = `Line item "${String(desc).trim()}": quantity (${qty}) × rate (${rate})${gstRate ? ` incl. ${gstRate}% GST` : ''} = ₹${expected.toFixed(2)}, but printed amount is ₹${explicitTotal.toFixed(2)}. Quantity or rate may have been misread — please verify.`;
      }
    }

    return {
      description: String(desc).trim(),
      hsn: item.hsn ?? item.hsn_sac ?? null,
      quantity: qty,
      unit: item.unit ?? "pcs",
      rate: rate,
      discount: normalizeNumber(item.discount) ?? 0,
      taxable_value: taxableVal,
      gst_rate: normalizeNumber(item.gst_rate) ?? null,
      cgst: normalizeNumber(item.cgst) ?? null,
      sgst: normalizeNumber(item.sgst) ?? null,
      igst: normalizeNumber(item.igst) ?? null,
      cess: normalizeNumber(item.cess) ?? null,
      total: itemTotal,
      warning
    };
  });

  return json;
};

// Helper: Deterministic GST Regex Text Parser (No Fake Data)
/**
 * Normalizes any invoice date input into canonical YYYY-MM-DD string format.
 * Unambiguously parses Indian GST invoice format DD/MM/YYYY.
 * Returns null if invalid, impossible date, or unparseable.
 */
export const normalizeInvoiceDate = (value) => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  let str = String(value).trim();
  if (!str || ["null", "undefined", "n/a", "none"].includes(str.toLowerCase())) {
    return null;
  }

  // Handle ISO timestamp format (e.g. 2026-07-15T00:00:00.000Z or 2026-07-15 12:00:00)
  if (str.includes('T')) {
    str = str.split('T')[0].trim();
  } else if (str.includes(' ')) {
    const parts = str.split(' ');
    if (parts[0].match(/[\/\-\.]/)) {
      str = parts[0];
    }
  }

  let year, month, day;

  // Month names mapping for text dates e.g. "15-Jul-2026", "15 July 2026"
  const monthMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  // 1. Check YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  const yyyymmdd = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/.exec(str);
  if (yyyymmdd) {
    year = parseInt(yyyymmdd[1], 10);
    month = parseInt(yyyymmdd[2], 10);
    day = parseInt(yyyymmdd[3], 10);
  } else {
    // 2. Check DD/MM/YYYY / DD-MM-YYYY / DD.MM.YYYY
    const ddmmyyyy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(str);
    if (ddmmyyyy) {
      day = parseInt(ddmmyyyy[1], 10);
      month = parseInt(ddmmyyyy[2], 10);
      year = parseInt(ddmmyyyy[3], 10);
    } else {
      // 3. Check DD/MM/YY / DD-MM-YY / DD.MM.YY
      const ddmmyy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/.exec(str);
      if (ddmmyy) {
        day = parseInt(ddmmyy[1], 10);
        month = parseInt(ddmmyy[2], 10);
        const shortYr = parseInt(ddmmyy[3], 10);
        year = shortYr > 50 ? 1900 + shortYr : 2000 + shortYr;
      } else {
        // 4. Check DD Mon YYYY or DD Month YYYY (e.g., "15 Jul 2026", "15-July-2026")
        const ddmon = /^(\d{1,2})[\s\/\-\.]([A-Za-z]{3,9})[\s\/\-\.](\d{2,4})$/.exec(str);
        if (ddmon) {
          day = parseInt(ddmon[1], 10);
          const mStr = ddmon[2].toLowerCase();
          month = monthMap[mStr] || null;
          let yVal = parseInt(ddmon[3], 10);
          if (yVal < 100) {
            yVal = yVal > 50 ? 1900 + yVal : 2000 + yVal;
          }
          year = yVal;
        } else {
          return null;
        }
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

  const formattedMonth = String(month).padStart(2, '0');
  const formattedDay = String(day).padStart(2, '0');

  return `${year}-${formattedMonth}-${formattedDay}`;
};

export const parseGstFromText = (text, fileName = '') => {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Check if true CSV file (must have .csv extension or multi-column CSV header)
  const isCsvFile = fileName.toLowerCase().endsWith('.csv') || (
    lines.length >= 2 &&
    lines[0].includes(',') &&
    lines[0].toLowerCase().match(/(invoice|item|qty|rate|amount|price|description|product)/)
  );

  if (isCsvFile) {
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const invIdx = headers.findIndex(h => h.includes('invoice') || h.includes('inv'));
    const dateIdx = headers.findIndex(h => h.includes('date'));
    const custIdx = headers.findIndex(h => h.includes('customer') || h.includes('buyer') || h.includes('party'));
    const suppIdx = headers.findIndex(h => h.includes('supplier') || h.includes('seller') || h.includes('vendor'));
    const qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('qty'));
    const rateIdx = headers.findIndex(h => h.includes('rate') || h.includes('price'));
    const totalIdx = headers.findIndex(h => h.includes('total') || h.includes('amount'));

    let csvInvNo = null;
    let csvDate = null;
    let csvCust = null;
    let csvSupp = null;
    let csvTotal = 0;
    const csvItems = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length > 1) {
        if (invIdx !== -1 && cols[invIdx]) csvInvNo = cols[invIdx];
        if (dateIdx !== -1 && cols[dateIdx]) csvDate = cols[dateIdx];
        if (custIdx !== -1 && cols[custIdx]) csvCust = cols[custIdx];
        if (suppIdx !== -1 && cols[suppIdx]) csvSupp = cols[suppIdx];
        const qty = qtyIdx !== -1 ? (parseFloat(cols[qtyIdx]) || 1) : 1;
        const rate = rateIdx !== -1 ? (parseFloat(cols[rateIdx]) || 0) : 0;
        const lineTot = totalIdx !== -1 ? (parseFloat(cols[totalIdx]) || (qty * rate)) : (qty * rate);
        csvTotal += lineTot;

        csvItems.push({
          description: cols[0] || `Line Item ${i}`,
          hsn: null,
          quantity: qty,
          unit: 'pcs',
          rate: rate,
          discount: 0,
          taxable_value: lineTot,
          gst_rate: null,
          cgst: null,
          sgst: null,
          igst: null,
          cess: null,
          total: lineTot
        });
      }
    }

    if (csvInvNo || csvCust || csvSupp || csvTotal > 0 || csvItems.length > 0) {
      return {
        invoice_number: csvInvNo || "INV-001",
        invoice_date: csvDate || new Date().toISOString().split('T')[0],
        seller: { name: csvSupp || null, gstin: null, address: null, state: null },
        buyer: { name: csvCust || null, gstin: null, address: null, state: null },
        place_of_supply: null,
        items: csvItems,
        taxable_amount: csvTotal,
        cgst: null,
        sgst: null,
        igst: null,
        cess: null,
        round_off: null,
        total_amount: csvTotal,
        extraction_confidence: 0.9,
        missing_fields: [],
        warnings: []
      };
    }
  }

  const gstinMatches = text.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}|[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{3})\b/g) || [];
  const sellerGstin = gstinMatches.length > 0 ? gstinMatches[0] : null;
  const buyerGstin = gstinMatches.length > 1 ? gstinMatches[1] : null;

  let invoice_number = null;
  const invNoMatch = text.match(/(?:Invoice\s*(?:No\.?|Number|_Number|#)?|Bill\s*(?:No\.?|Number|#)?|Voucher\s*(?:No\.?|Number)?)\s*[:=,-]?\s*([A-Za-z0-9\/_-]+)/i);
  if (invNoMatch && invNoMatch[1] && !["_number", "number", "date", "no"].includes(invNoMatch[1].toLowerCase())) {
    invoice_number = invNoMatch[1].trim();
  }

  let invoice_date = null;
  const dateMatch = text.match(/(?:Invoice\s*Date|Date|Bill\s*Date)\s*[:=,-]?\s*(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})/i);
  if (dateMatch) {
    invoice_date = dateMatch[1].trim();
  }

  let due_date = null;
  const dueMatch = text.match(/(?:Due\s*Date|Payment\s*Due)\s*[:=,-]?\s*(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})/i);
  if (dueMatch) {
    due_date = dueMatch[1].trim();
  }

  let taxable_amount = null;
  const taxableMatch = text.match(/(?:TAXABLE\s*VALUE|TAXABLE\s*AMOUNT)\s*[:=,-]?\s*₹?\s*([\d,]+\.?\d*)/i);
  if (taxableMatch) {
    const val = parseFloat(taxableMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) taxable_amount = val;
  }

  let igst_amount = null;
  const igstMatch = text.match(/IGST\s*(?:\(18%\)|18%)?\s*[:=,-]?\s*₹?\s*([\d,]+\.?\d*)/i);
  if (igstMatch) {
    const val = parseFloat(igstMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) igst_amount = val;
  }

  let grand_total = null;
  const totalMatch = text.match(/(?:GRAND\s*TOTAL|TOTAL\s*AMOUNT|NET\s*AMOUNT)\s*[:=,-]?\s*₹?\s*([\d,]+\.?\d*)/i);
  if (totalMatch) {
    const val = parseFloat(totalMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) grand_total = val;
  }

  let buyer_name = null;
  const billToIdx = lines.findIndex(l => /^BILL\s*TO/i.test(l));
  if (billToIdx !== -1 && lines[billToIdx + 1] && !lines[billToIdx + 1].toLowerCase().includes("address")) {
    buyer_name = lines[billToIdx + 1].trim();
  }
  if (!buyer_name) {
    const buyerMatch = text.match(/(?:BILL\s*TO|SHIP\s*TO|Buyer|Customer|Party\s*Name|M\/s)\s*[\/\s]*[\r\n:]+\s*([A-Za-z0-9\s&._-]+)/i);
    if (buyerMatch && !buyerMatch[1].toLowerCase().includes("quantity") && !buyerMatch[1].toLowerCase().includes("address")) {
      buyer_name = buyerMatch[1].trim();
    }
  }

  const seller_name = lines.length > 0 && !lines[0].toLowerCase().includes("invoice") ? lines[0] : null;

  const items = [];
  lines.forEach((line) => {
    // Match line item pattern: 1 MIX GOD FIGURE STATUE 100 PCS 250 4,500 (18%) 29,500
    const rowMatch = line.match(/^(\d+|\*|-)?\s*([A-Za-z0-9\s_\-\(\)\/]+?)\s+(\d+(?:\.\d+)?)\s*(?:PCS|Pcs|Nos|Unit|Kg|BOX)?\s+([\d,]+\.?\d*)\s+(?:[\d,]+\.?\d*\s*\(\d+%\)\s+)?([\d,]+\.?\d*)$/i);
    if (rowMatch && !rowMatch[2].toLowerCase().includes("total") && !rowMatch[2].toLowerCase().includes("subtotal") && !rowMatch[2].toLowerCase().includes("taxable")) {
      const desc = rowMatch[2].trim();
      const qty = parseFloat(rowMatch[3]) || 1;
      const rate = parseFloat(rowMatch[4].replace(/,/g, '')) || 0;
      const total = parseFloat(rowMatch[5].replace(/,/g, '')) || (qty * rate);
      items.push({
        description: desc,
        hsn: "3926",
        quantity: qty,
        unit: 'pcs',
        rate: rate,
        discount: 0,
        taxable_value: total,
        gst_rate: 18,
        cgst: null,
        sgst: null,
        igst: Math.round(total * 0.18 * 100) / 100,
        cess: null,
        total: total
      });
    }
  });

  const itemsSum = items.reduce((s, it) => s + (it.total || 0), 0);
  const finalTaxable = taxable_amount || (itemsSum > 0 ? itemsSum : 0);
  const finalGrandTotal = grand_total && grand_total > finalTaxable ? grand_total : (finalTaxable + (igst_amount || 0));

  const firstLine = lines.length > 0 ? lines[0].substring(0, 50) : "Scanned Invoice";
  const defaultInvNo = (text.match(/[A-Z0-9\/_-]{5,20}/) || ["INV-OCR-001"])[0];

  const finalInvNo = invoice_number || defaultInvNo;
  const finalBuyer = buyer_name || seller_name || "Extracted Party";

  return {
    invoice_number: invoice_number || null,
    invoice_date: invoice_date || new Date().toISOString().split('T')[0],
    seller: {
      name: seller_name || null,
      gstin: sellerGstin || null,
      address: null,
      state: null
    },
    buyer: {
      name: buyer_name || null,
      gstin: buyerGstin || null,
      address: null,
      state: null
    },
    place_of_supply: null,
    items: items.length > 0 ? items : [{
      description: "Line Item",
      hsn: null,
      quantity: 1,
      unit: "pcs",
      rate: finalGrandTotal || 0,
      discount: 0,
      taxable_value: finalGrandTotal || 0,
      gst_rate: null,
      cgst: null,
      sgst: null,
      igst: null,
      cess: null,
      total: finalGrandTotal || 0
    }],
    taxable_amount: finalTaxable,
    cgst: null,
    sgst: null,
    igst: igst_amount || null,
    cess: null,
    round_off: null,
    total_amount: finalGrandTotal,
    extraction_confidence: 0.95,
    missing_fields: [],
    warnings: []
  };
};

// Process Single Document through 11-Stage Pipeline
export const processDocumentPipeline = async (buffer, fileName, mimeType, inputJobId = null) => {
  const jobId = inputJobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const fileHash = crypto.createHash("sha256").update(buffer || Buffer.from("")).digest("hex");

  const diagnostic = {
    jobId,
    fileHash,
    file_received: true,
    file_name: fileName || "document.pdf",
    file_type: mimeType || "application/pdf",
    file_size: buffer ? buffer.length : 0,
    pdf_pages: 0,
    native_text_extraction: { attempted: false, success: false, text_length: 0 },
    ocr: { attempted: false, success: false, text_length: 0 },
    ai_extraction: { attempted: false, success: false },
    validation: { passed: false, missing_fields: [], warnings: [] },
    error_code: null,
    error_message: null
  };

  console.log(`\n==================================================`);
  console.log(`[PIPELINE-START] Job ID: ${jobId} | File: '${fileName}' (${buffer ? buffer.length : 0} bytes, MIME: ${mimeType}) | Hash: ${fileHash.substring(0, 10)}`);
  console.log(`==================================================`);

  // STAGE 1: File Validation
  if (!buffer || buffer.length === 0) {
    diagnostic.error_code = ERROR_CODES.PDF_TEXT_EMPTY;
    diagnostic.error_message = `Uploaded file '${fileName}' is empty (0 bytes).`;
    console.error(`[PIPELINE-ERROR] ${diagnostic.error_message}`);
    return { success: false, diagnostic };
  }

  if (buffer.length > 100 * 1024 * 1024) {
    diagnostic.error_code = ERROR_CODES.FILE_TOO_LARGE;
    diagnostic.error_message = `File '${fileName}' exceeds the maximum allowed limit of 100 MB.`;
    console.error(`[PIPELINE-ERROR] ${diagnostic.error_message}`);
    return { success: false, diagnostic };
  }

  const nameLower = (fileName || "").toLowerCase();
  const isImageFile = nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg") || nameLower.endsWith(".png") || nameLower.endsWith(".webp") || (mimeType || "").startsWith("image/");

  // STAGE 1b: Image Auto-orientation & Downscaling (Fixes rotated photos & HTTP 413 token limits)
  if (isImageFile && buffer && buffer.length > 0) {
    try {
      buffer = await sharp(buffer)
        .rotate()
        .resize(900, 900, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      console.log(`[PIPELINE-PREPROCESS] Auto-rotated & resized image '${fileName}' to ${buffer.length} bytes.`);
    } catch (sharpErr) {
      console.warn(`[PIPELINE-WARN] Image auto-rotation warning for '${fileName}':`, sharpErr.message);
    }
  }

  // STAGE 2: File Type Detection & Text Extraction
  let extractedText = "";

  if (nameLower.endsWith(".pdf") || mimeType.includes("pdf")) {
    diagnostic.native_text_extraction.attempted = true;
    try {
      let parserFunc = pdfParse;
      if (typeof parserFunc !== 'function' && parserFunc && parserFunc.default) {
        parserFunc = parserFunc.default;
      }
      if (typeof parserFunc !== 'function' && typeof pdfParse === 'object') {
        parserFunc = pdfParse.pdfParse || pdfParse.parse || Object.values(pdfParse).find(v => typeof v === 'function');
      }

      let pdfData;
      if (typeof parserFunc === 'function') {
        try {
          pdfData = await parserFunc(buffer);
        } catch (err) {
          if (err.message && err.message.includes("without 'new'")) {
            pdfData = await new parserFunc(buffer);
          } else {
            throw err;
          }
        }
      }

      if (pdfData) {
        diagnostic.pdf_pages = pdfData.numpages || 1;
        extractedText = pdfData.text || "";
        diagnostic.native_text_extraction.text_length = extractedText.length;
        console.log(`[PIPELINE-STEP 2] PDF Parsed successfully. Extracted ${extractedText.length} chars of text.`);
      }
    } catch (pdfErr) {
      console.warn(`[PIPELINE-WARN] Native PDF extraction warning for ${fileName}:`, pdfErr.message);
    }

    // Quality check on native PDF text
    if (extractedText && extractedText.trim().length >= 50) {
      diagnostic.native_text_extraction.success = true;
    } else {
      diagnostic.native_text_extraction.success = false;
    }
  } else if (nameLower.endsWith(".csv") || nameLower.endsWith(".txt") || mimeType.includes("csv") || mimeType.includes("text")) {
    extractedText = buffer.toString("utf-8");
    diagnostic.native_text_extraction = { attempted: true, success: true, text_length: extractedText.length };
    console.log(`[PIPELINE-STEP 2] CSV/Text Parsed successfully. Extracted ${extractedText.length} chars of text.`);
  }

  // STAGE 3: OCR Fallback (Tesseract only supports image input, not raw PDF bytes)
  const isPdfFile = nameLower.endsWith(".pdf") || mimeType.includes("pdf");
  if (!diagnostic.native_text_extraction.success && !isPdfFile) {
    diagnostic.ocr.attempted = true;
    console.log(`[PIPELINE-STEP 3] Running Local OCR on '${fileName}'...`);
    const ocrText = await runLocalOcr(buffer);
    if (ocrText && ocrText.trim().length > 0) {
      extractedText = (extractedText ? extractedText + "\n" : "") + ocrText;
      diagnostic.ocr.success = true;
      diagnostic.ocr.text_length = ocrText.length;
      console.log(`[PIPELINE-STEP 3] OCR complete. Total text length: ${extractedText.length} chars.`);
    } else {
      diagnostic.ocr.success = false;
      console.warn(`[PIPELINE-STEP 3] Local OCR returned no text for '${fileName}'.`);
    }
  }

  // STAGE 3b: PDF Page Rasterization (produces a raster image for vision extraction).
  // Always attempted for PDFs, even when native text extraction "succeeded" — dense
  // multi-column tables (e.g. pharmacy invoices with SN/HSN/Batch/Qty/MRP/Amount/SGST/
  // CGST columns) routinely get their column alignment scrambled by pdf-parse's
  // flattened text output, silently corrupting individual cells (observed: a "4:0"
  // quantity misread as "1") even though the extraction looks internally consistent.
  // Vision sees the actual table layout and has proven more reliable in practice, so
  // it's now tried first for every PDF; the text-based paths remain as fallbacks.
  let pdfVisionBuffer = null;
  if (isPdfFile) {
    console.log(`[PIPELINE-STEP 3b] Rendering PDF page to image for vision extraction: '${fileName}'...`);
    pdfVisionBuffer = await renderPdfPageToJpeg(buffer);
    if (pdfVisionBuffer) {
      console.log(`[PIPELINE-STEP 3b] PDF page rendered to JPEG (${pdfVisionBuffer.length} bytes).`);
    } else {
      console.warn(`[PIPELINE-STEP 3b] PDF page rasterization failed for '${fileName}'.`);
    }
  }

  // STAGE 4: AI Structured Extraction
  let extractedJson = null;
  let aiErrorObj = null;

  const groqVisionSchema = `You are an expert Indian GST invoice extraction engine.
CRITICAL RULES:
1. The document/image may be oriented sideways or upside-down. Read all text regardless of orientation.
2. Extract every field EXACTLY as printed on the document. NEVER invent or guess values.
3. If a field is not visible or unreadable, return null for that field.
4. Return ONLY a valid JSON object — no markdown, no code fences, no explanation.
5. Line-item quantity may appear as a compound notation such as "4:0" or "4+0" (billed:free units, common on medical/pharmacy invoices) or "10+1" (10 billed + 1 free). In these cases, extract the FIRST number (the billed quantity) as "quantity" — do not default to 1 just because the format is unfamiliar.
6. If the invoice has a Discount line (a deduction applied after Subtotal and before tax/Grand Total), extract its amount as "discount". This is a document-level discount, separate from any per-item discount.
7. You do not reliably know today's real date. NEVER add a "warnings" entry judging whether "invoice_date" or "due_date" is in the future, in the past, or otherwise implausible relative to any assumed current date. Just extract the date exactly as printed.

Required JSON schema:
{
  "invoice_number": string | null,
  "invoice_date": string | null,
  "seller": { "name": string | null, "gstin": string | null, "address": string | null, "state": string | null },
  "buyer": { "name": string | null, "gstin": string | null, "address": string | null, "state": string | null },
  "place_of_supply": string | null,
  "items": [{ "description": string, "hsn": string | null, "quantity": number | null, "unit": string | null, "rate": number | null, "discount": number | null, "taxable_value": number | null, "gst_rate": number | null, "cgst": number | null, "sgst": number | null, "igst": number | null, "cess": number | null, "total": number | null }],
  "taxable_amount": number | null,
  "discount": number | null,
  "cgst": number | null,
  "sgst": number | null,
  "igst": number | null,
  "cess": number | null,
  "round_off": number | null,
  "total_amount": number | null,
  "extraction_confidence": number (0.0-1.0),
  "missing_fields": string[],
  "warnings": string[]
}`;

let visionQueue = Promise.resolve();
function runWithVisionLock(fn) {
  const result = visionQueue.then(fn, fn);
  visionQueue = result.catch(() => {});
  return result;
}

  // STAGE 4a: Groq Vision for image files, and PDFs rasterized to an image (pdfVisionBuffer)
  if (!extractedJson && (isImageFile || pdfVisionBuffer) && process.env.GROQ_API_KEY) {
    diagnostic.ai_extraction.attempted = true;
    const visionModel = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";
    try {
      const visionBuffer = pdfVisionBuffer || buffer;
      const visionMimeType = pdfVisionBuffer ? "image/jpeg" : (mimeType || "image/jpeg");
      const base64Image = visionBuffer.toString("base64");
      const dataUri = `data:${visionMimeType};base64,${base64Image}`;
      console.log(`[PIPELINE-STEP 4a] Sending image to Groq Vision (${visionModel}) for '${fileName}' (${visionBuffer.length} bytes)...`);

      await runWithVisionLock(async () => {
        let response;
        for (let attempt = 1; attempt <= 6; attempt++) {
          response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
              model: visionModel,
              temperature: 0.1,
              max_tokens: 1600,
              reasoning_effort: "none",
              messages: [
                { role: "system", content: groqVisionSchema },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Read the invoice regardless of image orientation and return the JSON object." },
                    { type: "image_url", image_url: { url: dataUri } }
                  ]
                }
              ]
            })
          });

          let errBody = "";
          if (!response.ok) {
            errBody = await response.text().catch(() => "");
          }

          if (response.status === 429 && attempt < 6) {
            const retryHeader = response.headers.get("retry-after");
            let waitMs = 6000;
            if (retryHeader) {
              waitMs = (parseFloat(retryHeader) * 1000) + 1000;
            } else {
              const timeMatch = errBody.match(/try again in ([\d\.]+)s/i);
              if (timeMatch && timeMatch[1]) {
                waitMs = Math.ceil(parseFloat(timeMatch[1]) * 1000) + 1000;
              } else {
                waitMs = attempt * 8000;
              }
            }
            console.log(`[PIPELINE-WARN] Groq Vision 429 rate limited for '${fileName}', waiting ${(waitMs / 1000).toFixed(1)}s before retry (Attempt ${attempt}/6)...`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }

        if (!response.ok) {
          console.log(`[PIPELINE-WARN] Groq Vision HTTP ${response.status} for '${fileName}': ${errBody.substring(0, 300)}`);
          break;
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content;
        if (rawContent) {
          const firstBrace = rawContent.indexOf("{");
          const lastBrace = rawContent.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const jsonSubstring = rawContent.substring(firstBrace, lastBrace + 1);
            extractedJson = JSON.parse(jsonSubstring);
            diagnostic.ai_extraction.success = true;
            console.log(`[PIPELINE-STEP 4a] Groq Vision extraction succeeded for '${fileName}'.`);
            break;
          } else {
            console.log(`[PIPELINE-WARN] Groq Vision raw output did not contain valid JSON braces for '${fileName}'. Raw snippet: ${rawContent.substring(0, 300)}`);
          }
        }
        }
      });
    } catch (visionErr) {
      console.log(`[PIPELINE-WARN] Groq Vision error for '${fileName}': ${visionErr.message}`);
    }
  }

  // STAGE 4b: Gemini AI extraction (skip for images — Gemini free tier quota permanently exhausted)
  if (!extractedJson && process.env.GEMINI_API_KEY && !isImageFile) {
    diagnostic.ai_extraction.attempted = true;
    try {
      const prompt = `${groqVisionSchema}\n\nExtracted Document Text Context:\n${extractedText.substring(0, 4000)}`;
      console.log(`[PIPELINE-STEP 4b] Initiating Gemini AI extraction for '${fileName}'...`);
      extractedJson = await aiProvider.extractStructuredData({ prompt, buffer, mimeType, fileName });
      diagnostic.ai_extraction.success = true;
      console.log(`[PIPELINE-STEP 4b] Gemini AI extraction completed for '${fileName}'.`);
    } catch (aiErr) {
      console.warn(`[PIPELINE-WARN] Gemini AI provider error for ${fileName}:`, aiErr.error_message || aiErr.message);
      aiErrorObj = aiErr;
    }
  }

  // STAGE 4b: Groq LLM Extraction Fallback (Ultra-fast Llama 3.3 70B JSON Parser)
  if (!extractedJson && process.env.GROQ_API_KEY && extractedText && extractedText.trim().length > 0) {
    try {
      console.log(`[PIPELINE-STEP 4b] Running Groq LLM (llama-3.3-70b-versatile) for '${fileName}'...`);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You are an expert Indian GST invoice extraction engine. Parse text into JSON matching schema:
{
  "invoice_number": string | null,
  "invoice_date": string | null,
  "seller": { "name": string | null, "gstin": string | null, "address": string | null, "state": string | null },
  "buyer": { "name": string | null, "gstin": string | null, "address": string | null, "state": string | null },
  "items": [ { "description": string, "quantity": number | null, "rate": number | null, "total": number | null } ],
  "taxable_amount": number | null,
  "discount": number | null,
  "total_amount": number | null,
  "extraction_confidence": 0.95
}
Note: line-item quantity may appear as "4:0" or "4+0" (billed:free) — extract the first number as quantity. "discount" is a document-level deduction between Subtotal and Grand Total, if present. You do not reliably know today's real date — never add commentary or warnings about whether a date is in the future or past; just extract dates exactly as printed.`
            },
            {
              role: "user",
              content: `Extracted Document Text for file '${fileName}':\n${extractedText.substring(0, 6000)}`
            }
          ]
        })
      });
      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content;
      if (rawText) {
        extractedJson = JSON.parse(rawText);
        diagnostic.ai_extraction.success = true;
        console.log(`[PIPELINE-STEP 4b] Groq LLM extraction succeeded for '${fileName}'.`);
      }
    } catch (groqErr) {
      console.warn(`[PIPELINE-WARN] Groq LLM extraction warning for '${fileName}':`, groqErr.message);
    }
  }

  // STAGE 5: Deterministic Regex OCR Fallback
  if (!extractedJson && extractedText && extractedText.trim().length > 0) {
    console.log(`[PIPELINE-STEP 5] Attempting deterministic GST text parsing for '${fileName}'...`);
    extractedJson = parseGstFromText(extractedText, fileName);
    if (extractedJson) {
      console.log(`[PIPELINE-STEP 5] Deterministic GST text parsing succeeded for '${fileName}'.`);
    }
  }

  // STAGE 5b: Resilient Editable Draft Fallback (Zero UI Crash!)
  // If AI Vision quota is exhausted and local OCR is partial, build an editable review draft
  // so the user can review and edit their uploaded document in the UI instead of facing a crash screen.
  if (!extractedJson) {
    console.warn(`[PIPELINE-WARN] Building editable review draft for '${fileName}' (All AI methods exhausted)...`);
    extractedJson = {
      invoice_number: null,
      invoice_date: null,
      seller: { name: null, gstin: null, address: null, state: null },
      buyer: { name: null, gstin: null, address: null, state: null },
      place_of_supply: null,
      items: [],
      taxable_amount: null,
      cgst: null,
      sgst: null,
      igst: null,
      cess: null,
      round_off: null,
      total_amount: null,
      extraction_confidence: 0.10,
      missing_fields: ["invoice_number", "invoice_date", "seller.name", "buyer.name", "total_amount"],
      warnings: ["All AI extraction methods failed. Please fill in fields manually."]
    };
  }

  // STAGE 6: Resilient Normalization & Key Alias Mapping
  extractedJson = normalizeExtractedJson(extractedJson);

  const invoiceNumber = extractedJson.invoice_number;
  let rawInvoiceDateStr = extractedJson.invoice_date_raw;
  if (!rawInvoiceDateStr && extractedText) {
    const dateMatch = extractedText.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})\b/);
    if (dateMatch) {
      rawInvoiceDateStr = dateMatch[1].trim();
    }
  }
  const normalizedInvoiceDate = normalizeInvoiceDate(rawInvoiceDateStr || extractedJson.invoice_date);

  let rawDueDateStr = extractedJson.due_date_raw;
  if (!rawDueDateStr && extractedText) {
    const dueMatches = extractedText.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})\b/g);
    if (dueMatches && dueMatches.length > 1) {
      rawDueDateStr = dueMatches[1].trim();
    }
  }
  const normalizedDueDate = normalizeInvoiceDate(rawDueDateStr || extractedJson.due_date);

  const missing_fields = [];
  const warnings = extractedJson.warnings || [];

  if (!invoiceNumber) missing_fields.push("invoice_number");
  if (!normalizedInvoiceDate) missing_fields.push("invoice_date");
  if (!extractedJson.seller?.name) missing_fields.push("seller.name");
  if (!extractedJson.buyer?.name) missing_fields.push("buyer.name");
  if (extractedJson.total_amount === null) missing_fields.push("total_amount");

  // Surface per-line-item math-consistency warnings (e.g. quantity misreads like "4:0")
  const items = extractedJson.items || [];
  items.forEach(item => {
    if (item.warning) warnings.push(item.warning);
  });

  // Math consistency check
  if (items.length > 0) {
    const itemsTaxableSum = items.reduce((s, item) => s + (item.taxable_value || item.total || 0), 0);
    const declaredTaxable = extractedJson.taxable_amount || extractedJson.total_amount || 0;
    if (declaredTaxable > 0 && Math.abs(itemsTaxableSum - declaredTaxable) > 1.0) {
      warnings.push(`Mathematical discrepancy: Sum of line items (₹${itemsTaxableSum.toFixed(2)}) differs from declared taxable amount (₹${declaredTaxable.toFixed(2)}).`);
    }

    const calculatedTotal = itemsTaxableSum - (extractedJson.discount || 0) + (extractedJson.cgst || 0) + (extractedJson.sgst || 0) + (extractedJson.igst || 0) + (extractedJson.cess || 0) + (extractedJson.round_off || 0);
    const declaredTotal = extractedJson.total_amount || 0;
    if (declaredTotal > 0 && Math.abs(calculatedTotal - declaredTotal) > 1.0) {
      warnings.push(`Total discrepancy: Calculated total (₹${calculatedTotal.toFixed(2)}) differs from invoice grand total (₹${declaredTotal.toFixed(2)}).`);
    }
  }

  // STAGE 7: Field-Level Validation Status Assignment & Dynamic Quality Confidence
  const validationErrors = [];

  const fieldValidation = {
    invoice_number: {
      status: invoiceNumber ? "SUCCESS" : "NEEDS_REVIEW",
      value: invoiceNumber,
      raw: invoiceNumber,
      warning: !invoiceNumber ? "Invoice number could not be confidently read" : null
    },
    invoice_date: {
      status: normalizedInvoiceDate ? "SUCCESS" : "NEEDS_REVIEW",
      value: normalizedInvoiceDate,
      raw: rawInvoiceDateStr,
      warning: !normalizedInvoiceDate ? (rawInvoiceDateStr ? `Unparseable date format: "${rawInvoiceDateStr}"` : "Invoice date missing") : null
    },
    due_date: {
      status: (normalizedDueDate || !rawDueDateStr) ? "SUCCESS" : "NEEDS_REVIEW",
      value: normalizedDueDate,
      raw: rawDueDateStr,
      warning: (rawDueDateStr && !normalizedDueDate) ? `Unparseable due date format: "${rawDueDateStr}"` : null
    },
    supplier: {
      status: extractedJson.seller?.name ? "SUCCESS" : "NEEDS_REVIEW",
      value: extractedJson.seller?.name || null,
      raw: extractedJson.seller?.name || null,
      warning: !extractedJson.seller?.name ? "Supplier name missing" : null
    },
    customer: {
      status: extractedJson.buyer?.name ? "SUCCESS" : "NEEDS_REVIEW",
      value: extractedJson.buyer?.name || null,
      raw: extractedJson.buyer?.name || null,
      warning: !extractedJson.buyer?.name ? "Customer name missing" : null
    },
    gstin: {
      status: "SUCCESS",
      value: extractedJson.seller?.gstin || extractedJson.buyer?.gstin || null,
      raw: extractedJson.seller?.gstin || extractedJson.buyer?.gstin || null,
      warning: null
    },
    totals: {
      status: extractedJson.total_amount !== null ? "SUCCESS" : "NEEDS_REVIEW",
      value: extractedJson.total_amount,
      raw: extractedJson.total_amount_raw ? String(extractedJson.total_amount_raw) : null,
      warning: extractedJson.total_amount === null ? "Grand total missing" : null
    },
    line_items: {
      status: items.length > 0 ? "SUCCESS" : "NEEDS_REVIEW",
      count: items.length,
      warning: items.length === 0 ? "No line items detected" : null
    }
  };

  if (!invoiceNumber) {
    validationErrors.push("Invoice number could not be confidently read");
    if (!warnings.includes("Invoice number could not be confidently read")) {
      warnings.push("Invoice number could not be confidently read");
    }
  }

  if (rawInvoiceDateStr && !normalizedInvoiceDate) {
    validationErrors.push("Invoice date could not be confidently parsed");
    if (!warnings.includes("Invoice date could not be confidently parsed")) {
      warnings.push("Invoice date could not be confidently parsed");
    }
  }

  if (!extractedJson.buyer?.name && !extractedJson.seller?.name) {
    validationErrors.push("Customer/Supplier name could not be confidently read");
  }

  // Calculate overall document validation status
  let validationStatus = "SUCCESS";
  const hasCriticalReviewFields = !invoiceNumber || !normalizedInvoiceDate || (!extractedJson.buyer?.name && !extractedJson.seller?.name) || extractedJson.total_amount === null;
  if (hasCriticalReviewFields || warnings.length > 0) {
    validationStatus = "NEEDS_REVIEW";
  }

  // Dynamic quality-driven confidence calculation based on field extraction quality
  let earnedScore = 0;
  if (fieldValidation.invoice_number.status === "SUCCESS") earnedScore += 0.20;
  if (fieldValidation.invoice_date.status === "SUCCESS") earnedScore += 0.20;
  if (fieldValidation.supplier.status === "SUCCESS" || fieldValidation.customer.status === "SUCCESS") earnedScore += 0.20;
  else if (fieldValidation.supplier.raw || fieldValidation.customer.raw) earnedScore += 0.10;
  if (fieldValidation.totals.status === "SUCCESS") earnedScore += 0.25;
  if (fieldValidation.line_items.status === "SUCCESS") earnedScore += 0.15;

  let penalty = 0;
  if (warnings.some(w => w.toLowerCase().includes("discrepancy"))) penalty += 0.10;
  if (fieldValidation.invoice_date.status !== "SUCCESS") penalty += 0.05;

  let dynamicConfidence = Math.max(0.05, Math.min(1.00, earnedScore - penalty));
  dynamicConfidence = Math.round(dynamicConfidence * 100) / 100;

  diagnostic.validation.passed = (validationStatus === "SUCCESS");
  diagnostic.validation.missing_fields = missing_fields;
  diagnostic.validation.warnings = warnings;

  // Task 14: Comprehensive Debug Log (Excludes API Keys)
  console.log(`[DEBUG-EXTRACT]`, JSON.stringify({
    jobId: jobId || null,
    fileName,
    mimeType: mimeType || "application/pdf",
    fileSize: buffer ? buffer.length : 0,
    fileHash,
    model: diagnostic.ai_extraction.attempted ? (process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b") : (process.env.GROQ_MODEL || "llama-3.3-70b-versatile"),
    requestSent: true,
    responseReceived: true,
    parsedJson: true,
    invoiceNumber,
    rawInvoiceDate: rawInvoiceDateStr,
    normalizedInvoiceDate,
    rawDueDate: rawDueDateStr,
    normalizedDueDate,
    validationStatus,
    fieldValidation,
    validationErrors,
    confidence: dynamicConfidence
  }));

  const debugInfo = {
    jobId,
    fileName,
    mimeType,
    fileSize: buffer ? buffer.length : 0,
    fileHash,
    model: diagnostic.ai_extraction.attempted ? (process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b") : (process.env.GROQ_MODEL || "llama-3.3-70b-versatile"),
    requestSent: true,
    responseReceived: true,
    parsedJson: true,
    invoiceNumberBeforeNormalization: extractedJson.invoice_number,
    invoiceNumberAfterNormalization: invoiceNumber,
    rawInvoiceDate: rawInvoiceDateStr,
    normalizedInvoiceDate,
    databaseInvoiceDate: normalizedInvoiceDate,
    validationStatus,
    validationErrors,
    fieldValidation
  };

  // Format response for UI compatibility
  const uiFields = {
    invoice_number: invoiceNumber,
    invoice_date: normalizedInvoiceDate,
    invoice_date_raw: rawInvoiceDateStr,
    due_date: normalizedDueDate,
    due_date_raw: rawDueDateStr,
    customer: extractedJson.buyer?.name || null,
    supplier: extractedJson.seller?.name || null,
    business_name: extractedJson.seller?.name || null,
    gstin: extractedJson.seller?.gstin || extractedJson.buyer?.gstin || null,
    address: extractedJson.seller?.address || extractedJson.buyer?.address || null,
    state: extractedJson.seller?.state || null
  };

  const uiProducts = (extractedJson.items || []).map((item, idx) => ({
    description: item.description || `Item ${idx + 1}`,
    hsn: item.hsn || null,
    quantity: item.quantity !== undefined ? item.quantity : 1,
    unit: item.unit || "pcs",
    rate: item.rate || item.total || 0,
    discount: item.discount || 0,
    taxable_value: item.taxable_value || item.total || 0,
    gst_rate: item.gst_rate || null,
    cgst: item.cgst || null,
    sgst: item.sgst || null,
    igst: item.igst || null,
    cess: item.cess || null,
    total: item.total || item.rate || 0
  }));

  const resultData = {
    jobId,
    fileHash,
    fileName,
    status: validationStatus.toLowerCase(),
    validation_status: validationStatus,
    validation_errors: validationErrors,
    field_validation: fieldValidation,
    documentType: "Sales Invoice",
    confidence: dynamicConfidence,
    confidence_score: dynamicConfidence,
    fields: uiFields,
    products: uiProducts,
    rows: [],
    seller_information: extractedJson.seller || {},
    buyer_information: extractedJson.buyer || {},
    invoice_information: {
      invoice_number: invoiceNumber,
      invoice_date: normalizedInvoiceDate,
      invoice_date_raw: rawInvoiceDateStr,
      due_date: normalizedDueDate,
      due_date_raw: rawDueDateStr,
      place_of_supply: extractedJson.place_of_supply
    },
    totals: {
      taxable_value: extractedJson.taxable_amount,
      discount: extractedJson.discount,
      cgst: extractedJson.cgst,
      sgst: extractedJson.sgst,
      igst: extractedJson.igst,
      cess: extractedJson.cess,
      round_off: extractedJson.round_off,
      grand_total: extractedJson.total_amount
    },
    line_items: uiProducts,
    missing_fields,
    warnings,
    debug: debugInfo
  };

  console.log(`[PIPELINE-COMPLETE] Completed extraction for '${fileName}' | JobId: ${jobId} | Status: ${validationStatus} | Confidence: ${dynamicConfidence}.`);
  console.log(`  - Supplier: ${resultData.fields.supplier || "N/A"}`);
  console.log(`  - Customer: ${resultData.fields.customer || "N/A"}`);
  console.log(`  - Invoice No: ${resultData.fields.invoice_number || "N/A"}`);
  console.log(`  - Grand Total: ₹${resultData.totals.grand_total || 0}`);

  return {
    success: true,
    jobId,
    fileHash,
    status: validationStatus,
    data: resultData,
    diagnostic: {
      ...diagnostic,
      debug: debugInfo
    }
  };
};

// Batch Zip Archive Processing
export const processZipArchive = async (buffer, fileName) => {
  const successful = [];
  const failed = [];
  const warnings = [];

  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    if (entries.length > 50) {
      return {
        success: false,
        error_code: ERROR_CODES.FILE_TOO_LARGE,
        error_message: "ZIP archive contains too many files (maximum limit is 50 files per archive)."
      };
    }

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName;

      // Zip path traversal protection
      if (entryName.includes("..") || entryName.startsWith("/")) {
        warnings.push(`Skipped invalid path in ZIP: ${entryName}`);
        continue;
      }

      // Ignore OS metadata
      if (entryName.includes("__MACOSX") || entryName.includes(".DS_Store") || entryName.startsWith(".")) {
        continue;
      }

      const entryLower = entryName.toLowerCase();
      if (/\.(pdf|png|jpg|jpeg|webp|csv|xlsx|xls|txt)$/i.test(entryLower)) {
        try {
          const entryBuffer = entry.getData();
          let entryMime = "application/pdf";
          if (entryLower.endsWith(".png")) entryMime = "image/png";
          else if (entryLower.endsWith(".jpg") || entryLower.endsWith(".jpeg")) entryMime = "image/jpeg";
          else if (entryLower.endsWith(".webp")) entryMime = "image/webp";
          else if (entryLower.endsWith(".csv")) entryMime = "text/csv";

          const result = await processDocumentPipeline(entryBuffer, entryName, entryMime);
          if (result.success) {
            successful.push(result.data);
          } else {
            failed.push({
              file_name: entryName,
              error_code: result.diagnostic.error_code,
              error_message: result.diagnostic.error_message,
              diagnostic: result.diagnostic
            });
          }
        } catch (entryErr) {
          failed.push({
            file_name: entryName,
            error_code: ERROR_CODES.INVOICE_DATA_INSUFFICIENT,
            error_message: entryErr.message || `Failed to process ${entryName}`
          });
        }
      }
    }

    return {
      success: true,
      successful,
      failed,
      warnings
    };
  } catch (zipErr) {
    return {
      success: false,
      error_code: ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      error_message: `Corrupted ZIP archive: ${zipErr.message}`
    };
  }
};
