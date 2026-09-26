import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPool, sleep } from './concurrency.js';

test('never runs more than `limit` workers at once and processes every item', async () => {
  let inFlight = 0;
  let peak = 0;
  const seen = [];
  const { errors, skipped } = await runPool([...Array(15).keys()], 4, async (item, index) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await sleep(5);
    inFlight--;
    seen.push([item, index]);
  });
  assert.equal(peak, 4);
  assert.equal(seen.length, 15);
  assert.deepEqual(seen.map(([item, index]) => item === index).every(Boolean), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(skipped, []);
});

test('runs really in parallel: 8 jobs of 30ms with limit 4 take about 60ms, not 240ms', async () => {
  const started = Date.now();
  await runPool([...Array(8).keys()], 4, () => sleep(30));
  const took = Date.now() - started;
  assert.ok(took < 150, `took ${took}ms`);
});

test('a failing worker is collected and does not stop the others', async () => {
  const done = [];
  const { errors } = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    if (n === 3) throw new Error('boom');
    await sleep(2);
    done.push(n);
  });
  assert.deepEqual(done.sort(), [1, 2, 4, 5]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].index, 2);
  assert.match(errors[0].error.message, /boom/);
});

test('shouldStop prevents new work from starting and reports the skipped items', async () => {
  let stop = false;
  const started = [];
  const { skipped } = await runPool([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
    started.push(n);
    await sleep(5);
    if (n === 1) stop = true;
  }, { shouldStop: () => stop });
  // Items already started finish; nothing new starts once `stop` flips.
  assert.ok(started.length < 8);
  assert.deepEqual([...started, ...skipped].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(skipped.length > 0);
});

test('handles an empty list and a limit larger than the list', async () => {
  assert.deepEqual(await runPool([], 4, async () => { throw new Error('never'); }), { errors: [], skipped: [] });
  const seen = [];
  await runPool(['a', 'b'], 10, async (x) => { seen.push(x); });
  assert.deepEqual(seen.sort(), ['a', 'b']);
});

test('a limit of 0 or less still makes progress (treated as 1)', async () => {
  const seen = [];
  await runPool([1, 2, 3], 0, async (x) => { seen.push(x); });
  assert.deepEqual(seen, [1, 2, 3]);
});
