import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), role: "branch_admin", transaction: vi.fn() }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("../src/middleware/auth.js", () => ({
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
  base = `http://127.0.0.1:${address.port}/loans/remarks/bulk`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.role = "branch_admin";
  mocks.query.mockReset();
  mocks.transaction.mockReset().mockImplementation(handler => handler({ query: mocks.query }));
});
const remove = (ids: unknown[]) => fetch(base, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
it("deletes remarks and attachments once per id in a transaction", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [{ branch_id: 2 }] }).mockResolvedValue({ rows: [] });
  const result = await remove([4, 4]);
  expect(await result.json()).toEqual({ deleted: 1 });
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(mocks.query).toHaveBeenNthCalledWith(2, "DELETE FROM remark_attachments WHERE remark_kind = 'loan' AND remark_id = $1", [4]);
  expect(mocks.query).toHaveBeenNthCalledWith(3, "DELETE FROM loan_remarks WHERE id = $1", [4]);
});
it("rejects another branch without deleting", async () => {
  mocks.query.mockResolvedValue({ rows: [{ branch_id: 3 }] });
  expect((await remove([4])).status).toBe(403);
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it("rejects staff", async () => {
  mocks.role = "staff";
  expect((await remove([4])).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("rejects invalid ids", async () => {
  expect((await remove([0])).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
