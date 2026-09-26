import * as accounting from "./accountingService.js";

// A tool-using assistant: the model never sees a raw dump of the books and
// never does the arithmetic. It asks these deterministic tools for figures
// (see accountingService.js) and then explains what came back — so every
// number in an answer traces to a real query, and matches GST Center.

const MAX_TOOL_ROUNDS = 6;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_OUTPUT_TOKENS = 1500;

const periodProps = {
  month: { type: "string", description: "Calendar month as YYYY-MM, e.g. 2026-08. Use for 'this month', 'last month', 'in August'." },
  from: { type: "string", description: "Range start, YYYY-MM-DD (inclusive). Use for financial years / quarters." },
  to: { type: "string", description: "Range end, YYYY-MM-DD (inclusive)." },
};

const TOOL_DECLARATIONS = [
  {
    name: "get_gst_summary",
    description: "GST position: output tax (CGST/SGST/IGST) from issued invoices, input tax credit from recorded ITC-eligible purchase bills, net GST payable or ITC carried forward, plus every excluded invoice/bill and why. The authoritative source for any GST liability / ITC question. Omit the period for all-time.",
    parameters: { type: "object", properties: { ...periodProps } },
  },
  {
    name: "get_sales_summary",
    description: "Sales for a period: issued invoice count, taxable value, discount, tax charged, total billed, invoice counts by status, top customers and top products.",
    parameters: { type: "object", properties: { ...periodProps } },
  },
  {
    name: "get_purchase_summary",
    description: "Purchases for a period from recorded purchase bills: taxable value, tax paid, ITC-eligible vs blocked tax, top suppliers, and how many draft bills are not yet counted.",
    parameters: { type: "object", properties: { ...periodProps } },
  },
  {
    name: "get_receivables",
    description: "Money customers still owe: total outstanding, overdue amount, per-customer ranking and the unpaid invoices.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_expense_summary",
    description: "Operating expenses for a period by category and approval status. (GST on supplier purchases lives in purchase bills, not here.)",
    parameters: { type: "object", properties: { ...periodProps } },
  },
  {
    name: "find_invoices",
    description: "Look up specific sales invoices by customer name, invoice number, status, minimum amount and/or period. Returns line items and tax split.",
    parameters: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer name (partial match)." },
        invoice_number: { type: "string", description: "Invoice number (partial match)." },
        status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "cancelled"] },
        min_amount: { type: "number", description: "Only invoices with total >= this." },
        limit: { type: "number", description: "Max rows (default 20, max 50)." },
        ...periodProps,
      },
    },
  },
  {
    name: "find_purchase_bills",
    description: "Look up specific purchase bills by supplier, bill number, status, ITC eligibility and/or period.",
    parameters: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Supplier name (partial match)." },
        bill_number: { type: "string" },
        status: { type: "string", enum: ["draft", "recorded"] },
        itc_eligible: { type: "boolean" },
        limit: { type: "number" },
        ...periodProps,
      },
    },
  },
  {
    name: "get_business_profile",
    description: "The user's own business: name, GSTIN, state, whether GST is enabled.",
    parameters: { type: "object", properties: {} },
  },
];

const TOOL_IMPLS = {
  get_gst_summary: accounting.getGstSummary,
  get_sales_summary: accounting.getSalesSummary,
  get_purchase_summary: accounting.getPurchaseSummary,
  get_receivables: (email) => accounting.getReceivables(email),
  get_expense_summary: accounting.getExpenseSummary,
  find_invoices: accounting.findInvoices,
  find_purchase_bills: accounting.findPurchaseBills,
  get_business_profile: (email) => accounting.getBusinessProfile(email),
};

