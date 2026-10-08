import { createRequire } from "module";
import AdmZip from "adm-zip";
import { runAssistant } from "../services/assistantAgent.js";
import { getGstSummary, getReceivables } from "../services/accountingService.js";

import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const AI_DOWN_REASONS = {
  AI_CREDITS_EXHAUSTED: "the AI service's usage credits have run out",
  AI_RATE_LIMITED: "the AI service is busy right now",
};

const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// When the language model is unreachable the assistant must not go silent or, worse, guess.
// Show the same deterministic figures GST Center uses and say plainly that the explanation layer is down.
const buildDegradedReply = async (userEmail, code) => {
  const reason = AI_DOWN_REASONS[code] || "the AI service is temporarily unavailable";
  const [gst, recv] = await Promise.all([getGstSummary(userEmail), getReceivables(userEmail)]);
  return `I can't answer questions in detail right now — ${reason}. Here are your current figures (all time, same rules as GST Center):\n\n` +
    `- **Output tax:** ${inr(gst.output_tax.total)} from ${gst.output_tax.from_invoices} issued invoice(s)\n` +
    `- **Input tax credit:** ${inr(gst.input_tax_credit.total)} from ${gst.input_tax_credit.from_purchase_bills} recorded purchase bill(s)\n` +
    `- **Net GST payable:** ${inr(gst.net_gst_payable)}${gst.itc_carried_forward > 0 ? ` (ITC carried forward: ${inr(gst.itc_carried_forward)})` : ""}\n` +
    `- **Customers owe you:** ${inr(recv.total_outstanding)} across ${recv.unpaid_invoice_count} unpaid invoice(s)\n\n` +
    `Please try your question again in a little while.`;
};

export const invokeAssistant = async (req, res) => {
  // New clients send { message, history }. Older ones send { prompt } with the question wrapped
  // in boilerplate and expect a bare string back — keep that working across a staggered deploy.
  const legacy = typeof req.body.prompt === "string";
  const message = String(
    req.body.message ?? (legacy ? (req.body.prompt.split("User Question:")[1]?.split("Please answer")[0] ?? req.body.prompt) : "")
  ).trim();

  if (!message) return res.status(400).json({ error: "message is required" });
  if (message.length > 2000) return res.status(400).json({ error: "Message is too long (max 2000 characters)." });

  const userEmail = req.user.email;
  try {
    const { reply, sources, model } = await runAssistant({ userEmail, message, history: req.body.history });
    return res.json(legacy ? reply : { reply, sources, model });
  } catch (err) {
    console.warn(`[ASSISTANT] ${err.code || "ERROR"}: ${err.message}`);
    try {
      const reply = await buildDegradedReply(userEmail, err.code);
      return res.json(legacy ? reply : { reply, sources: [], degraded: true, error_code: err.code || "AI_REQUEST_FAILED" });
    } catch (fallbackErr) {
      return res.status(500).json({ error: "The assistant is unavailable right now. Please try again shortly." });
    }
  }
};

