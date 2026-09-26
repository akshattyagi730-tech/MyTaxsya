import { createLimiter, envInt } from "../utils/limiter.js";

// Everything that reads process.env is evaluated lazily (inside functions), because
// server.js loads dotenv *after* its imports run, so module-level reads would miss
// values that only live in the local .env file.

const DEFAULT_MODEL = "gemini-3.6-flash";
// Used when the primary model is unavailable (404), out of quota (429) or failing
// (5xx). Override with GEMINI_FALLBACK_MODELS=a,b (empty string disables fallbacks).
const DEFAULT_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const VALID_THINKING_LEVELS = ["minimal", "low", "medium", "high"];

/** Ordered list of models to try: the configured primary first, then the fallbacks. */
export const getModelChain = () => {
  const primary = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const raw = process.env.GEMINI_FALLBACK_MODELS;
  const fallbacks = raw === undefined
    ? DEFAULT_FALLBACK_MODELS
    : raw.split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
};

// Thinking tokens are billed as output tokens. Invoice extraction is reading, not
// reasoning, so "minimal" keeps accuracy while cutting ~60% of the per-invoice cost.
// GEMINI_THINKING_LEVEL=default leaves the model's own default in place.
const getThinkingLevel = () => {
  const level = (process.env.GEMINI_THINKING_LEVEL ?? "minimal").trim().toLowerCase();
  return VALID_THINKING_LEVELS.includes(level) ? level : null;
};

// IN-MEMORY USAGE METRICS COUNTER
const aiUsageMetrics = {
  total_requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  quota_429_requests: 0,
  deduplicated_hits: 0,
  model_switches: 0,
  prompt_tokens: 0,
  output_tokens: 0,
  thinking_tokens: 0,
  provider: "gemini",
  model: DEFAULT_MODEL,
  last_request_timestamp: null
};

export const getAiUsageMetrics = () => ({ ...aiUsageMetrics, model: getModelChain()[0] });
export const incrementDeduplicatedHits = () => {
  aiUsageMetrics.deduplicated_hits++;
};

