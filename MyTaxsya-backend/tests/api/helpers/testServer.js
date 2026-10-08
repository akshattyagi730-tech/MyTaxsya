import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

// Boots a throwaway mongod (never the developer's real database) and the real
// Express app against it, so the security tests exercise the actual HTTP surface.
//   MONGOD_BIN=/path/to/mongod overrides the binary; the tests skip when it is missing.

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

const waitForPort = async (port, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("mongod did not start in time");
};

/** @returns {Promise<{uri:string, stop:() => Promise<void>} | null>} null when mongod is unavailable */
export async function startMongod() {
  const bin = process.env.MONGOD_BIN || "mongod";
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mytaxsya-test-mongo-"));
  const port = await freePort();

  const proc = spawn(bin, ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--nounixsocket"], { stdio: "ignore" });
  const failed = new Promise((resolve) => proc.on("error", () => resolve("missing")));

  try {
    const outcome = await Promise.race([waitForPort(port).then(() => "up"), failed]);
    if (outcome === "missing") {
      fs.rmSync(dbPath, { recursive: true, force: true });
      return null;
    }
  } catch (err) {
    proc.kill("SIGKILL");
    fs.rmSync(dbPath, { recursive: true, force: true });
    throw err;
  }

  return {
    uri: `mongodb://127.0.0.1:${port}/mytaxsya-security-test`,
    async stop() {
      const exited = new Promise((resolve) => proc.on("exit", resolve));
      proc.kill("SIGTERM");
      await exited;
      fs.rmSync(dbPath, { recursive: true, force: true });
    },
  };
}

/** Start the Express app on an ephemeral port, connected to `mongoUri`. */
export async function startApp(mongoUri) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: mongoUri,
    JWT_SECRET: "test-access-secret-".padEnd(64, "a"),
    JWT_REFRESH_SECRET: "test-refresh-secret-".padEnd(64, "b"),
    EMAIL_TRANSPORT: "console",
    FRONTEND_URL: "http://localhost:5175",
    VERCEL: "1", // stops server.js from opening its own listener
  });

  const { default: app } = await import("../../../server.js");

  const deadline = Date.now() + 15000;
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() > deadline) throw new Error("app could not connect to the test database");
    await new Promise((r) => setTimeout(r, 100));
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
    },
  };
}

/** Tiny JSON HTTP client: request(method, path, { body, token, headers }) -> { status, body, headers } */
export function makeClient(base) {
  return async (method, urlPath, { body, token, headers = {}, rawBody } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json, headers: res.headers };
  };
}