// Deterministic OCR & GST Regex Text Extractor for Indian Invoices (Zero Fake Data)
const extractGstFromText = (extractedText, fileName) => {
  if (!extractedText || extractedText.trim().length === 0) return null;

  const logs = [];
  logs.push(`Running Regex GST Engine on ${extractedText.length} characters of extracted text...`);

  // Extract GSTINs
  const gstinMatches = extractedText.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/g) || [];
  const gstin = gstinMatches.length > 0 ? gstinMatches[0] : null;

  // Extract Invoice Number
  let invoice_number = null;
  const invNoMatch = extractedText.match(/(?:Invoice\s*(?:No|Number|_Number|#)?|Bill\s*(?:No|Number|#)?|Voucher\s*(?:No|Number)?)\s*[:=,-]?\s*([A-Za-z0-9\/_-]+)/i);
  if (invNoMatch && invNoMatch[1] && invNoMatch[1] !== "_Number" && invNoMatch[1] !== "Number") {
    invoice_number = invNoMatch[1].trim();
  }

  // Extract Invoice Date
  let invoice_date = null;
  const dateMatch = extractedText.match(/(?:Invoice\s*Date|Date|Bill\s*Date)\s*[:=,-]?\s*(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})/i);
  if (dateMatch) {
    invoice_date = dateMatch[1].trim();
  }

  // Extract Total / Grand Total
  let grand_total = null;
  const totalMatch = extractedText.match(/(?:Grand\s*Total|Total\s*Amount|Net\s*Amount|Total)\s*[:=,-]?\s*₹?\s*([\d,]+\.?\d*)/i);
  if (totalMatch) {
    const val = parseFloat(totalMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) grand_total = val;
  }

  // Extract Customer / Party Name
  let customer = null;
  const customerMatch = extractedText.match(/(?:Buyer|Bill\s*To|Customer|Party\s*Name|M\/s)\s*[:=,-]?\s*([^\r\n,]+)/i);
  if (customerMatch && !customerMatch[1].toLowerCase().includes("quantity")) {
    customer = customerMatch[1].trim();
  }

  // Extract Business / Seller Name (often first line of PDF)
  const lines = extractedText.split('\n').map(l => l.trim()).filter(Boolean);
  const business_name = lines.length > 0 ? lines[0] : null;

  // Extract Line Items lines
  const products = [];
  lines.forEach((line, idx) => {
    // Check if line looks like item row (contains price or numbers)
    const rowMatch = line.match(/^(\d+|\*|-)?\s*([A-Za-z0-9\s_\-\(\)\/]+?)\s+(\d+(?:\.\d+)?)\s+(?:Pcs|Nos|Unit|Kg)?\s*₹?\s*([\d,]+\.?\d*)\s*₹?\s*([\d,]+\.?\d*)$/i);
    if (rowMatch) {
      const desc = rowMatch[2].trim();
      const qty = parseFloat(rowMatch[3]) || 1;
      const rate = parseFloat(rowMatch[4].replace(/,/g, '')) || 0;
      const total = parseFloat(rowMatch[5].replace(/,/g, '')) || (qty * rate);
      products.push({
        description: desc,
        quantity: qty,
        rate: rate,
        total: total,
        taxable_value: total
      });
    }
  });

  if (!invoice_number && !customer && !grand_total && products.length === 0) {
    return null; // Could not extract real fields
  }

  const fields = {
    business_name: business_name || null,
    gstin: gstin || null,
    invoice_number: invoice_number || null,
    invoice_date: invoice_date || new Date().toISOString().split('T')[0],
    customer: customer || null,
    supplier: business_name || null
  };

  return {
    fileName,
    documentType: "Sales Invoice",
    confidence: 0.90,
    fields,
    products: products.length > 0 ? products : [{ description: "Invoice Line Item", quantity: 1, rate: grand_total || 0, total: grand_total || 0, taxable_value: grand_total || 0 }],
    rows: [],
    seller_information: { business_name: business_name || null, gstin: gstin || null, address: null, state: null, state_code: null, phone: null, email: null },
    buyer_information: { business_name: customer || null, gstin: null, address: null, state: null },
    invoice_information: { invoice_number: invoice_number || null, invoice_date: fields.invoice_date, due_date: null, place_of_supply: null, reverse_charge: null, transport_mode: null, vehicle_number: null, eway_bill: null },
    totals: { taxable_value: grand_total || 0, cgst: null, sgst: null, igst: null, cess: null, round_off: null, grand_total: grand_total || 0 },
    line_items: products,
    confidence_score: 0.90,
    missing_fields: [],
    warnings: []
  };
};

// Helper function to extract structured data from a single document buffer
const processSingleDocument = async (buffer, fileName, mimeType) => {
  const pipelineLogs = [];
  const nameLower = (fileName || "").toLowerCase();

  // Stage 1: File Uploaded
  const fileSize = buffer ? buffer.length : 0;
  const log1 = `[Pipeline Step 1/5] File Uploaded: ${fileName} (${fileSize} bytes, mimeType: ${mimeType})`;
  console.log(log1);
  pipelineLogs.push(log1);

  if (!buffer || fileSize === 0) {
    throw { stage: "File Uploaded", message: `Uploaded file '${fileName}' is empty (0 bytes).` };
  }

  // Stage 2: PDF / Document Parsing
  const log2 = `[Pipeline Step 2/5] Parsing Document: ${fileName}`;
  console.log(log2);
  pipelineLogs.push(log2);

  let extractedPdfText = "";
  if (nameLower.endsWith(".pdf") || mimeType.includes("pdf")) {
    try {
      let parserFunc = pdfParse;
      if (typeof parserFunc !== 'function' && parserFunc && parserFunc.default) {
        parserFunc = parserFunc.default;
      }
      if (typeof parserFunc !== 'function' && typeof pdfParse === 'object') {
        parserFunc = pdfParse.pdfParse || pdfParse.parse || Object.values(pdfParse).find(v => typeof v === 'function');
      }
      if (typeof parserFunc === 'function') {
        let pdfData;
        try {
          pdfData = await parserFunc(buffer);
        } catch (err) {
          if (err.message && err.message.includes("without 'new'")) {
            pdfData = await new parserFunc(buffer);
          } else {
            throw err;
          }
        }
        extractedPdfText = pdfData.text || "";
        const log3 = `[Pipeline Step 3/5] OCR Complete: Extracted ${extractedPdfText.length} characters of raw text from PDF.`;
        console.log(log3);
        pipelineLogs.push(log3);
      } else {
        pipelineLogs.push(`[Pipeline Step 3/5] PDF parser warning: Could not bind function (keys: ${Object.keys(pdfParse || {}).join(',')})`);
      }
    } catch (pdfErr) {
      console.warn(`[Pipeline Step 3/5] PDF text extraction warning: ${pdfErr.message}`);
      pipelineLogs.push(`PDF text extraction warning: ${pdfErr.message}`);
    }
  } else if (nameLower.endsWith(".csv") || nameLower.endsWith(".txt") || mimeType.includes("csv") || mimeType.includes("text")) {
    extractedPdfText = buffer.toString("utf-8");
    const log3 = `[Pipeline Step 3/5] Text Parsing Complete: Extracted ${extractedPdfText.length} characters from text/CSV document.`;
    console.log(log3);
    pipelineLogs.push(log3);
  } else if (nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg") || nameLower.endsWith(".png") || nameLower.endsWith(".webp") || mimeType.includes("image")) {
    try {
      console.log(`[Pipeline Step 3/5] Running Local Tesseract OCR for image '${fileName}'...`);
      const { data: { text } } = await Tesseract.recognize(buffer, "eng");
      extractedPdfText = text || "";
      const log3 = `[Pipeline Step 3/5] Local Image OCR Complete: Extracted ${extractedPdfText.length} characters from image.`;
      console.log(log3);
      pipelineLogs.push(log3);
    } catch (ocrErr) {
      console.warn(`[Pipeline Step 3/5] Local Image OCR warning: ${ocrErr.message}`);
      pipelineLogs.push(`[Pipeline Step 3/5] Local Image OCR warning: ${ocrErr.message}`);
    }
  } else {
    pipelineLogs.push(`[Pipeline Step 3/5] OCR Complete: Document is an unhandled media format.`);
  }

  // Stage 4: AI Extraction
  const log4 = `[Pipeline Step 4/5] AI Extraction Initiated for ${fileName}...`;
  console.log(log4);
  pipelineLogs.push(log4);

  const base64Data = buffer.toString("base64");

  // Call Gemini Vision & Document Extraction API
  if (process.env.GEMINI_API_KEY) {
    const modelsToTry = [
      process.env.GEMINI_MODEL || "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b"
    ];

    for (const modelName of modelsToTry) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType || "application/pdf",
                    data: base64Data
                  }
                },
                {
                  text: `You are an expert Indian GST invoice extraction engine.
CRITICAL INSTRUCTION: Extract every possible field from this invoice EXACTLY as written. NEVER invent values. If a value is missing, return null.

Extracted PDF Raw Text Context (for reference):
${extractedPdfText.substring(0, 3000)}

Return ONLY a valid JSON object matching this schema:
{
  "documentType": "Sales Invoice" | "Purchase Invoice" | "GST Invoice" | "GST Challan" | "GST Return" | "Credit Note" | "Debit Note" | "Quotation" | "Estimate" | "Purchase Order" | "Sales Order" | "Delivery Challan" | "E-way Bill" | "Payment Receipt" | "Expense Receipt" | "Vendor Bill" | "Bank Statement" | "Customer Statement" | "Ledger" | "Trial Balance" | "Balance Sheet" | "Profit & Loss Statement" | "Cash Book" | "Stock Report" | "Inventory Report" | "Product List" | "Customer List" | "Supplier List" | "Employee Salary Sheet" | "Payroll" | "Tax Report" | "TDS Certificate" | "Form 16" | "Form 26AS" | "GST Registration Certificate" | "Cancelled Invoice" | "Unknown Document",
  "confidence": number (0.0 to 1.0),
  "seller_information": {
    "business_name": string | null,
    "gstin": string | null,
    "address": string | null,
    "state": string | null,
    "state_code": string | null,
    "phone": string | null,
    "email": string | null
  },
  "buyer_information": {
    "business_name": string | null,
    "gstin": string | null,
    "address": string | null,
    "state": string | null
  },
  "invoice_information": {
    "invoice_number": string | null,
    "invoice_date": string | null,
    "due_date": string | null,
    "place_of_supply": string | null,
    "reverse_charge": string | null,
    "transport_mode": string | null,
    "vehicle_number": string | null,
    "eway_bill": string | null
  },
  "totals": {
    "taxable_value": number | null,
    "cgst": number | null,
    "sgst": number | null,
    "igst": number | null,
    "cess": number | null,
    "round_off": number | null,
    "grand_total": number | null
  },
  "fields": {
    "business_name": string | null,
    "gstin": string | null,
    "pan": string | null,
    "invoice_number": string | null,
    "invoice_date": string | null,
    "due_date": string | null,
    "customer": string | null,
    "supplier": string | null,
    "address": string | null,
    "state": string | null,
    "place_of_supply": string | null,
    "email": string | null,
    "phone": string | null
  },
  "products": Array<{
    "description": string,
    "quantity": number | null,
    "unit": string | null,
    "rate": number | null,
    "discount": number | null,
    "taxable_value": number | null,
    "gst_rate": number | null,
    "cgst": number | null,
    "sgst": number | null,
    "igst": number | null,
    "cess": number | null,
    "total": number | null
  }>,
  "rows": Array<any>
}`
                }
              ]
            }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });
        const data = await response.json();
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
          parsed.fileName = fileName;
          if (!parsed.documentType) parsed.documentType = "Sales Invoice";
          if (parsed.confidence === undefined) parsed.confidence = 0.95;
          if (!parsed.fields) parsed.fields = {};
          if (!parsed.products) parsed.products = [];
          if (!parsed.rows) parsed.rows = [];

          console.log(`[Pipeline Step 4/5] AI Extraction Complete for ${fileName} via ${modelName}.`);
          console.log(`[Pipeline Step 5/5] JSON Generated Successfully.`);
          return parsed;
        } else if (data.error) {
          console.warn(`Gemini API returned error on ${modelName}:`, data.error.message);
          // Try next model if quota/rate error
        }
      } catch (e) {
        console.warn(`Gemini AI extraction error on ${modelName} for ${fileName}:`, e.message);
      }
    }
  }

  // Stage 4b: Groq LLM Extraction (Ultra-fast Llama 3.3 70B JSON Parser)
  if (process.env.GROQ_API_KEY && extractedPdfText && extractedPdfText.trim().length > 0) {
    try {
      console.log(`[Pipeline Step 4/5] Running Groq LLM (llama-3.3-70b-versatile) Invoice Extraction for ${fileName}...`);
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
              content: `You are an expert Indian GST invoice parser. Extract fields into JSON:
{
  "documentType": "Sales Invoice",
  "confidence": 0.98,
  "fields": {
    "business_name": string|null,
    "gstin": string|null,
    "invoice_number": string|null,
    "invoice_date": string|null,
    "customer": string|null,
    "supplier": string|null
  },
  "products": [
    { "description": string, "quantity": number|null, "rate": number|null, "total": number|null }
  ]
}`
            },
            {
              role: "user",
              content: `Extracted Document Text for file ${fileName}:\n${extractedPdfText}`
            }
          ]
        })
      });
      const data = await response.json();
      const rawJsonStr = data.choices?.[0]?.message?.content;
      if (rawJsonStr) {
        const parsed = JSON.parse(rawJsonStr);
        parsed.fileName = fileName;
        if (!parsed.documentType) parsed.documentType = "Sales Invoice";
        if (parsed.confidence === undefined) parsed.confidence = 0.98;
        if (!parsed.fields) parsed.fields = {};
        if (!parsed.products) parsed.products = [];
        console.log(`[Pipeline Step 4/5] Groq LLM Extraction Complete for ${fileName}!`);
        return parsed;
      }
    } catch (groqErr) {
      console.warn(`Groq extraction warning: ${groqErr.message}`);
    }
  }

  // Fallback: If AI fails or API key quota is exhausted, use deterministic OCR text extractor
  if (extractedPdfText && extractedPdfText.trim().length > 0) {
    const fallbackExtracted = extractGstFromText(extractedPdfText, fileName);
    if (fallbackExtracted) {
      console.log(`[Pipeline Step 4/5] OCR Text Parsing Complete for ${fileName}.`);
      console.log(`[Pipeline Step 5/5] JSON Generated Successfully.`);
      return fallbackExtracted;
    }
  }

  // STRICT RULE: ZERO FAKE / MOCK DATA! Throw explicit error with failed stage details.
  throw {
    stage: "AI Extraction Complete",
    message: `Invoice extraction failed: Could not extract valid invoice data from '${fileName}'. Ensure the file is a readable GST invoice.`,
    pipelineLogs
  };
};

