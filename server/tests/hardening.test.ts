import express from "express";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query }));
import { toBusinessDateTime } from "../src/config/time.js";
import { errorResponse } from "../src/services/access.js";
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess, resetLoginLimiter } from "../src/services/loginLimiter.js";
import { authRouter } from "../src/routes/auth.js";
import { authenticate } from "../src/middleware/auth.js";

describe("business time", () => {
  it("keeps wall-clock values from datetime-local inputs as typed", () => {
    expect(toBusinessDateTime("2026-10-01T07:30")).toBe("2026-10-01 07:30:00");
    expect(toBusinessDateTime("2026-10-01 07:30:15")).toBe("2026-10-01 07:30:15");
  });

  it("converts instants with a timezone into Philippine time", () => {
    expect(toBusinessDateTime("2026-09-30T23:30:00.000Z")).toBe("2026-10-01 07:30:00");
    expect(toBusinessDateTime("2026-10-01T07:30:00+08:00")).toBe("2026-10-01 07:30:00");
  });

  it("rejects values that are not dates", () => {
    expect(toBusinessDateTime("not a date")).toBeNull();
    expect(toBusinessDateTime("2026-13-45T10:00")).toBeNull();
  });
});

describe("error responses", () => {
  it("hides server fault details", () => {
    expect(errorResponse(new Error("ER_BAD_FIELD_ERROR: Unknown column 'x' in 'loans'"))).toEqual({ status: 500, message: "Internal server error" });
  });

  it("keeps messages written for users", () => {
    expect(errorResponse(Object.assign(new Error("Attachment must be 5 MB or smaller"), { status: 400 })))
      .toEqual({ status: 400, message: "Attachment must be 5 MB or smaller" });
  });

  it("turns duplicate keys into a clear conflict", () => {
    const duplicate = Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry 'ana' for key 'users.uq_users_username'" });
    expect(errorResponse(duplicate)).toEqual({ status: 409, message: "That username is already taken" });
  });
});

describe("login limiter", () => {
  beforeEach(() => resetLoginLimiter());

  it("locks a username after 10 failures from any address and unlocks after the window", () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) recordLoginFailure("Ana", `10.0.0.${attempt}`, now);
    expect(loginRetryAfter("ana", "10.9.9.9", now)).toBe(900);
    expect(loginRetryAfter("ana", "10.9.9.9", now + 15 * 60_000)).toBe(0);
  });

  it("ignores addresses when the client address is unknown", () => {
    for (let attempt = 0; attempt < 30; attempt += 1) recordLoginFailure(`user${attempt}`, undefined);
    expect(loginRetryAfter("someone-new", undefined)).toBe(0);
  });

  it("locks an address after 30 failures across usernames", () => {
    for (let attempt = 0; attempt < 30; attempt += 1) recordLoginFailure(`user${attempt}`, "10.0.0.1");
    expect(loginRetryAfter("someone-new", "10.0.0.1")).toBeGreaterThan(0);
    expect(loginRetryAfter("someone-new", "10.0.0.2")).toBe(0);
  });

  it("clears a username's failures after a successful sign-in", () => {
    for (let attempt = 0; attempt < 9; attempt += 1) recordLoginFailure("ana", "10.0.0.1");
    recordLoginSuccess("ana");
    recordLoginFailure("ana", "10.0.0.1");
    expect(loginRetryAfter("ana", "10.0.0.2")).toBe(0);
  });
});

describe("sign-in and token checks", () => {
  let server: Server;
  let base: string;
  let originalSecret: string | undefined;
  const hash = bcrypt.hashSync("correct-password", 4);

  beforeAll(async () => {
    originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-hardening-only";
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    app.get("/private", authenticate, (_req, res) => res.json({ ok: true }));
    server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  beforeEach(() => {
    resetLoginLimiter();
    mocks.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users u")) {
        return { rows: [{ id: 4, username: "ana", password_hash: hash, role: "staff", permissions: null, token_version: 2, branch_id: 1, branch_name: "Main" }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id, username, role, branch_id, permissions, token_version")) {
        return { rows: [{ id: 4, username: "ana", role: "staff", branch_id: 1, permissions: null, token_version: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  const login = (password: string) => fetch(`${base}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ana", password })
  });

  it("returns 429 once a username has too many failed attempts", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) expect((await login("wrong-password")).status).toBe(401);
    const blocked = await login("correct-password");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("issues tokens carrying the account's token version", async () => {
    const response = await login("correct-password");
    expect(response.status).toBe(200);
    const { token } = await response.json() as { token: string };
    expect((jwt.decode(token) as { tokenVersion: number }).tokenVersion).toBe(2);
    expect((await fetch(`${base}/private`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it("rejects tokens issued before the latest password change", async () => {
    const stale = jwt.sign({ id: 4, username: "ana", role: "staff", branchId: 1, tokenVersion: 1 }, process.env.JWT_SECRET!);
    const response = await fetch(`${base}/private`, { headers: { Authorization: `Bearer ${stale}` } });
    expect(response.status).toBe(401);
  });
});
