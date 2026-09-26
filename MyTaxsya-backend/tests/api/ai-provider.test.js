import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider, getModelChain, getAiUsageMetrics, resetGeminiCooldowns } from "../../services/aiProvider.js";

// The Gemini client with `fetch` stubbed: no network, no API key, no cost. These cover
// what makes bulk extraction survive real-world hiccups: model fallback, retries,
// concurrency and the thinking setting.

const OK_JSON = { invoice_number: "INV-1", total_amount: 100 };
const ok = (json = OK_JSON, usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 0 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }], usageMetadata: usage }), { status: 200 });
const fail = (status, message, extra = {}, headers = {}) =>
  new Response(JSON.stringify({ error: { code: status, message, ...extra } }), { status, headers });

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
let calls;

// Queue up responses (or functions returning one) in the order fetch will be called.
const stubFetch = (...responses) => {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ model: String(url).match(/models\/([^:]+):/)[1], body });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return typeof next === "function" ? next(calls.length) : next.clone();
  };
};

const extract = (provider = new GeminiProvider()) =>
  provider.extractStructuredData({ prompt: "p", buffer: Buffer.from("x"), mimeType: "image/jpeg", fileName: "a.jpg" });

beforeEach(() => {
  resetGeminiCooldowns();
  Object.assign(process.env, {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "primary-model",
    GEMINI_FALLBACK_MODELS: "backup-1,backup-2",
    GEMINI_RETRY_BASE_MS: "1",
    GEMINI_MAX_RETRIES: "3",
    GEMINI_MAX_CONCURRENCY: "4",
  });
  delete process.env.GEMINI_THINKING_LEVEL;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

test("model chain is the primary followed by the fallbacks, without duplicates", () => {
  assert.deepEqual(getModelChain(), ["primary-model", "backup-1", "backup-2"]);
  process.env.GEMINI_FALLBACK_MODELS = "primary-model, backup-1";
  assert.deepEqual(getModelChain(), ["primary-model", "backup-1"]);
  process.env.GEMINI_FALLBACK_MODELS = "";
  assert.deepEqual(getModelChain(), ["primary-model"]);
  delete process.env.GEMINI_FALLBACK_MODELS;
  assert.deepEqual(getModelChain().slice(0, 1), ["primary-model"]);
  assert.ok(getModelChain().length > 1, "sensible default fallbacks");
});

test("asks for minimal thinking by default and reports which model answered", async () => {
  stubFetch(ok());
  const result = await extract();
  assert.deepEqual(result, OK_JSON);
  assert.equal(result.__model, "primary-model");
  assert.equal(Object.keys(result).includes("__model"), false, "the model tag must not leak into the data");
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
});

test("GEMINI_THINKING_LEVEL is honoured, and 'default' leaves thinking alone", async () => {
  process.env.GEMINI_THINKING_LEVEL = "low";
  stubFetch(ok());
  await extract();
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "low");

  process.env.GEMINI_THINKING_LEVEL = "default";
  stubFetch(ok());
  await extract();
  assert.equal("thinkingConfig" in calls[0].body.generationConfig, false);
});

test("a model that rejects the thinking setting is retried without it", async () => {
  stubFetch(fail(400, "Thinking level is not supported for this model."), ok());
  const result = await extract();
  assert.equal(result.__model, "primary-model");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.generationConfig.thinkingConfig);
  assert.equal("thinkingConfig" in calls[1].body.generationConfig, false);
});

test("falls back to the next model when the primary is not found (404)", async () => {
  stubFetch(fail(404, "models/primary-model is not found for API version v1beta"), ok());
  const result = await extract();
  assert.equal(result.__model, "backup-1");
  assert.deepEqual(calls.map((c) => c.model), ["primary-model", "backup-1"]);
});

test("reports AI_MODEL_NOT_FOUND only once every model in the chain is missing", async () => {
  stubFetch(fail(404, "not found for API version"));
  await assert.rejects(extract(), (e) => e.code === "AI_MODEL_NOT_FOUND" && e.retryable === false);
  assert.deepEqual(calls.map((c) => c.model), ["primary-model", "backup-1", "backup-2"]);
});

