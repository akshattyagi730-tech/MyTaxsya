import crypto from "crypto";

// Secrets are read lazily (at call time), never at import time: server.js loads
// dotenv *after* its imports are evaluated, so reading process.env here at the
// top level would see an empty environment.

const PLACEHOLDER = /^your_|change[_-]?me|secret[_-]?key[_-]?here/i;
const MIN_SECRET_LENGTH = 32;

const isProduction = () => process.env.NODE_ENV === "production";

// Outside production a missing secret gets a random per-process one instead of
// a hardcoded string, so there is never a well-known signing key anywhere.
const devSecrets = {};
const devSecret = (name) => {
  if (!devSecrets[name]) {
    devSecrets[name] = crypto.randomBytes(48).toString("hex");
    console.warn(`[security] ${name} is not set - using a temporary random secret. Sessions will not survive a restart.`);
  }
  return devSecrets[name];
};

const readSecret = (name) => {
  const value = process.env[name];
  if (value && !PLACEHOLDER.test(value)) return value;
  if (isProduction()) throw new Error(`${name} must be set to a strong random value in production.`);
  return devSecret(name);
};

export const getAccessSecret = () => readSecret("JWT_SECRET");
export const getRefreshSecret = () => readSecret("JWT_REFRESH_SECRET");

// FRONTEND_URL may hold several comma-separated origins (it doubles as the CORS
// allow-list); links sent in emails must use just one of them.
export const getFrontendOrigin = () =>
  (process.env.FRONTEND_URL || "http://localhost:5175").split(",")[0].trim().replace(/\/$/, "");

/** Fail fast at boot if production is configured with missing or weak secrets. */
export function assertProductionEnv() {
  if (!isProduction()) return;

  const problems = [];
  for (const name of ["JWT_SECRET", "JWT_REFRESH_SECRET"]) {
    const value = process.env[name];
    if (!value || PLACEHOLDER.test(value)) problems.push(`${name} is missing or still a placeholder`);
    else if (value.length < MIN_SECRET_LENGTH) problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    problems.push("JWT_SECRET and JWT_REFRESH_SECRET must be different");
  }
  if (problems.length) {
    throw new Error(`Insecure production configuration:\n - ${problems.join("\n - ")}`);
  }

  if (!process.env.SMTP_HOST && process.env.EMAIL_TRANSPORT !== "console") {
    console.warn("[config] SMTP_HOST is not set - sign-up verification, password-reset and invite emails cannot be sent.");
  }
}
