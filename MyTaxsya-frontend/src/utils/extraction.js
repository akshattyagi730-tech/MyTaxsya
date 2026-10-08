import { sleep } from './concurrency.js';

// Shared by the invoice and purchase-bill bulk importers.

// How many files are sent to the AI at the same time. The server has its own cap
// (GEMINI_MAX_CONCURRENCY), so raising this alone does not go faster than that.
export const EXTRACTION_CONCURRENCY = 6;
// Extra automatic attempts when a file fails for a temporary reason (rate limit, overload).
export const AUTO_RETRIES = 1;
// Guard against an accidental huge (and costly) batch.
export const MAX_FILES_PER_BATCH = 200;
// Errors that would hit every remaining file the same way: stop instead of hammering the API.
export const FATAL_ERROR_CODES = ['AI_DAILY_QUOTA_EXHAUSTED', 'AI_UNAUTHORIZED', 'AI_MODEL_NOT_FOUND', 'AI_CONFIG_ERROR'];

/**
 * Turn whatever the API or the network threw into one shape the UI can act on:
 * { message, code, retryable, retryAfter, fatal }.
 */
export const describeExtractionError = (err) => {
  const errData = err?.data || {};
  const code = errData.error_code || errData.diagnostic?.error_code;
  // Only set when the server said how long to wait (rate limits); null otherwise.
  const retryAfter = errData.diagnostic?.retry_after_seconds || null;
  const fatal = FATAL_ERROR_CODES.includes(code);
  const retryable = errData.diagnostic?.retryable !== undefined ? errData.diagnostic.retryable : !fatal;

  let message = 'Invoice extraction failed';
  if (code === 'AI_UNAUTHORIZED') {
    message = errData.error || 'Invalid Gemini API key provided. Please verify your GEMINI_API_KEY configuration.';
  } else if (code === 'AI_MODEL_NOT_FOUND') {
    message = errData.error || 'Configured Gemini model was not found (HTTP 404). Please verify your GEMINI_MODEL setting.';
  } else if (code === 'AI_DAILY_QUOTA_EXHAUSTED') {
    message = 'AI extraction quota is currently exhausted. Please try again when your Gemini quota resets or configure a higher API quota.';
  } else if (code === 'AI_RATE_LIMITED' || code === 'AI_QUOTA_EXCEEDED') {
    message = `AI rate limit reached. Please try again after ${retryAfter || 19} seconds.`;
  } else if (err?.status === 413) {
    message = 'Invoice extraction failed (File Size Exceeded): File exceeds 100 MB limit.';
  } else if (errData.error) {
    message = errData.error;
  } else if (err?.message) {
    message = err.message.startsWith('Invoice extraction failed') ? err.message : `Invoice extraction failed: ${err.message}`;
  }
  return { message, code, retryable, retryAfter, fatal };
};

/**
 * Run `run()`; when it fails for a temporary reason, pause briefly and try again
 * (up to `retries` extra times). Fatal and non-retryable errors are thrown at once.
 */
export async function withAutoRetry(run, { retries = AUTO_RETRIES, sleepFn = sleep, random = Math.random } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const info = describeExtractionError(err);
      if (attempt >= retries || !info.retryable || info.fatal) throw err;
      // Jitter, so parallel files that were rate-limited together do not all retry at the same instant.
      // A rate limit says how long to wait; any other temporary failure just gets a short pause.
      await sleepFn(Math.min(info.retryAfter ?? 4, 20) * 1000 + random() * 1500);
    }
  }
}

/**
 * When the AI itself fails (rate limit, quota, outage) the backend still answers HTTP 200
 * with a blank editable draft, and flags the real reason in `ai_failure`. Raise that as an
 * error shaped like an API error, so the file is handled like any other failed file
 * (retry button, stop-on-fatal) instead of showing up as a mysteriously empty document.
 */
export function throwIfAiFailure(data) {
  const failure = data?.ai_failure;
  if (!failure) return;
  throw Object.assign(new Error(failure.message || 'AI extraction failed'), {
    data: {
      error: failure.message,
      error_code: failure.code,
      diagnostic: {
        error_code: failure.code,
        retryable: failure.retryable,
        retry_after_seconds: failure.retry_after_seconds ?? undefined,
      },
    },
  });
}
