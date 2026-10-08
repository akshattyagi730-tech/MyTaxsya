import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startMongod, startApp, makeClient } from "./helpers/testServer.js";

// End-to-end checks against the real Express app and a throwaway MongoDB.
// Each test tries the actual attack, not just the happy path.

let mongod;
let app;
let call;
let outbox;
let User;

const PASSWORD = "correct-horse-battery";
let counter = 0;
const email = (name) => `${name}${++counter}@example.com`;

const lastMailTo = (to) => [...outbox].reverse().find((m) => m.to === to);

const otpFor = (to) => lastMailTo(to).text.match(/\b(\d{6})\b/)[1];

// Reset/invite emails carry /reset-password?token=<jwt>
const tokenFromMail = (to) => decodeURIComponent(lastMailTo(to).text.match(/token=([^\s]+)/)[1]);

async function signUp(address, password = PASSWORD) {
  const reg = await call("POST", "/api/auth/register", { body: { email: address, password, full_name: address.split("@")[0] } });
  assert.equal(reg.status, 200, `register failed: ${JSON.stringify(reg.body)}`);
  const ver = await call("POST", "/api/auth/verify-otp", { body: { email: address, otpCode: otpFor(address) } });
  assert.equal(ver.status, 201, `verify failed: ${JSON.stringify(ver.body)}`);
  return { email: address, id: String(ver.body.user.id), access: ver.body.access_token, refresh: ver.body.refresh_token };
}

let admin; // first account created in a fresh database is the admin
let userB;

before(async () => {
  mongod = await startMongod();
  if (!mongod) return;
  app = await startApp(mongod.uri);
  call = makeClient(app.base);
  ({ outbox } = await import("../../services/emailService.js"));
  ({ default: User } = await import("../../models/User.js"));

  admin = await signUp(email("admin"));
  userB = await signUp(email("userb"));
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

const invoiceBody = (n) => ({ invoice_number: `INV-${n}`, customer_id: "cust-1", customer_name: "Acme", status: "draft", total: 100 });

// --- Tenant isolation ---------------------------------------------------------

dbTest("requests without a token are rejected", async () => {
  assert.equal((await call("GET", "/api/entities/Invoice")).status, 401);
});

dbTest("one user cannot read another user's records", async () => {
  const created = await call("POST", "/api/entities/Invoice", { token: admin.access, body: invoiceBody("iso-1") });
  assert.equal(created.status, 201);
  const invoiceId = created.body.id || created.body._id;

  // The original bug: ?created_by=<victim> overrode the owner scope.
  const byOwnerFilter = await call("GET", `/api/entities/Invoice?created_by=${encodeURIComponent(admin.email)}`, { token: userB.access });
  assert.equal(byOwnerFilter.status, 400);

  const list = await call("GET", "/api/entities/Invoice", { token: userB.access });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, []);

  assert.equal((await call("GET", `/api/entities/Invoice/${invoiceId}`, { token: userB.access })).status, 404);
  assert.equal((await call("PUT", `/api/entities/Invoice/${invoiceId}`, { token: userB.access, body: { notes: "hijack" } })).status, 404);
  assert.equal((await call("DELETE", `/api/entities/Invoice/${invoiceId}`, { token: userB.access })).status, 404);

  // Still intact for the owner
  assert.equal((await call("GET", `/api/entities/Invoice/${invoiceId}`, { token: admin.access })).status, 200);
});

dbTest("query operators in filters are rejected", async () => {
  for (const qs of ["created_by[$ne]=zzz", "customer_id[$ne]=x", "customer_id[$regex]=.*", "_id[$ne]=x", "sort[$ne]=1", "not_a_field=1"]) {
    const res = await call("GET", `/api/entities/Invoice?${qs}`, { token: userB.access });
    assert.equal(res.status, 400, qs);
  }
});

dbTest("ownership cannot be spoofed on create or rewritten on update", async () => {
  const spoofed = await call("POST", "/api/entities/Invoice", { token: userB.access, body: { ...invoiceBody("spoof-1"), created_by: admin.email } });
  assert.equal(spoofed.status, 201);
  assert.equal(spoofed.body.created_by, userB.email);
  const id = spoofed.body.id || spoofed.body._id;

  const rewrite = await call("PUT", `/api/entities/Invoice/${id}`, { token: userB.access, body: { notes: "x", created_by: admin.email } });
  assert.equal(rewrite.status, 200);
  assert.equal(rewrite.body.created_by, userB.email);

  const operator = await call("PUT", `/api/entities/Invoice/${id}`, { token: userB.access, body: { $set: { created_by: admin.email } } });
  assert.equal(operator.status, 400);

  // The record never moved to the admin's account
  const adminList = await call("GET", "/api/entities/Invoice?limit=1000", { token: admin.access });
  assert.ok(!adminList.body.some((i) => i.invoice_number === "INV-spoof-1"));
});

dbTest("bad ids are 404s, not server errors", async () => {
  assert.equal((await call("GET", "/api/entities/Invoice/not-an-id", { token: userB.access })).status, 404);
  assert.equal((await call("DELETE", "/api/entities/Invoice/not-an-id", { token: userB.access })).status, 404);
});

// --- Users: no secrets, no escalation -----------------------------------------

dbTest("user listings never contain secrets", async () => {
  const res = await call("GET", "/api/entities/User", { token: admin.access });
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 2);
  for (const u of res.body) {
    for (const secret of ["password", "refresh_token", "google_id"]) {
      assert.ok(!(secret in u), `${secret} leaked in user listing`);
    }
    assert.ok(u.id, "users should expose an id");
  }
  const me = await call("GET", "/api/auth/me", { token: admin.access });
  assert.ok(!("password" in me.body) && !("refresh_token" in me.body));
});

