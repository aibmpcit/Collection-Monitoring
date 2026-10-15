import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), user: { id: 7, role: "staff", branchId: 2 } as JwtUser }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); }
}));
import { hasPermission } from "../src/services/permissions.js";
import { loanRouter } from "../src/routes/loans.js";
import { borrowerRouter } from "../src/routes/borrowers.js";

let server: Server;
let base: string;
let latestStatus: Array<Record<string, unknown>>;
let existingCategory: string;
const calls = () => mocks.query.mock.calls as [string, unknown[]][];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/loans", loanRouter);
  app.use("/borrowers", borrowerRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
  latestStatus = [{ remark_category: "visited", created_at: "2026-10-15 09:00:00", created_by: 7 }];
  existingCategory = "others";
  const handle = async (sql: string) => {
    if (sql.includes("FROM loans l") && sql.includes("WHERE l.id = $1")) return { rows: [{ id: 9, branch_id: 2, borrower_id: 4 }], rowCount: 1 };
    if (sql.includes("created_by, b.branch_id")) return { rows: [{ created_by: 7, branch_id: 2, remark_category: existingCategory }], rowCount: 1 };
    if (sql.includes("remark_category IN")) return { rows: latestStatus, rowCount: latestStatus.length };
    if (sql.includes("SELECT branch_id FROM borrowers")) return { rows: [{ branch_id: 2 }], rowCount: 1 };
    return { rows: [{ id: 31 }], rowCount: 1 };
  };
  mocks.query.mockReset().mockImplementation(handle);
  mocks.transaction.mockReset().mockImplementation(handler => handler({ query: mocks.query }));
});

const post = (path: string, body: unknown, method = "POST") => fetch(`${base}${path}`, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});

describe("loan status from primary remarks", () => {
  it("records a status without a note and sets the loan's status from the newest one", async () => {
    const response = await post("/loans/9/remarks", { remark: "", remarkCategory: "visited" });
    expect(response.status).toBe(201);
    const update = calls().find(([sql]) => sql.includes("UPDATE loans SET action_status"))!;
    expect(update[1]).toEqual(["visited", "2026-10-15 09:00:00", 7, 9]);
    const lookup = calls().find(([sql]) => sql.includes("remark_category IN"))!;
    expect(lookup[1]).toEqual([9, ["visited", "partial", "settled"]]);
  });

  it("still requires a note for ordinary remarks, and leaves the status alone", async () => {
    expect((await post("/loans/9/remarks", { remark: "", remarkCategory: "promised_to_pay" })).status).toBe(400);
    expect((await post("/loans/9/remarks", { remark: "Will pay Friday", remarkCategory: "promised_to_pay" })).status).toBe(201);
    expect(calls().some(([sql]) => sql.includes("UPDATE loans SET action_status"))).toBe(false);
  });

  it("falls back to the previous status when the latest status remark is deleted", async () => {
    existingCategory = "settled";
    latestStatus = [{ remark_category: "partial", created_at: "2026-10-14 10:00:00", created_by: 7 }];
    expect((await fetch(`${base}/loans/9/remarks/31`, { method: "DELETE" })).status).toBe(200);
    const update = calls().find(([sql]) => sql.includes("UPDATE loans SET action_status"))!;
    expect(update[1]).toEqual(["partial", "2026-10-14 10:00:00", 7, 9]);
  });

  it("clears the status when no status remark is left", async () => {
    existingCategory = "visited";
    latestStatus = [];
    await post("/loans/9/remarks/31", { remark: "Actually a follow-up", remarkCategory: "follow_up_collection" }, "PATCH");
    const update = calls().find(([sql]) => sql.includes("UPDATE loans SET action_status"))!;
    expect(update[1]).toEqual([null, null, null, 9]);
  });

  it("does not allow loan statuses on member remarks", async () => {
    const response = await post("/borrowers/4/remarks", { remark: "x", remarkCategory: "settled" });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Loan statuses can only be set on a loan");
  });

  it("filters the Collections list by status, including loans with no action yet", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("COUNT(*)") ? { rows: [{ total: 0 }] } : { rows: [] });
    await fetch(`${base}/loans?page=1&actionStatus=partial`);
    expect(calls().find(([sql]) => sql.includes("COUNT(*)"))![0]).toContain("l.action_status = $2");
    mocks.query.mockClear();
    await fetch(`${base}/loans?page=1&actionStatus=none`);
    expect(calls().find(([sql]) => sql.includes("COUNT(*)"))![0]).toContain("l.action_status IS NULL");
    expect((await fetch(`${base}/loans?page=1&actionStatus=paid`)).status).toBe(400);
    expect((await fetch(`${base}/loans?page=1&actionStatus=updated`)).status).toBe(400);
  });
});

describe("LAS field work", () => {
  it("can add remarks and payments by default, but not import", () => {
    const las = { id: 8, role: "las", branchId: 2 } as JwtUser;
    expect(hasPermission(las, "add_remarks")).toBe(true);
    expect(hasPermission(las, "add_payments")).toBe(true);
    expect(hasPermission(las, "import_collections")).toBe(false);
    expect(hasPermission({ ...las, permissions: { add_payments: false } }, "add_payments")).toBe(false);
  });

  it("can update only their own payments", async () => {
    mocks.user = { id: 8, role: "las", branchId: 2 } as JwtUser;
    mocks.query.mockImplementation(async (sql: string) => sql.includes("SELECT c.created_by")
      ? { rows: [{ created_by: 99, branch_id: 2 }], rowCount: 1 } : { rows: [], rowCount: 1 });
    const body = { amount: 100, collectedAt: "2026-10-15T08:00" };
    expect((await post("/loans/9/payments/5", body, "PATCH")).status).toBe(403);
    mocks.query.mockImplementation(async (sql: string) => sql.includes("SELECT c.created_by")
      ? { rows: [{ created_by: 8, branch_id: 2 }], rowCount: 1 } : { rows: [], rowCount: 1 });
    expect((await post("/loans/9/payments/5", body, "PATCH")).status).toBe(200);
  });
});
