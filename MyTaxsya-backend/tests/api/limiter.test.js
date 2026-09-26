import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, envInt } from "../../utils/limiter.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("never runs more than `max` jobs at once and finishes them all", async () => {
  const limit = createLimiter(3);
  let inFlight = 0;
  let peak = 0;
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      limit(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(10);
        inFlight--;
        return i;
      })
    )
  );
  assert.equal(peak, 3);
  assert.deepEqual(results, [...Array(12).keys()]);
});

test("starts queued jobs in FIFO order", async () => {
  const limit = createLimiter(1);
  const order = [];
  await Promise.all([1, 2, 3, 4].map((n) => limit(async () => { await sleep(3); order.push(n); })));
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test("a failing job rejects its own promise but does not stall the queue", async () => {
  const limit = createLimiter(1);
  const failing = limit(async () => { throw new Error("boom"); });
  const after = limit(async () => "still ran");
  await assert.rejects(failing, /boom/);
  assert.equal(await after, "still ran");
});

test("accepts a function so the limit can be read lazily", async () => {
  let max = 1;
  const limit = createLimiter(() => max);
  let inFlight = 0;
  let peak = 0;
  const run = () => limit(async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(10); inFlight--; });
  await Promise.all([run(), run(), run()]);
  assert.equal(peak, 1);
  max = 3;
  peak = 0;
  await Promise.all([run(), run(), run()]);
  assert.equal(peak, 3);
});

test("envInt falls back for missing, zero, negative and non-numeric values", () => {
  process.env.__LIMITER_TEST = "5";
  assert.equal(envInt("__LIMITER_TEST", 9), 5);
  for (const bad of ["", "0", "-2", "abc"]) {
    process.env.__LIMITER_TEST = bad;
    assert.equal(envInt("__LIMITER_TEST", 9), 9, `value ${JSON.stringify(bad)}`);
  }
  delete process.env.__LIMITER_TEST;
  assert.equal(envInt("__LIMITER_TEST", 9), 9);
});