// CONCURRENCY CONTROL: how many Gemini requests may be in flight at once. Raise it
// only as far as the project's rate limit allows (AI Studio -> Rate limits).
const DEFAULT_MAX_CONCURRENCY = 6;
const geminiLimiter = createLimiter(() => envInt("GEMINI_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY));

// Setting it to 1 makes every upload read strictly one file at a time; say so once, loudly.
let warnedSerial = false;
const warnIfSerial = () => {
  if (warnedSerial || envInt("GEMINI_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY) !== 1) return;
  warnedSerial = true;
  console.warn("[AI] GEMINI_MAX_CONCURRENCY=1: invoices are read strictly one at a time. Raise it (default is " + DEFAULT_MAX_CONCURRENCY + ") to read several at once.");
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A per-minute rate limit shorter than this is waited out on the same model (its answer
// is better than a backup model's); anything longer moves on to the next model.
const MAX_RATE_LIMIT_WAIT_SEC = 30;
// After a daily/plan quota hit, new requests skip that model for a while instead of asking again.
const DAILY_QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

// model -> epoch ms until which it is rate limited. Shared by every request, so when one
// gets a 429 the others wait instead of piling on more 429s.
const cooldowns = new Map();
const cooldownLeftMs = (model) => Math.max(0, (cooldowns.get(model) || 0) - Date.now());
const startCooldown = (model, ms) => cooldowns.set(model, Math.max(cooldowns.get(model) || 0, Date.now() + ms));
export const resetGeminiCooldowns = () => cooldowns.clear();

// Google's 429 explains itself: which quota was hit and when to try again.
const describeRateLimit = (errBody, retryHeader) => {
  const details = errBody?.error?.details || [];
  const message = errBody?.error?.message || "";
  const quotaIds = details.flatMap((d) => (d.violations || []).map((v) => v.quotaId || "")).join(" ");

  let retryAfterSec = retryHeader ? parseInt(retryHeader, 10) : null;
  if (!retryAfterSec) {
    const retryInfo = details.find((d) => /RetryInfo/.test(d["@type"] || ""));
    const fromInfo = retryInfo?.retryDelay?.match(/([\d.]+)s/);
    const fromMessage = message.match(/retry (?:in|after)\s*([\d.]+)\s*s/i);
    const found = fromInfo?.[1] ?? fromMessage?.[1];
    if (found) retryAfterSec = Math.ceil(parseFloat(found));
  }

  const perMinute = /PerMinute/i.test(quotaIds);
  const perDay = /PerDay/i.test(quotaIds) || /per day|daily/i.test(message);
  // Older/other error shapes carry no quota id: fall back to the wording.
  const looksLikePlanQuota = /generate_content_free_tier_requests|free_tier|daily quota|exceeded your current quota|check your plan|billing/i.test(message + " " + JSON.stringify(details));
  return { retryAfterSec: retryAfterSec || null, daily: perDay || (!perMinute && looksLikePlanQuota) };
};

// ABSTRACT AI PROVIDER BASE CLASS
export class AIProvider {
  async extractStructuredData({ prompt, buffer, mimeType, fileName }) {
    throw new Error("extractStructuredData method must be implemented by subclass.");
  }
}

// CONCRETE GEMINI AI PROVIDER CLASS
export class GeminiProvider extends AIProvider {
  constructor() {
    super();
    this.name = "Gemini";
  }

  get maxRetries() {
    return envInt("GEMINI_MAX_RETRIES", 3);
  }

  get timeoutMs() {
    return envInt("GEMINI_REQUEST_TIMEOUT_MS", 60000);
  }

  get model() {
    return getModelChain()[0];
  }

  async extractStructuredData({ prompt, buffer, mimeType, fileName }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw {
        code: "AI_CONFIG_ERROR",
        provider: "gemini",
        model: this.model,
        retryable: false,
        error_message: "GEMINI_API_KEY is not configured on backend."
      };
    }

    const bufferSize = buffer ? buffer.length : 0;
    console.log(`[AI-DEBUG] Uploaded file: '${fileName || "unknown"}' | Mime: '${mimeType || "unknown"}' | Buffer Size: ${bufferSize} bytes`);

    warnIfSerial();
    // Every call goes to Gemini fresh (no result cache), through the concurrency limiter.
    return geminiLimiter(() => this.executeWithRetry({ prompt, buffer, mimeType, fileName, apiKey }));
  }

  async executeWithRetry({ prompt, buffer, mimeType, fileName, apiKey }) {
    const reqId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();

    aiUsageMetrics.total_requests++;
    aiUsageMetrics.last_request_timestamp = new Date().toISOString();

    const base64Data = buffer ? buffer.toString("base64") : null;
    const parts = [];
    if (base64Data) {
      parts.push({ inlineData: { mimeType: mimeType || "application/pdf", data: base64Data } });
    }
    parts.push({ text: prompt });
    const contents = [{ parts }];

    const chain = getModelChain();
    const maxRetries = this.maxRetries;
    const retryBaseMs = envInt("GEMINI_RETRY_BASE_MS", 1000);
    const maxTotalTries = maxRetries * chain.length + 2; // hard stop, whatever happens

    // Start on the first model that is not sitting in a long rate-limit/quota cooldown.
    let modelIdx = chain.findIndex((m) => cooldownLeftMs(m) <= MAX_RATE_LIMIT_WAIT_SEC * 1000);
    if (modelIdx < 0) modelIdx = 0;
    let attemptsOnModel = 0;
    let useThinkingConfig = getThinkingLevel() !== null;
    let lastError = null;

    console.log(`[AI-DEBUG] Gemini Request Details:`);
    console.log(`  - Request ID: ${reqId}`);
    console.log(`  - Uploaded file: ${fileName || "unknown"}`);
    console.log(`  - MIME Type: ${mimeType || "application/pdf"}`);
    console.log(`  - Base64 Length: ${base64Data ? base64Data.length : 0} characters`);
    console.log(`  - Model chain: ${chain.join(" -> ")}`);

    // Move to the next model in the chain (fresh attempt budget). False when none is left.
    const switchModel = (reason) => {
      if (modelIdx >= chain.length - 1) return false;
      modelIdx++;
      attemptsOnModel = 0;
      aiUsageMetrics.model_switches++;
      console.warn(`[AI-DEBUG] ${reason} Falling back to '${chain[modelIdx]}'...`);
      return true;
    };

    for (let tries = 1; tries <= maxTotalTries; tries++) {
      const activeModel = chain[modelIdx];

      // Another request just got rate limited on this model. A short cooldown is waited out;
      // a long one (e.g. a free-tier minute quota) is not worth waiting for: use the next model.
      const waitMs = cooldownLeftMs(activeModel);
      if (waitMs > MAX_RATE_LIMIT_WAIT_SEC * 1000 && switchModel(`'${activeModel}' is rate limited for another ${Math.ceil(waitMs / 1000)}s.`)) continue;
      if (waitMs > 0) await sleep(waitMs + Math.floor(Math.random() * 400));

      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const generationConfig = { responseMimeType: "application/json" };
        if (useThinkingConfig) {
          generationConfig.thinkingConfig = { thinkingLevel: getThinkingLevel() };
        }

        console.log(`[AI-DEBUG] Sending fetch request to Gemini API (model ${activeModel}, attempt ${attemptsOnModel + 1}/${maxRetries})...`);
        let response;
        try {
          response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, generationConfig }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        console.log(`[AI-DEBUG] Gemini API HTTP Status: ${response.status} ${response.statusText}`);

        // Unauthorized / invalid API key: retrying cannot help.
        if (response.status === 401 || response.status === 403) {
          const errBody = await response.json().catch(() => ({}));
          const errMsg = errBody.error?.message || "Invalid Gemini API key provided.";
          console.error(`[AI-DEBUG] Gemini API ${response.status} Unauthorized:`, errMsg);
          throw {
            code: "AI_UNAUTHORIZED",
            provider: "gemini",
            model: activeModel,
            retryable: false,
            error_message: `Invalid Gemini API key: ${errMsg}`
          };
        }

        // Rate limit or quota exhaustion
        if (response.status === 429) {
          aiUsageMetrics.quota_429_requests++;

          const errBody = await response.json().catch(() => ({}));
          console.error(`[AI-DEBUG] Gemini API 429 Error Response:`, JSON.stringify(errBody));
          const limit = describeRateLimit(errBody, response.headers.get("retry-after"));

          // Daily / plan quota for this model: waiting will not help, another model might.
          if (limit.daily) {
            startCooldown(activeModel, DAILY_QUOTA_COOLDOWN_MS);
            if (switchModel(`Quota exhausted on '${activeModel}'.`)) continue;
            console.error(`[AI-DEBUG] Gemini daily quota exhausted for file '${fileName}' across all models.`);
            throw {
              code: "AI_DAILY_QUOTA_EXHAUSTED",
              provider: "gemini",
              model: activeModel,
              retryable: false,
              retry_after_seconds: null,
              error_message: "AI extraction quota is currently exhausted. Please try again when your Gemini quota resets or configure a higher API quota in .env."
            };
          }

          // Per-minute limit: a short wait is cheaper than failing the file, and the wait is
          // shared (the cooldown), so parallel requests do not each collect their own 429.
          const retryAfterSec = limit.retryAfterSec || 19;
          startCooldown(activeModel, retryAfterSec * 1000);

          if (retryAfterSec <= MAX_RATE_LIMIT_WAIT_SEC && attemptsOnModel + 1 < maxRetries) {
            attemptsOnModel++;
            console.warn(`[AI-DEBUG] Rate limited on '${activeModel}'. Waiting ${retryAfterSec}s before retrying...`);
            continue; // the wait happens at the top of the loop (shared cooldown)
          }
          if (switchModel(`Rate limit on '${activeModel}'.`)) continue;

          console.warn(`[AI-DEBUG] Gemini rate limit hit for file '${fileName}'. Retry-After: ${retryAfterSec}s`);
          throw {
            code: "AI_RATE_LIMITED",
            provider: "gemini",
            model: activeModel,
            retryable: true,
            retry_after_seconds: retryAfterSec,
            error_message: `AI rate limit reached. Please try again after ${retryAfterSec} seconds.`
          };
        }

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const errMsg = errBody.error?.message || `Gemini API HTTP Error ${response.status}`;
          console.error(`[AI-DEBUG] Gemini API Error Body (Status ${response.status}):`, JSON.stringify(errBody));

          // This model rejects the thinking setting (older or lite models): drop it and retry.
          if (response.status === 400 && useThinkingConfig && /thinking/i.test(errMsg)) {
            console.warn(`[AI-DEBUG] '${activeModel}' rejected thinkingConfig; retrying without it.`);
            useThinkingConfig = false;
            continue;
          }

          // Google answers a bad key with HTTP 400 "API key not valid": same as 401, do not retry.
          if (response.status === 400 && /api key/i.test(errMsg)) {
            throw {
              code: "AI_UNAUTHORIZED",
              provider: "gemini",
              model: activeModel,
              retryable: false,
              error_message: `Invalid Gemini API key: ${errMsg}`
            };
          }

          if (response.status === 404 || errMsg.toLowerCase().includes("not found for api version")) {
            if (switchModel(`Model '${activeModel}' is unavailable (HTTP 404).`)) continue;
            throw {
              code: "AI_MODEL_NOT_FOUND",
              provider: "gemini",
              model: activeModel,
              retryable: false,
              error_message: `Gemini model '${activeModel}' was not found (HTTP 404). Please verify your GEMINI_MODEL configuration.`
            };
          }

          const httpError = new Error(errMsg);
          httpError.transient = response.status >= 500 || response.status === 408;
          throw httpError;
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;

        const usage = data.usageMetadata || {};
        console.log(`[AI-DEBUG] Gemini Raw Response Received for file '${fileName}' (model ${activeModel}):`);
        console.log(`  - Candidate count: ${data.candidates ? data.candidates.length : 0}`);
        console.log(`  - Raw Response Length: ${rawText ? rawText.length : 0} characters`);
        console.log(`  - Tokens: prompt=${usage.promptTokenCount ?? "?"} output=${usage.candidatesTokenCount ?? "?"} thinking=${usage.thoughtsTokenCount ?? 0}`);

        if (!rawText) {
          const emptyError = new Error("Gemini API returned an empty text response.");
          emptyError.transient = true;
          throw emptyError;
        }

        let cleanedText = rawText.trim();
        if (cleanedText.startsWith("```")) {
          cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        }
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanedText = jsonMatch[0];
        }

        let parsedJson = null;
        try {
          parsedJson = JSON.parse(cleanedText);
        } catch (parseErr) {
          console.error("[AI-DEBUG] JSON Parse Failure on Gemini Output:", cleanedText.substring(0, 200));
          throw {
            code: "AI_INVALID_JSON",
            provider: "gemini",
            model: activeModel,
            retryable: true,
            transient: true,
            error_message: "AI response contained invalid JSON format."
          };
        }

        aiUsageMetrics.successful_requests++;
        aiUsageMetrics.prompt_tokens += usage.promptTokenCount || 0;
        aiUsageMetrics.output_tokens += usage.candidatesTokenCount || 0;
        aiUsageMetrics.thinking_tokens += usage.thoughtsTokenCount || 0;
        console.log(`[AI-DEBUG] Fresh extraction succeeded for file '${fileName}' in ${Date.now() - startTime}ms!`);

        // Which model actually answered (it can differ from the primary after a fallback).
        // Non-enumerable so it never leaks into the extracted data itself.
        Object.defineProperty(parsedJson, "__model", { value: activeModel, enumerable: false });
        return parsedJson;

      } catch (err) {
        lastError = err;

        // Nothing to retry: the caller has to fix configuration or credentials.
        if (["AI_QUOTA_EXCEEDED", "AI_DAILY_QUOTA_EXHAUSTED", "AI_RATE_LIMITED", "AI_UNAUTHORIZED", "AI_MODEL_NOT_FOUND", "AI_CONFIG_ERROR"].includes(err.code)) {
          aiUsageMetrics.failed_requests++;
          throw err;
        }

        if (err.name === "AbortError") {
          console.error(`[AI-DEBUG] Request Timeout (${this.timeoutMs}ms) for file '${fileName}' | ID: ${reqId}`);
          lastError = { code: "AI_TIMEOUT", transient: true, error_message: "Gemini API request timed out." };
          // A hung model rarely recovers within the same request: move on if we can.
          if (switchModel(`Timeout on '${activeModel}'.`)) continue;
          break;
        }

        // Network failures ("fetch failed") and 5xx answers are transient.
        if (err.transient === undefined && err instanceof Error) err.transient = true;

        console.warn(`[AI-DEBUG] Attempt ${attemptsOnModel + 1} on '${activeModel}' failed for file '${fileName}': ${err.message || err.error_message}`);

        // A request Gemini rejected outright (e.g. HTTP 400 for an unreadable file) will be
        // rejected again: fail now instead of burning the whole retry budget.
        if (err.transient === false) break;

        attemptsOnModel++;

        if (attemptsOnModel < maxRetries) {
          const backoffMs = Math.pow(2, attemptsOnModel) * retryBaseMs + Math.floor(Math.random() * Math.max(1, retryBaseMs / 2));
          await sleep(backoffMs);
        } else if (!switchModel(`'${activeModel}' failed ${attemptsOnModel} times.`)) {
          break;
        }
      }
    }

    aiUsageMetrics.failed_requests++;
    console.error(`[AI-DEBUG] Failed extraction for file '${fileName}' | Request ${reqId} exhausted all attempts.`);

    throw {
      code: lastError?.code || "AI_REQUEST_FAILED",
      provider: "gemini",
      model: chain[modelIdx],
      // 5xx / timeouts / bad JSON are worth another try later; anything else is not.
      retryable: lastError?.transient === true,
      error_message: lastError ? (lastError.error_message || lastError.message) : "AI extraction request failed after retries."
    };
  }
}

// DEFAULT PROVIDER INSTANCE
export const aiProvider = new GeminiProvider();
