import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
import { staffRouter } from "../src/routes/staff.js";
import { loanRouter } from "../src/routes/loans.js";
import { authenticate, authorizePermission } from "../src/middleware/auth.js";

let server: Server;
let base: string;
let current: JwtUser;
let writes: Array<{ sql: string; params: unknown[] }>;
let originalSecret: string | undefined;
beforeAll(async () => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-account-permissions-only";
  const app = express();
  app.use(express.json());
  app.use("/staff", staffRouter);
  app.use("/loans", loanRouter);
  app.get("/permission", authenticate, authorizePermission("import_collections"), (_req, res) => res.json({ ok: true }));
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
beforeEach(() => {
  current = { id: 1, username: "admin", role: "super_admin", branchId: null };
  writes = [];
  mocks.query.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT id, username, role, branch_id, permissions")) {
      return { rows: [{ ...current, branch_id: current.branchId, permissions: JSON.stringify(current.permissions ?? {}) }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id, role FROM users")) return { rows: [{ id: 2, role: "las" }], rowCount: 1 };
    if (sql.startsWith("SELECT id FROM branches")) return { rows: [{ id: 2 }], rowCount: 1 };
    writes.push({ sql, params });
    return { rows: [{ id: 2 }], rowCount: 1 };
  });
});
function request(path: string, method = "GET", body?: unknown, token?: string) {
  return fetch(base + path, { method, headers: { Authorization: `Bearer ${token ?? jwt.sign(current, process.env.JWT_SECRET!)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
it("lets a super admin change a managed role and grant per-account import permission", async () => {
  const response = await request("/staff/2", "PATCH", { role: "las", permissions: { import_collections: true } });
  expect(response.status).toBe(200);
  expect(writes[0].sql).toContain("role = $1, permissions = $2");
  expect(writes[0].params).toEqual(["las", '{"import_collections":true}', 2]);
});
it("creates LAS accounts with selected permissions", async () => {
  const response = await request("/staff", "POST", { username: "specialist", password: "example-password", branchId: 2, role: "las", permissions: { import_collections: true } });
  expect(response.status).toBe(201);
  expect(writes[0].params.slice(2)).toEqual(["las", 2, '{"import_collections":true}']);
});
it.each(["las", "staff", "branch_admin"] as const)("prevents %s from assigning account roles", async role => {
  current.role = role; current.branchId = 2;
  expect((await request("/staff/2", "PATCH", { role: "branch_admin" })).status).toBe(403);
  expect(writes).toHaveLength(0);
});
it("prevents a branch admin granting import permission during account creation", async () => {
  current.role = "branch_admin"; current.branchId = 2;
  expect((await request("/staff", "POST", { username: "collector", password: "example-password", branchId: 2, role: "staff", permissions: { import_collections: true } })).status).toBe(403);
  expect(writes).toHaveLength(0);
});
it("rejects unknown permissions and super-admin promotion", async () => {
  expect((await request("/staff/2", "PATCH", { permissions: { manage_accounts: true } })).status).toBe(400);
  expect((await request("/staff/2", "PATCH", { role: "super_admin" })).status).toBe(400);
});
it("checks current database permissions even when the token claims super-admin access", async () => {
  const token = jwt.sign(current, process.env.JWT_SECRET!);
  current.role = "las"; current.branchId = 2;
  expect((await request("/permission", "GET", undefined, token)).status).toBe(403);
  current.permissions = { import_collections: true };
  expect((await request("/permission", "GET", undefined, token)).status).toBe(200);
  current.permissions = { import_collections: false };
  expect((await request("/permission", "GET", undefined, token)).status).toBe(403);
});
it("guards collection imports and loan additions independently", async () => {
  current.role = "las"; current.branchId = 2;
  expect((await request("/loans/bulk", "POST", { rows: [] })).status).toBe(403);
  current.permissions = { import_collections: true };
  // Reaching payload validation proves access was granted for import only.
  expect((await request("/loans/bulk", "POST", { rows: [] })).status).toBe(400);
  expect((await request("/loans", "POST", {})).status).toBe(403);
  expect((await request("/loans/9/remarks", "POST", { remark: "note" })).status).toBe(403);
  expect((await request("/loans/9/payments", "POST", { amount: 10 })).status).toBe(403);
});

it("does not let an import-enabled LAS modify an existing loan in another branch", async () => {
  current = { id: 1, username: "specialist", role: "las", branchId: 2, permissions: { import_collections: true } };
  const transactionQuery = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("FROM borrowers")) return { rows: [{ id: 5, branch_id: 3, cif_key: "MC-005" }] };
    if (sql.includes("FROM loans")) return { rows: [{ id: 9, borrower_id: 5, branch_id: 3, cif_key: "MC-005", loan_account_no: "LN-009" }] };
    throw new Error("Unexpected write to another branch");
  });
  mocks.transaction.mockImplementationOnce(handler => handler({ query: transactionQuery }));
  const response = await request("/loans/bulk", "POST", { rows: [{ cifKey: "MC-005", loanAccountNo: "LN-009", branchId: 3 }] });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.updated).toBe(0);
  expect(result.inserted).toBe(0);
  expect(result.skippedRows[0].reason).toBe("matched_branch_forbidden");
  expect(transactionQuery.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
});
