import { spawn } from "child_process";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A real server, on a real MongoDB, that exists only for the length of one
 * test file.
 *
 * In-memory rather than a test database on the shared cluster, for two
 * reasons. The cluster is a shared resource with a hard collection ceiling, so
 * tests that create collections there are tests that can fail for reasons
 * having nothing to do with the code. And a suite that can only run when the
 * network and someone else's cluster are both healthy is a suite people stop
 * running.
 *
 * The server is started as a child process rather than imported, so what is
 * under test is the whole thing — middleware order, route mounting, the error
 * handler — and not a hand-assembled approximation of it.
 */
export const startHarness = async ({ port = 5901 } = {}) => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri("harness");

  const child = spawn("node", ["server.js"], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(port),
      PREVIEW_PORT: String(port + 1),
      MONGO_URI: uri,
      JWT_SECRET: crypto.randomBytes(48).toString("base64url"),
      // A fresh vault key per run, so no test can read another run's secrets
      VAULT_KEY: crypto.randomBytes(32).toString("base64url"),
      NODE_ENV: "test",
      CORS_ORIGINS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      if (i === 59) throw new Error("server never came up:\n" + log);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  await mongoose.connect(uri);

  /**
   * Wait for the indexes before handing the suite a server.
   *
   * Mongoose builds them in the background once a connection opens, so on a
   * database created milliseconds ago a unique index may not exist yet — and a
   * test asserting that a duplicate is refused then passes or fails depending
   * on the machine it ran on. Building them here makes that deterministic.
   *
   * The models are imported for their side effect of registering themselves;
   * importing the server's routes is what pulls every one of them in.
   */
  await import("../../routes/adminRoutes.js");
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));

  /** Tiny fetch wrapper: JSON in, { status, body } out, token optional. */
  const request = async (method, path, { body, token } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  };

  const api = {
    get: (p, o) => request("GET", p, o),
    post: (p, body, o) => request("POST", p, { ...o, body }),
    put: (p, body, o) => request("PUT", p, { ...o, body }),
    del: (p, o) => request("DELETE", p, o),
  };

  const stop = async () => {
    await mongoose.disconnect();
    child.kill("SIGKILL");
    await mongo.stop();
  };

  return { api, stop, uri, log: () => log };
};

/** Create an account of the given role and sign in as it. */
export const signIn = async (api, { role = "admin", email, name = "Test User", password = "test-password-1" }) => {
  const { default: User } = await import("../../models/User.js");
  const { hashPassword } = await import("../../utils/password.js");

  const address = email || `${role}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const user = await User.create({
    name,
    email: address,
    password: hashPassword(password),
    role,
    status: "active",
  });

  // Which door this role signs in through. HR and Sales have panels of their
  // own, so their accounts cannot authenticate against /api/admin at all.
  const panel = {
    admin: "admin",
    super_admin: "admin",
    manager: "leader",
    operations_manager: "leader",
    employee: "employee",
    hr: "hr",
    hr_manager: "hr",
    sales: "sales",
    sales_exec: "sales",
  }[role];
  const { body } = await api.post(`/api/${panel}/login`, { email: address, password });

  if (!body?.token) throw new Error(`could not sign in as ${role}: ${JSON.stringify(body)}`);
  return { user, token: body.token };
};