const buildSystemPrompt = () => {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const fyStartYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `You are the AI accounting assistant inside MyTaxsya, an Indian GST invoicing and compliance app. You help a business owner and their Chartered Accountant understand the business's books.

Today is ${today}. The current Indian financial year runs 1 April ${fyStartYear} to 31 March ${fyStartYear + 1}. Resolve "this month", "last quarter", "this FY" etc. into the month / from / to arguments yourself.

ACCURACY RULES — these matter more than anything else:
1. Every figure you state must come from a tool result in this conversation. Never estimate, recall, or calculate a business figure yourself. If a figure needs adding or subtracting, call a tool that returns it; if none does, say so plainly.
2. Copy numbers exactly as returned. Format money as ₹ with Indian digit grouping (₹1,23,456.50).
3. Always say which period a figure covers ("all time" when no period was given).
4. Name the invoice / bill numbers you relied on when the answer rests on specific documents.
5. If a tool returns no records, say there are none — never fill the gap with plausible data.
6. When drafts or blocked credits were excluded from a figure, mention it — that is usually why a number looks lower than the user expects.

STYLE: Reply in the user's own language (English, Hindi or Hinglish). Be concise and direct. Use plain text with **bold** for key figures and simple "- " bullets only — no headings, no tables, no LaTeX or math notation, no horizontal rules. You explain and advise but you do not file returns or replace a CA — for filing decisions, notices or grey areas, recommend confirming with their CA. You cannot create or edit records yet; if asked, tell them which screen to use.`;
};

const toClaudeHistory = (history = []) => {
  const turns = history
    .filter((m) => m && typeof m.content === "string" && m.content.trim() && (m.role === "user" || m.role === "assistant"))
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));
  while (turns.length && turns[0].role !== "user") turns.shift(); // the UI greeting is not a real turn
  return turns;
};

// Anthropic calls the JSON schema of a tool's arguments `input_schema`.
const CLAUDE_TOOLS = TOOL_DECLARATIONS.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters }));

async function callClaude(body) {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const doFetch = () => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let res = await doFetch();
  // 429 = rate limited, 529 = Anthropic overloaded. Both usually clear within seconds — honour retry-after when it is short.
  for (let attempt = 0; attempt < 2 && (res.status === 429 || res.status === 529); attempt++) {
    const waitSec = parseFloat(res.headers.get("retry-after")) || 2;
    if (waitSec > 20) break;
    await new Promise((r) => setTimeout(r, Math.ceil(waitSec * 1000) + 300));
    res = await doFetch();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 300);
    try { message = JSON.parse(text)?.error?.message || message; } catch { /* keep raw text */ }
    const err = new Error(`Anthropic HTTP ${res.status}: ${message}`);
    err.status = res.status;
    if (res.status === 400 && /credit balance/i.test(message)) err.code = "AI_CREDITS_EXHAUSTED";
    else if (res.status === 401 || res.status === 403) err.code = "AI_UNAUTHORIZED";
    else if (res.status === 404) err.code = "AI_MODEL_NOT_FOUND";
    else if (res.status === 429) err.code = "AI_RATE_LIMITED";
    else err.code = "AI_REQUEST_FAILED";
    throw err;
  }
  return { data: await res.json(), model };
}

async function runTool(name, args, userEmail) {
  const impl = TOOL_IMPLS[name];
  if (!impl) return { error: `Unknown tool "${name}".` };
  try {
    return await impl(userEmail, args || {});
  } catch (err) {
    // Hand the message back so the model can correct its arguments instead of failing the whole turn.
    return { error: err.message };
  }
}

/**
 * @returns {{ reply: string, sources: {tool: string, args: object}[], model: string }}
 */
export async function runAssistant({ userEmail, message, history = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error("ANTHROPIC_API_KEY is not configured.");
    err.code = "AI_UNAVAILABLE";
    throw err;
  }

  const messages = [...toClaudeHistory(history), { role: "user", content: message }];
  const system = buildSystemPrompt();
  const sources = [];
  let usedModel = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { data, model } = await callClaude({ system, messages, tools: CLAUDE_TOOLS });
    usedModel = model;

    const blocks = data.content || [];
    const toolUses = blocks.filter((b) => b.type === "tool_use");

    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      if (!reply) {
        const err = new Error(`Model returned no text (stop reason: ${data.stop_reason || "unknown"}).`);
        err.code = "AI_EMPTY";
        throw err;
      }
      return { reply, sources, model: usedModel };
    }

    // Echo the assistant turn back as-is, then answer every tool call in a single user turn.
    messages.push({ role: "assistant", content: blocks });
    const results = [];
    for (const use of toolUses) {
      const result = await runTool(use.name, use.input, userEmail);
      sources.push({ tool: use.name, args: use.input || {} });
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result), ...(result?.error ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  const err = new Error("Assistant used too many tool rounds without answering.");
  err.code = "AI_LOOP";
  throw err;
}