dbTest("a normal user only sees themselves, and cannot filter their way to others", async () => {
  const res = await call("GET", "/api/entities/User?_id[$ne]=x&role=admin", { token: userB.access });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((u) => u.email), [userB.email]);

  assert.equal((await call("GET", `/api/entities/User/${admin.id}`, { token: userB.access })).status, 403);
});

dbTest("a user cannot promote themselves or change credentials via the entity API", async () => {
  const onlyRole = await call("PUT", `/api/entities/User/${userB.id}`, { token: userB.access, body: { role: "admin" } });
  assert.equal(onlyRole.status, 400);

  const mixed = await call("PUT", `/api/entities/User/${userB.id}`, {
    token: userB.access,
    body: { full_name: "Renamed", role: "admin", password: "pwned-plaintext", refresh_token: "x", email: "other@example.com" },
  });
  assert.equal(mixed.status, 200);
  assert.equal(mixed.body.full_name, "Renamed");

  const stored = await User.findById(userB.id);
  assert.equal(stored.role, "user");
  assert.equal(stored.email, userB.email);
  assert.notEqual(stored.password, "pwned-plaintext");
  assert.ok(stored.password.startsWith("$2"), "password must remain a bcrypt hash");

  const me = await call("GET", "/api/auth/me", { token: userB.access });
  assert.equal(me.body.role, "user");
});

dbTest("users cannot be created or deleted through the entity API", async () => {
  const create = await call("POST", "/api/entities/User", { token: userB.access, body: { email: email("rogue"), password: PASSWORD, role: "admin" } });
  assert.equal(create.status, 403);
  assert.equal((await call("DELETE", `/api/entities/User/${admin.id}`, { token: admin.access })).status, 403);
  assert.equal((await call("DELETE", "/api/entities/User/all", { token: admin.access })).status, 403);
});

// --- Input hygiene ------------------------------------------------------------

dbTest("names with regex characters are handled literally by duplicate checks", async () => {
  const name = "Sharma & Sons (Pvt";
  assert.equal((await call("POST", "/api/entities/Customer", { token: userB.access, body: { name } })).status, 201);

  const dup = await call("POST", "/api/entities/Customer", { token: userB.access, body: { name: name.toUpperCase() } });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /already exists/);

  assert.equal((await call("POST", "/api/entities/Product", { token: userB.access, body: { name: "Widget" } })).status, 201);
  // ".*" is just a name, not a pattern that matches "Widget"
  assert.equal((await call("POST", "/api/entities/Product", { token: userB.access, body: { name: ".*" } })).status, 201);
});