test("switches model when the free/daily quota is exhausted, then gives up with a non-retryable error", async () => {
  const quota = () => fail(429, "You exceeded your current quota, please check your plan and billing details.");
  stubFetch(quota(), ok());
  assert.equal((await extract()).__model, "backup-1");

  resetGeminiCooldowns(); // the first part put the primary in a cooldown; start the chain from the top again
  stubFetch(quota());
  await assert.rejects(extract(), (e) => e.code === "AI_DAILY_QUOTA_EXHAUSTED" && e.retryable === false);
  assert.equal(calls.length, 3, "one attempt per model");
});

test("waits out a short per-minute rate limit on the same model", async () => {
  stubFetch(fail(429, "Resource has been exhausted (e.g. check quota).", {}, { "retry-after": "1" }), ok());
  const started = Date.now();
  const result = await extract();
  assert.equal(result.__model, "primary-model");
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started >= 900, "honoured retry-after");
});

test("a long rate limit moves on to the next model instead of blocking", async () => {
  stubFetch(fail(429, "Rate limited", {}, { "retry-after": "40" }), ok());
  const result = await extract();
  assert.equal(result.__model, "backup-1");
});

test("a rate limit with no fallback left is reported as retryable with the wait time", async () => {
  process.env.GEMINI_FALLBACK_MODELS = "";
  stubFetch(fail(429, "Rate limited", {}, { "retry-after": "40" }));
  await assert.rejects(extract(), (e) => e.code === "AI_RATE_LIMITED" && e.retryable === true && e.retry_after_seconds === 40);
});

test("transient 503s are retried on the same model", async () => {
  stubFetch(fail(503, "This model is currently experiencing high demand."), fail(503, "high demand"), ok());
  const result = await extract();
  assert.equal(result.__model, "primary-model");
  assert.equal(calls.length, 3);
});

test("a model that keeps failing hands over to the next one; total failure is marked retryable", async () => {
  stubFetch(fail(503, "unavailable"), fail(503, "unavailable"), fail(503, "unavailable"), ok());
  assert.equal((await extract()).__model, "backup-1");

  stubFetch(fail(503, "unavailable"));
  await assert.rejects(extract(), (e) => e.retryable === true && /unavailable/i.test(e.error_message));
  assert.ok(calls.length <= 3 * 3 + 2, "bounded number of attempts");
});

test("invalid JSON from the model is retried", async () => {
  const badJson = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{not json" }] } }] }), { status: 200 });
  stubFetch(badJson, ok());
  assert.deepEqual(await extract(), OK_JSON);
});

test("authorisation problems fail immediately without retries", async () => {
  stubFetch(fail(401, "API key invalid"));
  await assert.rejects(extract(), (e) => e.code === "AI_UNAUTHORIZED" && e.retryable === false);
  assert.equal(calls.length, 1);

  stubFetch(fail(400, "API key not valid. Please pass a valid API key."));
  await assert.rejects(extract(), (e) => e.code === "AI_UNAUTHORIZED");
  assert.equal(calls.length, 1);
});

test("a request Gemini rejects outright (400) is not retried", async () => {
  stubFetch(fail(400, "Unable to process input image."));
  await assert.rejects(extract(), (e) => e.retryable === false && /Unable to process/.test(e.error_message));
  assert.equal(calls.length, 1);
});

test("missing API key is a configuration error", async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(extract(), (e) => e.code === "AI_CONFIG_ERROR" && e.retryable === false);
});

test("respects GEMINI_MAX_CONCURRENCY", async () => {
  process.env.GEMINI_MAX_CONCURRENCY = "3";
  let inFlight = 0;
  let peak = 0;
  stubFetch(async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 25));
    inFlight--;
    return ok();
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => extract()));
  assert.equal(results.length, 10);
  assert.equal(peak, 3);
});

test("token usage (including thinking tokens) is added to the metrics", async () => {
  const before = getAiUsageMetrics();
  stubFetch(ok(OK_JSON, { promptTokenCount: 2000, candidatesTokenCount: 600, thoughtsTokenCount: 1500 }));
  await extract();
  const after = getAiUsageMetrics();
  assert.equal(after.prompt_tokens - before.prompt_tokens, 2000);
  assert.equal(after.output_tokens - before.output_tokens, 600);
  assert.equal(after.thinking_tokens - before.thinking_tokens, 1500);
  assert.equal(after.successful_requests - before.successful_requests, 1);
});

// --- Free-tier style 429s: Google says which quota was hit and when to retry ---------------

