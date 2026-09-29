import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), role: "super_admin", transaction: vi.fn() }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 1, role: mocks.role, branchId: 2 }; next(); },
  authorize: (roles: string[]) => (req: any, res: any, next: any) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
}));
import { loanRouter } from "../src/routes/loans.js";
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/loans", loanRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}/loans/remarks/import`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.role = "super_admin";
  mocks.query.mockReset();
  mocks.transaction.mockReset().mockImplementation(handler => handler({ query: mocks.query }));
});

const body = { branchId: 2, rows: [{ row: 2, loanAccountNo: "LN-001", remarks: [{ category: "personal_visit", description: "Visited member" }] }] };
const upload = (payload: unknown = body) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
it("imports category descriptions", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [{ id: 9 }] }).mockResolvedValue({ rows: [] });
  expect(await (await upload()).json()).toEqual({ imported: 1, remarksImported: 1, skipped: [] });
  expect(mocks.query).toHaveBeenNthCalledWith(2, "INSERT INTO loan_remarks (loan_id, remark_text, remark_category, created_by) VALUES ($1, $2, $3, $4)", [9, "Visited member", "personal_visit", 1]);
  expect(mocks.query.mock.calls[0][1]).toEqual(["LN-001", 2]);
});
it("allows repeated imports for the same loan", async () => {
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT l.id") ? [{ id: 9 }] : [] }));
  expect((await (await upload()).json()).remarksImported).toBe(1);
  expect((await (await upload()).json()).remarksImported).toBe(1);
  expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO loan_remarks"))).toHaveLength(2);
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("loan_remark_imports"))).toBe(false);
});
it("skips missing accounts", async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  expect((await (await upload()).json()).skipped[0].reason).toContain("not found");
});
it.each(["branch_admin", "staff"])("denies %s", async role => {
  mocks.role = role;
  expect((await upload()).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("rejects invalid categories before database writes", async () => {
  expect((await upload({ ...body, rows: [{ ...body.rows[0], remarks: [{ category: "bad", description: "text" }] }] })).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it("identifies accounts stored under another branch", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ code: "BR-003", name: "Other Branch" }] });
  const result = await (await upload()).json();
  expect(result.skipped[0].reason).toContain("LN-001: Account belongs to BR-003");
  expect(result.remarksImported).toBe(0);
});