dbTest("oversized bodies on public endpoints are refused", async () => {
  const res = await call("POST", "/api/auth/login", { rawBody: JSON.stringify({ email: "a@b.co", password: "x".repeat(300 * 1024) }) });
  assert.equal(res.status, 413);
});

// --- Sign-up ------------------------------------------------------------------

dbTest("weak passwords and bad emails are rejected at sign-up", async () => {
  assert.equal((await call("POST", "/api/auth/register", { body: { email: email("weak"), password: "short" } })).status, 400);
  assert.equal((await call("POST", "/api/auth/register", { body: { email: "not-an-email", password: PASSWORD } })).status, 400);
  assert.equal((await call("POST", "/api/auth/register", { body: { email: { $ne: "" }, password: PASSWORD } })).status, 400);
});

dbTest("the OTP is locked after 5 wrong guesses, even if the 6th is correct", async () => {
  const victim = email("otplock");
  assert.equal((await call("POST", "/api/auth/register", { body: { email: victim, password: PASSWORD } })).status, 200);
  const correct = otpFor(victim);
  const wrong = correct === "000000" ? "111111" : "000000";

  for (let i = 0; i < 5; i++) {
    const res = await call("POST", "/api/auth/verify-otp", { body: { email: victim, otpCode: wrong } });
    assert.equal(res.status, 400, `attempt ${i + 1}`);
  }
  const sixth = await call("POST", "/api/auth/verify-otp", { body: { email: victim, otpCode: correct } });
  assert.equal(sixth.status, 429);

  // No account was created
  assert.equal((await call("POST", "/api/auth/login", { body: { email: victim, password: PASSWORD } })).status, 401);
});

dbTest("OTP verification is bound to the session: wrong email/format is refused", async () => {
  const a = email("bound");
  await call("POST", "/api/auth/register", { body: { email: a, password: PASSWORD } });
  const code = otpFor(a);
  assert.equal((await call("POST", "/api/auth/verify-otp", { body: { email: email("nobody"), otpCode: code } })).status, 400);
  assert.equal((await call("POST", "/api/auth/verify-otp", { body: { email: a, otpCode: { $ne: "" } } })).status, 400);
  assert.equal((await call("POST", "/api/auth/verify-otp", { body: { email: a, otpCode: "12" } })).status, 400);
});

// --- Tokens & sessions --------------------------------------------------------

dbTest("refresh tokens cannot authenticate API requests", async () => {
  assert.equal((await call("GET", "/api/entities/Invoice", { token: userB.refresh })).status, 401);
});

dbTest("a token for a deleted account stops working immediately", async () => {
  const doomed = await signUp(email("doomed"));
  assert.equal((await call("GET", "/api/auth/me", { token: doomed.access })).status, 200);
  await User.deleteOne({ _id: doomed.id });
  assert.equal((await call("GET", "/api/auth/me", { token: doomed.access })).status, 401);
  assert.equal((await call("GET", "/api/entities/Invoice", { token: doomed.access })).status, 401);
});

dbTest("logout only accepts a string token (no operator injection)", async () => {
  const before = await call("POST", "/api/auth/refresh", { body: { refresh_token: admin.refresh } });
  assert.equal(before.status, 200);

  const res = await call("POST", "/api/auth/logout", { body: { refresh_token: { $ne: null } } });
  assert.equal(res.status, 200);

  // Nobody was signed out by the injected operator
  assert.equal((await call("POST", "/api/auth/refresh", { body: { refresh_token: admin.refresh } })).status, 200);
  assert.equal((await call("POST", "/api/auth/refresh", { body: { refresh_token: { $ne: null } } })).status, 400);
});

dbTest("login gives the same answer for unknown accounts and wrong passwords", async () => {
  const unknown = await call("POST", "/api/auth/login", { body: { email: email("ghost"), password: PASSWORD } });
  const wrong = await call("POST", "/api/auth/login", { body: { email: userB.email, password: "definitely-wrong" } });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(unknown.body.error, wrong.body.error);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: { $ne: "" }, password: PASSWORD } })).status, 400);
});

// --- Password reset -----------------------------------------------------------