const quota429 = ({ quotaId, retryDelay }) => fail(429,
  "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
  {
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
    ],
  });
const PER_MINUTE = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
const PER_DAY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";

test("a per-minute limit is waited out on the same model, even though the message mentions the free tier", async () => {
  stubFetch(quota429({ quotaId: PER_MINUTE, retryDelay: "1s" }), ok());
  const started = Date.now();
  const result = await extract();
  assert.equal(result.__model, "primary-model", "must not fall back to a weaker model for a 1s wait");
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started >= 900, "waited for retryDelay");
});

test("a per-day quota switches model straight away", async () => {
  stubFetch(quota429({ quotaId: PER_DAY, retryDelay: "3600s" }), ok());
  const started = Date.now();
  assert.equal((await extract()).__model, "backup-1");
  assert.ok(Date.now() - started < 500, "no waiting for a daily quota");
});

test("a per-minute limit with a long retryDelay moves on instead of blocking the file", async () => {
  stubFetch(quota429({ quotaId: PER_MINUTE, retryDelay: "40s" }), ok());
  assert.equal((await extract()).__model, "backup-1");
});

test("the wait is shared: requests that start during a cooldown do not each collect their own 429", async () => {
  const stamps = [];
  let n = 0;
  stubFetch(() => {
    stamps.push(Date.now());
    n++;
    return n === 1 ? quota429({ quotaId: PER_MINUTE, retryDelay: "1s" }) : ok();
  });
  const first = extract();
  await new Promise((r) => setTimeout(r, 40)); // the first 429 has landed, the cooldown is set
  const second = extract();
  await Promise.all([first, second]);
  assert.equal(stamps.length, 3, "one 429 plus one successful call per request, no extra 429s");
  assert.ok(stamps[1] - stamps[0] >= 900 && stamps[2] - stamps[0] >= 900, "nothing was sent during the cooldown");
});

test("new requests skip a model that is in a long cooldown", async () => {
  stubFetch(quota429({ quotaId: PER_MINUTE, retryDelay: "40s" }), ok());
  await extract(); // primary rate limited for 40s -> answered by backup-1
  stubFetch(ok());
  const result = await extract();
  assert.equal(result.__model, "backup-1");
  assert.deepEqual(calls.map((c) => c.model), ["backup-1"], "did not even ask the primary");
});

test("after a daily quota hit, new requests start on the next model", async () => {
  stubFetch(quota429({ quotaId: PER_DAY, retryDelay: "3600s" }), ok());
  await extract();
  stubFetch(ok());
  await extract();
  assert.deepEqual(calls.map((c) => c.model), ["backup-1"]);
});

test("a request already in flight does not sit out a long cooldown that another request started", async () => {
  stubFetch(async (n) => {
    if (n === 1) { await new Promise((r) => setTimeout(r, 100)); return fail(503, "high demand"); } // B: slow 503 on the primary
    if (n === 2) return quota429({ quotaId: PER_MINUTE, retryDelay: "40s" });                        // A: primary rate limited for 40s
    return ok();
  });
  const started = Date.now();
  const b = extract();
  await new Promise((r) => setTimeout(r, 20));
  const a = extract();
  const [resultB, resultA] = await Promise.all([b, a]);
  assert.equal(resultA.__model, "backup-1");
  assert.equal(resultB.__model, "backup-1", "B must move on instead of waiting 40s for the primary");
  assert.ok(Date.now() - started < 1500);
  assert.deepEqual(calls.map((c) => c.model), ["primary-model", "primary-model", "backup-1", "backup-1"]);
});

test("by default six files are read at the same time", async () => {
  delete process.env.GEMINI_MAX_CONCURRENCY;
  let inFlight = 0;
  let peak = 0;
  stubFetch(async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 25));
    inFlight--;
    return ok();
  });
  await Promise.all(Array.from({ length: 14 }, () => extract()));
  assert.equal(peak, 6);
});

test("GEMINI_MAX_CONCURRENCY=1 warns once that uploads are read strictly one at a time", async () => {
  process.env.GEMINI_MAX_CONCURRENCY = "1";
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  stubFetch(ok());
  await extract();
  await extract();
  const serialWarnings = warnings.filter((w) => /one at a time/.test(w));
  assert.ok(serialWarnings.length <= 1, "at most once per process");
});
