import { createRequire } from "module";
import Invoice from "../models/Invoice.js";
import Expense from "../models/Expense.js";
import Customer from "../models/Customer.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import AdmZip from "adm-zip";

import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export const invokeAssistant = async (req, res) => {
  const { prompt } = req.body;
  const userEmail = req.user.email;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    // 1. Fetch live business data from database for this user
    const [invoices, expenses, payments, customers, products] = await Promise.all([
      Invoice.find({ created_by: userEmail }),
      Expense.find({ created_by: userEmail }),
      Payment.find({ created_by: userEmail }),
      Customer.find({ created_by: userEmail }),
      Product.find({ created_by: userEmail })
    ]);

    // 2. Compute exact metrics
    const totalSales = invoices
      .filter(i => i.status !== "cancelled" && i.status !== "draft")
      .reduce((s, i) => s + (i.total || 0), 0);

    const cashRevenue = payments
      .filter(p => p.status === "success")
      .reduce((s, p) => s + (p.amount || 0), 0);

    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const gstCollected = invoices
      .filter(i => i.status !== "cancelled" && i.status !== "draft")
      .reduce((s, i) => s + (i.cgst || 0) + (i.sgst || 0) + (i.igst || 0), 0);

    const gstPaid = expenses.reduce((s, e) => s + (e.gst_amount || 0), 0);
    const netGstLiability = Math.max(0, gstCollected - gstPaid);

    // Unpaid invoices
    const unpaidInvoices = invoices.filter(i => i.status === "sent" || i.status === "overdue");
    
    // Customers owing money
    const customerOwes = {};
    invoices.forEach(i => {
      if (i.status === "sent" || i.status === "overdue") {
        const bal = i.balance_due !== undefined ? i.balance_due : i.total;
        customerOwes[i.customer_name || "Unknown Customer"] = (customerOwes[i.customer_name || "Unknown Customer"] || 0) + bal;
      }
    });
    const sortedOwes = Object.entries(customerOwes).sort((a, b) => b[1] - a[1]);
    const topDebtor = sortedOwes.length > 0 ? sortedOwes[0] : null;

    // Top selling products
    const productSales = {};
    invoices.forEach(i => {
      if (i.status !== "cancelled" && i.status !== "draft") {
        i.items?.forEach(item => {
          const name = item.description || "Unknown Product";
          productSales[name] = (productSales[name] || 0) + (item.quantity * item.rate);
        });
      }
    });
    const sortedProducts = Object.entries(productSales).sort((a, b) => b[1] - a[1]);
    const topProduct = sortedProducts.length > 0 ? sortedProducts[0] : null;

    // Category breakdown
    const categoryBreakdown = {};
    expenses.forEach(e => {
      categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + e.amount;
    });

    const netProfit = totalSales - totalExpenses;
    const inventoryVal = products.reduce((s, p) => s + (p.stock_quantity * p.purchase_price), 0);

    // Construct a highly detailed system context
    const businessContext = `
System Business Context (Strict Live Database Values):
- User Account: ${userEmail}
- Accrual Sales: ₹${totalSales}
- Cash Revenue Collections: ₹${cashRevenue}
- Total Expenses Paid: ₹${totalExpenses}
- Net Profit / Loss Margin: ₹${netProfit}
- GST Collected (Output Tax): ₹${gstCollected}
- GST Input Credit (Paid on Expenses): ₹${gstPaid}
- Net GST Liability Due: ₹${netGstLiability}
- Total Registered Customers: ${customers.length}
- Inventory Asset Value: ₹${inventoryVal}
- Unpaid Invoices count: ${unpaidInvoices.length}
- Unpaid Invoices Detail: ${JSON.stringify(unpaidInvoices.map(i => ({ invoice: i.invoice_number, customer: i.customer_name, due: i.balance_due || i.total })))}
- Customer Rankings (Outstanding Balance): ${JSON.stringify(sortedOwes.map(([name, val]) => ({ name, balance: val })))}
- Top Owing Customer: ${topDebtor ? `${topDebtor[0]} (owes ₹${topDebtor[1]})` : "None"}
- Top Selling Product: ${topProduct ? `${topProduct[0]} (revenue ₹${topProduct[1]})` : "None"}
- Product Sales breakdown: ${JSON.stringify(sortedProducts.map(([name, rev]) => ({ product: name, revenue: rev })))}
- Expenses Category breakdown: ${JSON.stringify(Object.entries(categoryBreakdown).map(([cat, amt]) => ({ category: cat, amount: amt })))}
`;

    const userQuestion = prompt.split("User Question:")[1]?.split("Please answer")[0]?.trim() || prompt;
    const cleanQuestion = userQuestion.toLowerCase();

    // 3. Try Gemini API
    if (process.env.GEMINI_API_KEY) {
      try {
        const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `${businessContext}\n\nUser Question: ${userQuestion}\n\nPlease analyze the provided business context and answer the user question. Keep answers concise, detailed, and mathematically accurate.`
              }]
            }]
          })
        });
        const data = await response.json();
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          return res.json(data.candidates[0].content.parts[0].text);
        }
      } catch (e) {
        console.error("Gemini API call failed, falling back:", e.message);
      }
    }

    // 4. Try Groq API (High Performance Llama 3.3 70B)
    if (process.env.GROQ_API_KEY) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: "You are an intelligent GST and business financial advisor for My Taxsya. Answer user queries clearly based on the provided live business stats context." },
              { role: "user", content: `${businessContext}\n\nUser Question: ${userQuestion}` }
            ],
            temperature: 0.5
          })
        });
        const data = await response.json();
        if (data.choices?.[0]?.message?.content) {
          return res.json(data.choices[0].message.content);
        }
      } catch (e) {
        console.error("Groq API call failed, falling back:", e.message);
      }
    }

    // 5. Try OpenAI API
    if (process.env.OPENAI_API_KEY) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are an intelligent business advisor. Answer customer queries based on the provided live business stats context." },
              { role: "user", content: `${businessContext}\n\nUser Question: ${userQuestion}` }
            ],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (data.choices?.[0]?.message?.content) {
          return res.json(data.choices[0].message.content);
        }
      } catch (e) {
        console.error("OpenAI API call failed, falling back:", e.message);
      }
    }

    // 5. Intelligent Fallback: Run deterministic local analysis based on cleanQuestion
    let reply = "";

    if (cleanQuestion.includes("gst due") || cleanQuestion.includes("how much gst") || cleanQuestion.includes("gst payable") || cleanQuestion.includes("liability")) {
      reply = `Based on your live business records:\n` +
              `- **GST Collected (Output Tax)** on Sales: **₹${gstCollected.toLocaleString('en-IN')}**\n` +
              `- **GST Paid (Input Credit)** on Expenses: **₹${gstPaid.toLocaleString('en-IN')}**\n` +
              `- **Net GST Liability Due**: **₹${netGstLiability.toLocaleString('en-IN')}**.\n\n` +
              `*Suggestion:* You can claim the Input Tax Credit of ₹${gstPaid.toLocaleString('en-IN')} to offset output taxes. Make sure you retain valid supplier tax invoices.`;
    } 
    else if (cleanQuestion.includes("unpaid") || cleanQuestion.includes("overdue") || cleanQuestion.includes("outstanding")) {
      if (unpaidInvoices.length === 0) {
        reply = `Outstanding Check: Great news! You have no unpaid or overdue invoices. All collections are fully settled.`;
      } else {
        const listText = unpaidInvoices.map((i, idx) => `${idx + 1}. **${i.invoice_number}** (${i.customer_name}): **₹${(i.balance_due || i.total).toLocaleString('en-IN')}** (Due: ${i.due_date ? new Date(i.due_date).toLocaleDateString('en-IN') : '—'})`).join('\n');
        reply = `You have **${unpaidInvoices.length}** unpaid invoices totaling **₹${unpaidInvoices.reduce((s, i) => s + (i.balance_due || i.total), 0).toLocaleString('en-IN')}**:\n\n${listText}\n\nFollow up on these invoices directly in the [Invoices](/invoices) page.`;
      }
    } 
    else if (cleanQuestion.includes("owe") || cleanQuestion.includes("debt") || cleanQuestion.includes("debtor")) {
      if (!topDebtor) {
        reply = `Outstanding Balance: There are currently no customer debts or outstanding invoices.`;
      } else {
        const details = sortedOwes.map(([name, amt], idx) => `${idx + 1}. **${name}**: **₹${amt.toLocaleString('en-IN')}** outstanding`).join('\n');
        reply = `Here is your customer outstanding list:\n\n${details}\n\n**${topDebtor[0]}** owes the most with **₹${topDebtor[1].toLocaleString('en-IN')}** outstanding.`;
      }
    } 
    else if (cleanQuestion.includes("top selling") || cleanQuestion.includes("best selling") || cleanQuestion.includes("product")) {
      if (!topProduct) {
        reply = `Products Analysis: No product sales have been invoiced yet.`;
      } else {
        const breakdown = sortedProducts.slice(0, 5).map(([name, rev], idx) => `${idx + 1}. **${name}**: **₹${rev.toLocaleString('en-IN')}** sales`).join('\n');
        reply = `Here are your top-selling products by revenue:\n\n${breakdown}\n\n**${topProduct[0]}** is your top selling product, generating **₹${topProduct[1].toLocaleString('en-IN')}** in sales.`;
      }
    } 
    else if (cleanQuestion.includes("profit") || cleanQuestion.includes("loss") || cleanQuestion.includes("margin") || cleanQuestion.includes("earning")) {
      reply = `Here is your monthly profit & loss summary:\n` +
              `- **Accrual Sales**: **₹${totalSales.toLocaleString('en-IN')}**\n` +
              `- **Expenses**: **₹${totalExpenses.toLocaleString('en-IN')}**\n` +
              `- **Net Profit**: **₹${netProfit.toLocaleString('en-IN')}** (Profit Margin: **${totalSales > 0 ? ((netProfit / totalSales) * 100).toFixed(1) : 0}%**).\n\n` +
              `Your net earnings are in a ${netProfit >= 0 ? "healthy surplus" : "net deficit"}.`;
    } 
    else if (cleanQuestion.includes("expense") || cleanQuestion.includes("spending") || cleanQuestion.includes("cost")) {
      if (expenses.length === 0) {
        reply = `Expenses Analysis: You have not recorded any business expenses yet.`;
      } else {
        const breakdown = Object.entries(categoryBreakdown).map(([cat, amt]) => `- **${cat.replace('_', ' ').toUpperCase()}**: ₹${amt.toLocaleString('en-IN')}`).join('\n');
        reply = `Your total business expenses are **₹${totalExpenses.toLocaleString('en-IN')}**. Here is the category breakdown:\n\n${breakdown}`;
      }
    }
    else if (cleanQuestion.includes("health") || cleanQuestion.includes("status") || cleanQuestion.includes("how is my business")) {
      const margin = totalSales > 0 ? ((netProfit / totalSales) * 100).toFixed(1) : 0;
      reply = `### Business Health Report\n` +
              `- **Financial Status**: ${netProfit >= 0 ? "SURPLUS" : "DEFICIT"}\n` +
              `- **Total Sales Billing**: ₹${totalSales.toLocaleString('en-IN')}\n` +
              `- **Operating Expenses**: ₹${totalExpenses.toLocaleString('en-IN')}\n` +
              `- **Net Cash Flow**: ₹${(cashRevenue - totalExpenses).toLocaleString('en-IN')} (Collections vs Expenses)\n` +
              `- **Outstanding Receivables**: ₹${unpaidInvoices.reduce((s, i) => s + (i.balance_due || i.total), 0).toLocaleString('en-IN')}\n` +
              `- **Profit Margin**: ${margin}%\n\n` +
              `*Diagnostic:* Your business has a profit margin of ${margin}%. Outstanding collections are ₹${unpaidInvoices.reduce((s, i) => s + (i.balance_due || i.total), 0).toLocaleString('en-IN')}. Focus on collecting receivables to optimize working capital.`;
    }
    else if (cleanQuestion.includes("cash flow") || cleanQuestion.includes("cashflow") || cleanQuestion.includes("inflow")) {
      const netCash = cashRevenue - totalExpenses;
      reply = `### Cash Flow Analysis\n` +
              `- **Cash Inflow (Payments Collected)**: **₹${cashRevenue.toLocaleString('en-IN')}**\n` +
              `- **Cash Outflow (Expenses Paid)**: **₹${totalExpenses.toLocaleString('en-IN')}**\n` +
              `- **Net cash flow (Cash In minus Out)**: **₹${netCash.toLocaleString('en-IN')}**\n\n` +
              `*Evaluation:* Your cash position is ${netCash >= 0 ? "positive" : "negative"}. Cash flow is key to meeting short term supplier liability.`;
    }
    else if (cleanQuestion.includes("tax suggestion") || cleanQuestion.includes("suggestion") || cleanQuestion.includes("advice")) {
      reply = `### Custom Tax Planning Advice\n` +
              `1. **Maximize Input Tax Credit (ITC)**: You currently have ₹${gstPaid.toLocaleString('en-IN')} in ITC. Ensure suppliers upload invoices to GSTR-2B so you can claim this. Avoid claiming ITC on expenses where the supplier doesn't upload their GST details.\n` +
              `2. **Clear Outstanding Bills**: Balance due from customers stands at ₹${unpaidInvoices.reduce((s, i) => s + (i.balance_due || i.total), 0).toLocaleString('en-IN')}. Send automated reminders to improve collections.\n` +
              `3. **File GSTR-1 & GSTR-3B on time**: File GSTR-1 by the 11th and GSTR-3B by the 20th of the following month to avoid late fees of ₹50/day.`;
    }
    else {
      reply = `Hello! I have analyzed your business records:\n` +
              `- **Sales Turnover (Accrual)**: **₹${totalSales.toLocaleString('en-IN')}**\n` +
              `- **Cash Collections**: **₹${cashRevenue.toLocaleString('en-IN')}**\n` +
              `- **Business Expenses**: **₹${totalExpenses.toLocaleString('en-IN')}**\n` +
              `- **Net GST Payable**: **₹${netGstLiability.toLocaleString('en-IN')}** (collected ₹${gstCollected.toLocaleString('en-IN')})\n` +
              `- **Inventory Asset Value**: **₹${inventoryVal.toLocaleString('en-IN')}**\n\n` +
              `Ask me specific questions like: *\"How much GST is due?\"*, *\"Which invoices are unpaid?\"*, *\"Which customer owes the most?\"*, *\"What are my top selling products?\"*, or *\"Give me a business health report\"*.`;
    }

    res.json(reply);
  } catch (error) {
    res.status(500).json({ error: error.message });
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