dbTest("password reset links are single-use, and access tokens can't double as reset tokens", async () => {
  const target = await signUp(email("resetme"));

  // An access token is not a reset token
  const asReset = await call("POST", "/api/auth/reset-password", { body: { resetToken: target.access, newPassword: "brand-new-password" } });
  assert.equal(asReset.status, 400);

  // Unknown emails get the identical response and no mail
  const before = outbox.length;
  const ghost = await call("POST", "/api/auth/forgot-password", { body: { email: email("ghost") } });
  const real = await call("POST", "/api/auth/forgot-password", { body: { email: target.email } });
  assert.equal(ghost.status, 200);
  assert.deepEqual(ghost.body, real.body);
  assert.equal(outbox.length, before + 1);

  const resetToken = tokenFromMail(target.email);

  // A reset token is not an access token
  assert.equal((await call("GET", "/api/entities/Invoice", { token: resetToken })).status, 401);

  assert.equal((await call("POST", "/api/auth/reset-password", { body: { resetToken, newPassword: "short" } })).status, 400);
  assert.equal((await call("POST", "/api/auth/reset-password", { body: { resetToken, newPassword: "brand-new-password" } })).status, 200);

  // Second use of the same link fails
  assert.equal((await call("POST", "/api/auth/reset-password", { body: { resetToken, newPassword: "another-password-1" } })).status, 400);

  // Old sessions are gone, new password works
  assert.equal((await call("POST", "/api/auth/refresh", { body: { refresh_token: target.refresh } })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: target.email, password: PASSWORD } })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: target.email, password: "brand-new-password" } })).status, 200);
});

// --- Team invites -------------------------------------------------------------

dbTest("invited members get an emailed link, set a password, and can log in", async () => {
  const invitee = email("invitee");

  assert.equal((await call("POST", "/api/auth/invite", { token: userB.access, body: { email: invitee } })).status, 403);
  assert.equal((await call("POST", "/api/auth/invite", { token: admin.access, body: { email: invitee, role: "root" } })).status, 400);

  const invite = await call("POST", "/api/auth/invite", { token: admin.access, body: { email: invitee, role: "user" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  for (const secret of ["password", "refresh_token"]) assert.ok(!(secret in invite.body));

  // Nobody can log in until they have chosen a password
  assert.equal((await call("POST", "/api/auth/login", { body: { email: invitee, password: PASSWORD } })).status, 401);

  const token = tokenFromMail(invitee);
  assert.equal((await call("POST", "/api/auth/reset-password", { body: { resetToken: token, newPassword: PASSWORD } })).status, 200);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: invitee, password: PASSWORD } })).status, 200);

  assert.equal((await call("POST", "/api/auth/invite", { token: admin.access, body: { email: invitee } })).status, 400);
});

dbTest("access tokens issued by this server carry the access purpose and expire", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const decoded = jwt.decode(admin.access);
  assert.equal(decoded.typ, "access");
  assert.ok(decoded.exp - decoded.iat <= 15 * 60);

  // A correctly-signed token of the wrong type is refused
  const forged = jwt.sign({ id: admin.id, email: admin.email, role: "admin", typ: "reset" }, process.env.JWT_SECRET, { expiresIn: "5m" });
  assert.equal((await call("GET", "/api/auth/me", { token: forged })).status, 401);

  // alg=none is refused
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ id: admin.id, typ: "access" })).toString("base64url")}.`;
  assert.equal((await call("GET", "/api/auth/me", { token: none })).status, 401);
});

dbTest("registration fails loudly (503) when email cannot be sent, and leaves nothing behind", async () => {
  const saved = process.env.EMAIL_TRANSPORT;
  delete process.env.EMAIL_TRANSPORT; // no SMTP and no console transport configured
  try {
    const address = email("nomail");
    const res = await call("POST", "/api/auth/register", { body: { email: address, password: PASSWORD } });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "EMAIL_UNAVAILABLE");

    // Once email works again the same address can sign up straight away
    process.env.EMAIL_TRANSPORT = "console";
    assert.equal((await call("POST", "/api/auth/register", { body: { email: address, password: PASSWORD } })).status, 200);
  } finally {
    process.env.EMAIL_TRANSPORT = saved;
  }
});

dbTest("mongoose connection is the throwaway test database", () => {
  assert.equal(mongoose.connection.name, "mytaxsya-security-test");
});
