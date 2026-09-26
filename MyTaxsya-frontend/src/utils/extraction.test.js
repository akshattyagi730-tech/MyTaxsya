import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeExtractionError, throwIfAiFailure, withAutoRetry } from './extraction.js';

// What the API client throws (see services/api.js): an Error carrying .status and .data.
const apiError = (status, data) => Object.assign(new Error(data?.error || 'An API error occurred'), { status, data });

test('quota, key and config problems are fatal and not retryable', () => {
  for (const code of ['AI_DAILY_QUOTA_EXHAUSTED', 'AI_UNAUTHORIZED', 'AI_MODEL_NOT_FOUND', 'AI_CONFIG_ERROR']) {
    const info = describeExtractionError(apiError(422, { error_code: code, error: 'x' }));
    assert.equal(info.fatal, true, code);
    assert.equal(info.retryable, false, code);
    assert.equal(info.code, code);
  }
});

test('a rate limit is retryable, not fatal, and says how long to wait', () => {
  const info = describeExtractionError(apiError(422, { error_code: 'AI_RATE_LIMITED', diagnostic: { retry_after_seconds: 7, retryable: true } }));
  assert.equal(info.fatal, false);
  assert.equal(info.retryable, true);
  assert.equal(info.retryAfter, 7);
  assert.match(info.message, /7 seconds/);
});

test('the server\'s own retryable flag wins over the error code', () => {
  const info = describeExtractionError(apiError(422, { error_code: 'AI_REQUEST_FAILED', error: 'boom', diagnostic: { retryable: false } }));
  assert.equal(info.retryable, false);
  assert.equal(info.message, 'boom');
});

test('network errors (no response body) are retryable and get a readable message', () => {
  const info = describeExtractionError(new Error('Network Error'));
  assert.equal(info.retryable, true);
  assert.equal(info.fatal, false);
  assert.equal(info.message, 'Invoice extraction failed: Network Error');
});

test('oversized files and server-worded errors are passed through clearly', () => {
  assert.match(describeExtractionError(apiError(413, {})).message, /100 MB/);
  assert.equal(describeExtractionError(apiError(400, { error: 'Unsupported file type' })).message, 'Unsupported file type');
});

test('withAutoRetry returns straight away on success', async () => {
  let calls = 0;
  assert.equal(await withAutoRetry(async () => { calls++; return 'ok'; }, { sleepFn: async () => {} }), 'ok');
  assert.equal(calls, 1);
});

test('a temporary failure is retried once, after a pause of about retry-after seconds', async () => {
  let calls = 0;
  const pauses = [];
  const result = await withAutoRetry(async () => {
    calls++;
    if (calls === 1) throw apiError(422, { error_code: 'AI_RATE_LIMITED', diagnostic: { retry_after_seconds: 5, retryable: true } });
    return 'recovered';
  }, { sleepFn: async (ms) => { pauses.push(ms); }, random: () => 0 });
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
  assert.deepEqual(pauses, [5000]);
});

test('it gives up after the allowed retries and throws the last error', async () => {
  let calls = 0;
  await assert.rejects(
    withAutoRetry(async () => { calls++; throw apiError(422, { error_code: 'AI_REQUEST_FAILED', error: `fail ${calls}`, diagnostic: { retryable: true } }); }, { sleepFn: async () => {} }),
    /fail 2/
  );
  assert.equal(calls, 2);
});

test('fatal and non-retryable errors are never retried', async () => {
  for (const data of [
    { error_code: 'AI_UNAUTHORIZED' },
    { error_code: 'AI_DAILY_QUOTA_EXHAUSTED' },
    { error_code: 'AI_REQUEST_FAILED', diagnostic: { retryable: false } },
  ]) {
    let calls = 0;
    await assert.rejects(withAutoRetry(async () => { calls++; throw apiError(422, data); }, { sleepFn: async () => { throw new Error('must not sleep'); } }));
    assert.equal(calls, 1, JSON.stringify(data));
  }
});

test('the pause is capped at 20 seconds plus jitter', async () => {
  let paused = 0;
  let calls = 0;
  await withAutoRetry(async () => {
    calls++;
    if (calls === 1) throw apiError(422, { error_code: 'AI_RATE_LIMITED', diagnostic: { retry_after_seconds: 300, retryable: true } });
    return 'ok';
  }, { sleepFn: async (ms) => { paused = ms; }, random: () => 1 });
  assert.equal(paused, 20000 + 1500);
});

test('a temporary failure that names no wait gets a short pause, not the rate-limit default', async () => {
  let calls = 0;
  let paused = 0;
  await withAutoRetry(async () => {
    calls++;
    if (calls === 1) throw apiError(503, { error: 'Bad gateway' });
    return 'ok';
  }, { sleepFn: async (ms) => { paused = ms; }, random: () => 0 });
  assert.equal(paused, 4000);
});

test('an ai_failure on an HTTP 200 draft is raised like an API error, so it is retried or reported', async () => {
  assert.doesNotThrow(() => throwIfAiFailure({ fields: {} }));
  assert.doesNotThrow(() => throwIfAiFailure(undefined));

  let thrown;
  try {
    throwIfAiFailure({ ai_failure: { code: 'AI_RATE_LIMITED', message: 'Slow down', retryable: true, retry_after_seconds: 12 } });
  } catch (err) { thrown = err; }
  const info = describeExtractionError(thrown);
  assert.equal(info.code, 'AI_RATE_LIMITED');
  assert.equal(info.retryable, true);
  assert.equal(info.retryAfter, 12);
  assert.equal(info.fatal, false);

  let fatal;
  try { throwIfAiFailure({ ai_failure: { code: 'AI_UNAUTHORIZED', message: 'Invalid key', retryable: false } }); } catch (err) { fatal = err; }
  const fatalInfo = describeExtractionError(fatal);
  assert.equal(fatalInfo.fatal, true);
  assert.equal(fatalInfo.retryable, false);
  assert.equal(fatalInfo.message, 'Invalid key');
});

test('withAutoRetry recovers when the first answer is an ai_failure and the second is real data', async () => {
  let calls = 0;
  const result = await withAutoRetry(async () => {
    calls++;
    const data = calls === 1
      ? { ai_failure: { code: 'AI_REQUEST_FAILED', message: 'overloaded', retryable: true } }
      : { fields: { invoice_number: 'INV-1' } };
    throwIfAiFailure(data);
    return data;
  }, { sleepFn: async () => {} });
  assert.equal(result.fields.invoice_number, 'INV-1');
  assert.equal(calls, 2);
});
