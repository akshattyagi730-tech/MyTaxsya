import { test } from "node:test";
import assert from "node:assert/strict";
import Invoice from "../../models/Invoice.js";
import User from "../../models/User.js";
import {
  HttpError,
  buildListFilters,
  exactMatchCI,
  parsePagination,
  parseSort,
  sanitizeWriteBody,
} from "../../utils/entityGuard.js";
import { assertProductionEnv, getFrontendOrigin } from "../../config/env.js";

const VALID_ID = "64b7f0c2a1b2c3d4e5f60718";

test("sanitizeWriteBody strips server-controlled fields but keeps real data", () => {
  const clean = sanitizeWriteBody({ notes: "hi", created_by: "evil@x.com", id: VALID_ID, _id: VALID_ID, created_date: "2020-01-01", "created_by.x": 1 });
  assert.deepEqual(clean, { notes: "hi" });
});

test("sanitizeWriteBody rejects Mongo update operators and non-objects", () => {
  assert.throws(() => sanitizeWriteBody({ $set: { created_by: "evil@x.com" } }), HttpError);
  assert.throws(() => sanitizeWriteBody([]), HttpError);
  assert.throws(() => sanitizeWriteBody(null), HttpError);
  assert.throws(() => sanitizeWriteBody("x"), HttpError);
});

test("buildListFilters accepts plain schema fields and maps id to _id", () => {
  assert.deepEqual(buildListFilters(Invoice, { customer_id: "abc", sort: "-created_date", limit: "5" }), { customer_id: "abc" });
  assert.deepEqual(buildListFilters(Invoice, { id: VALID_ID }), { _id: VALID_ID });
});

test("buildListFilters blocks ownership override, secrets, unknown fields and operators", () => {
  const bad = [
    { created_by: "victim@x.com" },
    { "created_by[$ne]": "x" },
    { created_by: { $ne: "x" } },
    { customer_id: { $ne: "x" } },
    { customer_id: ["a", "b"] },
    { password: "x" },
    { refresh_token: "x" },
    { not_a_field: "x" },
    { id: "not-an-object-id" },
    { customer_id: "x".repeat(201) },
  ];
  for (const query of bad) {
    assert.throws(() => buildListFilters(Invoice, query), HttpError, JSON.stringify(query));
  }
});

test("parseSort only allows real fields, or an explicit allow-list", () => {
  assert.deepEqual(parseSort(Invoice, undefined), { created_date: -1 });
  assert.deepEqual(parseSort(Invoice, "-total"), { total: -1 });
  assert.throws(() => parseSort(Invoice, "nope"), HttpError);
  assert.throws(() => parseSort(Invoice, { $ne: 1 }), HttpError);
  // Sorting users by password hash would leak information through ordering.
  assert.throws(() => parseSort(User, "password", ["created_date", "email"]), HttpError);
  assert.deepEqual(parseSort(User, "email", ["created_date", "email"]), { email: 1 });
});

test("parsePagination clamps to sane bounds and keeps the bulk-import limit working", () => {
  assert.deepEqual(parsePagination({}), { limit: 200, skip: 0 });
  assert.deepEqual(parsePagination({ limit: "100000", skip: "5" }), { limit: 100000, skip: 5 });
  assert.deepEqual(parsePagination({ limit: "999999999", skip: "-3" }), { limit: 100000, skip: 0 });
  assert.deepEqual(parsePagination({ limit: "0" }), { limit: 1, skip: 0 });
  assert.deepEqual(parsePagination({ limit: "abc" }), { limit: 200, skip: 0 });
});

test("exactMatchCI treats user text literally", () => {
  assert.ok(exactMatchCI("Sharma & Sons (Pvt").test("sharma & sons (pvt"));
  assert.ok(!exactMatchCI(".*").test("anything"));
  assert.ok(!exactMatchCI("a").test("ab"));
  // Would hang a naive `new RegExp(name)`: catastrophic backtracking pattern.
  const started = Date.now();
  exactMatchCI("(a+)+$").test("a".repeat(40) + "!");
  assert.ok(Date.now() - started < 200);
});

test("assertProductionEnv fails closed on missing, placeholder, short or shared secrets", () => {
  const saved = { ...process.env };
  const setEnv = (env) => {
    for (const k of ["NODE_ENV", "JWT_SECRET", "JWT_REFRESH_SECRET"]) delete process.env[k];
    Object.assign(process.env, env);
  };
  try {
    const strongA = "a".repeat(40);
    const strongB = "b".repeat(40);

    setEnv({ NODE_ENV: "development" });
    assert.doesNotThrow(() => assertProductionEnv());

    setEnv({ NODE_ENV: "production" });
    assert.throws(() => assertProductionEnv(), /JWT_SECRET is missing/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: "your_jwt_access_secret_key_here", JWT_REFRESH_SECRET: strongB });
    assert.throws(() => assertProductionEnv(), /placeholder/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: "short", JWT_REFRESH_SECRET: strongB });
    assert.throws(() => assertProductionEnv(), /at least 32/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: strongA, JWT_REFRESH_SECRET: strongA });
    assert.throws(() => assertProductionEnv(), /must be different/);

    setEnv({ NODE_ENV: "production", JWT_SECRET: strongA, JWT_REFRESH_SECRET: strongB, EMAIL_TRANSPORT: "console" });
    assert.doesNotThrow(() => assertProductionEnv());
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("getFrontendOrigin uses only the first of several comma-separated origins", () => {
  const saved = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://app.example.com/, https://other.example.com";
  try {
    assert.equal(getFrontendOrigin(), "https://app.example.com");
  } finally {
    if (saved === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved;
  }
});