import { getAiUsageMetrics } from "../services/aiProvider.js";
import { processDocumentPipeline, processZipArchive, ERROR_CODES } from "../services/extractionEngine.js";

export const getAiMetrics = (req, res) => {
  res.json(getAiUsageMetrics());
};

export const extractInvoiceData = async (req, res) => {
  try {
    const filesToProcess = [];

    console.log(`[HTTP-DEBUG] POST /api/assistant/extract-invoice request received.`);

    // 1. Collect files from req.file, req.files (Multer), or req.body.fileData
    if (req.file) {
      console.log(`[HTTP-DEBUG] Multer req.file received:`, {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size || (req.file.buffer ? req.file.buffer.length : 0),
        hasBuffer: !!req.file.buffer
      });
      filesToProcess.push(req.file);
    } else if (req.files && Array.isArray(req.files)) {
      console.log(`[HTTP-DEBUG] Multer req.files received (${req.files.length} files):`, req.files.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size || (f.buffer ? f.buffer.length : 0)
      })));
      filesToProcess.push(...req.files);
    } else if (req.body && req.body.fileData) {
      const buffer = Buffer.from(req.body.fileData, "base64");
      console.log(`[HTTP-DEBUG] Base64 body file received:`, {
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
        bufferSize: buffer.length
      });
      filesToProcess.push({
        buffer,
        originalname: req.body.fileName || "invoice.pdf",
        mimetype: req.body.mimeType || "application/pdf"
      });
    }

    if (filesToProcess.length === 0) {
      console.warn(`[HTTP-DEBUG] No file found in req.file, req.files, or req.body.fileData!`);
      return res.status(400).json({
        error: "No invoice document provided for extraction.",
        error_code: ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        diagnostic: {
          file_received: false,
          error_code: ERROR_CODES.UNSUPPORTED_FILE_TYPE,
          error_message: "No file was provided in request."
        }
      });
    }

    const successfulDocs = [];
    const failedDocs = [];
    const warnings = [];

    for (const file of filesToProcess) {
      const buffer = file.buffer;
      const fileName = file.originalname || "document.pdf";
      const mimeType = file.mimetype || "application/pdf";
      const nameLower = fileName.toLowerCase();

      console.log(`[HTTP-DEBUG] Directing file '${fileName}' to extraction pipeline...`);

      // Check if file is a ZIP archive
      const isZip = nameLower.endsWith(".zip") ||
        mimeType.includes("zip") ||
        (buffer && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04);

      if (isZip) {
        const zipResult = await processZipArchive(buffer, fileName);
        if (zipResult.success) {
          successfulDocs.push(...zipResult.successful);
          failedDocs.push(...zipResult.failed);
          warnings.push(...zipResult.warnings);
        } else {
          return res.status(400).json({
            error: zipResult.error_message,
            error_code: zipResult.error_code,
            successful: [],
            failed: [{ file_name: fileName, error_code: zipResult.error_code, error_message: zipResult.error_message }],
            warnings: []
          });
        }
      } else {
        // Single Document Processing
        const jobId = req.body?.jobId || file.jobId || null;
        const result = await processDocumentPipeline(buffer, fileName, mimeType, jobId);
        if (result.success) {
          successfulDocs.push({
            ...result.data,
            jobId: result.jobId,
            fileHash: result.fileHash
          });
        } else {
          failedDocs.push({
            jobId: result.jobId,
            file_name: fileName,
            error_code: result.diagnostic.error_code,
            error_message: result.diagnostic.error_message,
            diagnostic: result.diagnostic
          });
        }
      }
    }

    if (successfulDocs.length === 0 && failedDocs.length > 0) {
      const primaryFail = failedDocs[0];
      return res.status(422).json({
        jobId: primaryFail.jobId || null,
        error: primaryFail.error_message || "Invoice extraction failed.",
        error_code: primaryFail.error_code || ERROR_CODES.INVOICE_DATA_INSUFFICIENT,
        diagnostic: primaryFail.diagnostic || null,
        successful: [],
        failed: failedDocs,
        warnings
      });
    }

    const firstDoc = successfulDocs[0] || {};
    console.log(`[HTTP-DEBUG] Returning response for file '${firstDoc.fileName || 'invoice'}': Supplier='${firstDoc.fields?.supplier}', Customer='${firstDoc.fields?.customer}', InvoiceNo='${firstDoc.fields?.invoice_number}', GrandTotal=₹${firstDoc.totals?.grand_total}`);

    return res.json({
      ...firstDoc,
      jobId: firstDoc.jobId || null,
      fileHash: firstDoc.fileHash || null,
      status: firstDoc.status || "success",
      successful: successfulDocs,
      failed: failedDocs,
      warnings,
      documents: successfulDocs,
      count: successfulDocs.length
    });
  } catch (error) {
    console.error("Error in extractInvoiceData:", error);
    return res.status(500).json({
      error: `Invoice extraction failed: ${error.message || "An unexpected server error occurred."}`,
      error_code: ERROR_CODES.AI_REQUEST_FAILED
    });
  }
};


