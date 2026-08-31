import crypto from "crypto";

// IN-MEMORY USAGE METRICS COUNTER
const aiUsageMetrics = {
  total_requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  quota_429_requests: 0,
  deduplicated_hits: 0,
  provider: "gemini",
  model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  last_request_timestamp: null
};

export const getAiUsageMetrics = () => ({ ...aiUsageMetrics });
export const incrementDeduplicatedHits = () => {
  aiUsageMetrics.deduplicated_hits++;
};

// CONCURRENCY CONTROL QUEUE
const maxConcurrency = parseInt(process.env.GEMINI_MAX_CONCURRENCY || "1", 10);
let activeRequestsCount = 0;
const requestQueue = [];

const processQueue = () => {
  if (activeRequestsCount < maxConcurrency && requestQueue.length > 0) {
    const nextTask = requestQueue.shift();
    activeRequestsCount++;
    nextTask();
  }
};

const enqueueTask = (taskFn) => {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const res = await taskFn();
        resolve(res);
      } catch (err) {
        reject(err);
      } finally {
        activeRequestsCount--;
        processQueue();
      }
    });
    processQueue();
  });
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
    this.maxRetries = parseInt(process.env.GEMINI_MAX_RETRIES || "3", 10);
    this.timeoutMs = parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS || "60000", 10);
  }

  get model() {
    return process.env.GEMINI_MODEL || "gemini-3.6-flash";
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

    // Execute Request freshly through Concurrency Queue (Zero Cache Lookup!)
    return enqueueTask(() => this.executeWithRetry({ prompt, buffer, mimeType, fileName, apiKey }));
  }

  async executeWithRetry({ prompt, buffer, mimeType, fileName, apiKey }) {
    const reqId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();
    let lastError = null;
    let activeModel = this.model;

    aiUsageMetrics.total_requests++;
    aiUsageMetrics.last_request_timestamp = new Date().toISOString();

    const base64Data = buffer ? buffer.toString("base64") : null;
    const contents = [];

    const parts = [];
    if (base64Data) {
      parts.push({
        inlineData: {
          mimeType: mimeType || "application/pdf",
          data: base64Data
        }
      });
    }
    parts.push({ text: prompt });
    contents.push({ parts });

    console.log(`[AI-DEBUG] Gemini Request Details:`);
    console.log(`  - Request ID: ${reqId}`);
    console.log(`  - Uploaded file: ${fileName || "unknown"}`);
    console.log(`  - MIME Type: ${mimeType || "application/pdf"}`);
    console.log(`  - Base64 Length: ${base64Data ? base64Data.length : 0} characters`);
    console.log(`  - Model: ${activeModel}`);
    console.log(`  - Prompt Snippet: ${prompt.substring(0, 150)}...`);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        console.log(`[AI-DEBUG] Sending fetch request to Gemini API (Attempt ${attempt}/${this.maxRetries})...`);
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: { responseMimeType: "application/json" }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`[AI-DEBUG] Gemini API HTTP Status: ${response.status} ${response.statusText}`);

        // Check for Unauthorized / Invalid API Key (HTTP 401)
        if (response.status === 401) {
          const errBody = await response.json().catch(() => ({}));
          const errMsg = errBody.error?.message || "Invalid Gemini API key provided.";
          console.error(`[AI-DEBUG] Gemini API 401 Unauthorized:`, errMsg);
          throw {
            code: "AI_UNAUTHORIZED",
            provider: "gemini",
            model: activeModel,
            retryable: false,
            error_message: `Invalid Gemini API key: ${errMsg}`
          };
        }

        // Check for Rate Limit or Quota Exhaustion (HTTP 429)
        if (response.status === 429) {
          aiUsageMetrics.quota_429_requests++;

          const retryHeader = response.headers.get("retry-after");
          let retryAfterSec = retryHeader ? parseInt(retryHeader, 10) : null;

          const errBody = await response.json().catch(() => ({}));
          const errMsg = errBody.error?.message || "";
          const fullErrStr = (errMsg + " " + JSON.stringify(errBody.error?.details || [])).toLowerCase();

          console.error(`[AI-DEBUG] Gemini API 429 Error Response:`, JSON.stringify(errBody));

          // Check if error is Daily / Free-Tier Plan Quota Exhaustion for this model
          const isDailyQuotaExhausted = /generate_content_free_tier_requests|free_tier|daily quota|exceeded your current quota|check your plan|billing/i.test(fullErrStr);

          // Try fallback models before giving up completely
          const fallbackModels = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
          const currentIdx = fallbackModels.indexOf(activeModel);
          if (currentIdx !== -1 && currentIdx < fallbackModels.length - 1) {
            const nextModel = fallbackModels[currentIdx + 1];
            console.warn(`[AI-DEBUG] Quota limit on '${activeModel}'. Automatically falling back to '${nextModel}'...`);
            activeModel = nextModel;
            continue;
          }

          if (isDailyQuotaExhausted) {
            console.error(`[AI-DEBUG] Gemini daily quota exhausted for file '${fileName}' across all fallback models.`);
            throw {
              code: "AI_DAILY_QUOTA_EXHAUSTED",
              provider: "gemini",
              model: activeModel,
              retryable: false,
              retry_after_seconds: null,
              error_message: "AI extraction quota is currently exhausted. Please try again when your Gemini quota resets or configure a higher API quota in .env."
            };
          }

          // Otherwise, error is a temporary per-minute rate limit
          const delayMatch = errMsg.match(/retry after\s*(\d+)s/i);
          if (delayMatch && !retryAfterSec) {
            retryAfterSec = parseInt(delayMatch[1], 10);
          }
          if (!retryAfterSec) retryAfterSec = 19;

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

          if (response.status === 404 || errMsg.toLowerCase().includes("not found for api version")) {
            if (activeModel !== "gemini-2.0-flash") {
              console.warn(`[AI-DEBUG] Model '${activeModel}' unavailable (HTTP 404). Falling back to 'gemini-2.0-flash'...`);
              activeModel = "gemini-2.0-flash";
              continue;
            }
            throw {
              code: "AI_MODEL_NOT_FOUND",
              provider: "gemini",
              model: activeModel,
              retryable: false,
              error_message: `Gemini model '${activeModel}' was not found (HTTP 404). Please verify your GEMINI_MODEL configuration.`
            };
          }
          throw new Error(errMsg);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log(`[AI-DEBUG] Gemini Raw Response Received for file '${fileName}':`);
        console.log(`  - Candidate count: ${data.candidates ? data.candidates.length : 0}`);
        console.log(`  - Raw Response Length: ${rawText ? rawText.length : 0} characters`);
        console.log(`  - Raw Text Snippet: ${(rawText || "").substring(0, 250)}...`);

        if (!rawText) {
          throw new Error("Gemini API returned an empty text response.");
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
            retryable: false,
            error_message: "AI response contained invalid JSON format."
          };
        }
        const duration = Date.now() - startTime;

        console.log(`[AI-DEBUG] Fresh extraction succeeded for file '${fileName}' in ${duration}ms!`);
        console.log(`[AI-DEBUG] Parsed JSON Output:`, JSON.stringify(parsedJson, null, 2));

        aiUsageMetrics.successful_requests++;
        return parsedJson;

      } catch (err) {
        lastError = err;

        if (err.name === "AbortError") {
          console.error(`[AI-DEBUG] Request Timeout (${this.timeoutMs}ms) for file '${fileName}' | ID: ${reqId}`);
          throw {
            code: "AI_TIMEOUT",
            provider: "gemini",
            model: this.model,
            retryable: true,
            error_message: "Gemini API request timed out."
          };
        }

        if (err.code === "AI_QUOTA_EXCEEDED" || err.code === "AI_DAILY_QUOTA_EXHAUSTED" || err.code === "AI_RATE_LIMITED" || err.code === "AI_UNAUTHORIZED" || err.code === "AI_MODEL_NOT_FOUND" || err.code === "AI_CONFIG_ERROR") {
          throw err;
        }

        console.warn(`[AI-DEBUG] Attempt ${attempt} failed for file '${fileName}': ${err.message || err.error_message}`);

        if (attempt < this.maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    aiUsageMetrics.failed_requests++;
    console.error(`[AI-DEBUG] Failed extraction for file '${fileName}' | All ${this.maxRetries} attempts exhausted.`);

    throw {
      code: lastError?.code || "AI_REQUEST_FAILED",
      provider: "gemini",
      model: this.model,
      retryable: false,
      error_message: lastError ? (lastError.error_message || lastError.message) : "AI extraction request failed after retries."
    };
  }
}

// DEFAULT PROVIDER INSTANCE
export const aiProvider = new GeminiProvider();
