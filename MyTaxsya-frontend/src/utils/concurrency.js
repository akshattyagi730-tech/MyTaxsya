export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `worker(item, index)` for every item with at most `limit` running at once.
 *
 * - One failing worker never stops the others; its error is collected and returned.
 * - `shouldStop()` is checked before each item starts. Items that were never started
 *   are returned in `skipped` (work already in flight always finishes).
 *
 * @returns {Promise<{ errors: Array<{index:number, error:unknown}>, skipped: number[] }>}
 */
export async function runPool(items, limit, worker, { shouldStop = () => false } = {}) {
  const errors = [];
  const skipped = [];
  let next = 0;

  const runner = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      if (shouldStop()) {
        skipped.push(index);
        continue;
      }
      try {
        await worker(items[index], index);
      } catch (error) {
        errors.push({ index, error });
      }
    }
  };

  const runners = items.length === 0 ? 0 : Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: runners }, runner));
  skipped.sort((a, b) => a - b);
  return { errors, skipped };
}
