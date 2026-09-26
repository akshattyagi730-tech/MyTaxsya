// Small in-memory fixed-window rate limiter for the auth endpoints.
//
// Counters live in this process only. On a single long-running server (Render)
// that is exact; on serverless (Vercel) each instance counts separately, so it
// is a best-effort brake. The OTP attempt cap is stored in MongoDB and does not
// depend on this limiter.

const MAX_TRACKED_KEYS = 10000;

export function rateLimit({ windowMs, max, key = (req) => req.ip, message, skipSuccessfulRequests = false }) {
  const hits = new Map();

  const sweep = (now) => {
    for (const [k, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(k);
    }
    // Still huge after dropping expired windows: shed everything rather than grow unbounded.
    if (hits.size > MAX_TRACKED_KEYS) hits.clear();
  };

  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > MAX_TRACKED_KEYS) sweep(now);

    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({
        error: message || "Too many requests. Please try again later.",
        code: "RATE_LIMITED",
      });
    }

    if (skipSuccessfulRequests) {
      res.on("finish", () => {
        if (res.statusCode < 400 && entry.count > 0) entry.count -= 1;
      });
    }
    next();
  };
}

export const byIp = (req) => req.ip;

// One bucket per client + email, so a burst against one account cannot lock out
// unrelated users behind the same NAT.
export const byIpAndEmail = (req) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return `${req.ip}|${email}`;
};
