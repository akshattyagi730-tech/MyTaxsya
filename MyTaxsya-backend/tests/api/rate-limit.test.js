import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMongod, startApp, makeClient } from "./helpers/testServer.js";

// Separate file (= separate process) so the in-memory limiter counters start clean.

let mongod;
let app;
let call;
let outbox;

before(async () => {
  mongod = await startMongod();
  if (!mongod) return;
  app = await startApp(mongod.uri);
  call = makeClient(app.base);
  ({ outbox } = await import("../../services/emailService.js"));
});

after(async () => {
  if (app) await app.close();
  if (mongod) await mongod.stop();
});

// Registered up front but skipped at run time, once we know whether mongod started.
const dbTest = (name, fn) => test(name, async (t) => {
  if (!mongod) return t.skip("mongod is not installed; set MONGOD_BIN to run the API security tests");
  await fn(t);
});

dbTest("repeated failed logins are throttled per account, without affecting others", async () => {
  const target = { email: "victim@example.com", password: "whatever-it-is" };

  for (let i = 0; i < 10; i++) {
    const res = await call("POST", "/api/auth/login", { body: target });
    assert.equal(res.status, 401, `attempt ${i + 1}`);
  }
  const blocked = await call("POST", "/api/auth/login", { body: target });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, "RATE_LIMITED");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  // A different account from the same client is unaffected
  const other = await call("POST", "/api/auth/login", { body: { email: "someone-else@example.com", password: "x-y-z-1234" } });
  assert.equal(other.status, 401);
});

dbTest("successful logins do not count towards the limit", async () => {
  const address = "regular@example.com";
  const password = "a-long-enough-password";
  assert.equal((await call("POST", "/api/auth/register", { body: { email: address, password } })).status, 200);
  const otp = [...outbox].reverse().find((m) => m.to === address).text.match(/\b(\d{6})\b/)[1];
  assert.equal((await call("POST", "/api/auth/verify-otp", { body: { email: address, otpCode: otp } })).status, 201);

  for (let i = 0; i < 15; i++) {
    const res = await call("POST", "/api/auth/login", { body: { email: address, password } });
    assert.equal(res.status, 200, `login ${i + 1}`);
  }
});

dbTest("code requests are throttled and capped per sign-up", async () => {
  const address = "resender@example.com";
  assert.equal((await call("POST", "/api/auth/register", { body: { email: address, password: "a-long-enough-password" } })).status, 200);

  // Registering again straight away hits the 30s cooldown, so no inbox flooding
  assert.equal((await call("POST", "/api/auth/register", { body: { email: address, password: "a-long-enough-password" } })).status, 429);
  assert.equal((await call("POST", "/api/auth/resend-otp", { body: { email: address } })).status, 429);
});
