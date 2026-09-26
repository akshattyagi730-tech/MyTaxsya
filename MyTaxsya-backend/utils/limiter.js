// A tiny concurrency limiter: run(fn) starts fn right away while fewer than `max`
// jobs are in flight, otherwise queues it (FIFO). `max` may be a number or a
// function, so an environment variable can be read lazily at call time (dotenv is
// loaded after this module is imported).
//
//   const limit = createLimiter(() => 4);
//   const result = await limit(() => doWork());

export function createLimiter(max) {
  const getMax = typeof max === "function" ? max : () => max;
  let active = 0;
  const queue = [];

  const drain = () => {
    while (queue.length > 0 && active < Math.max(1, getMax())) {
      const job = queue.shift();
      active += 1;
      job();
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() => {
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            drain();
          });
      });
      drain();
    });
}

/** Read a positive integer from the environment, falling back when unset or invalid. */
export function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
