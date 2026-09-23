import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), user: { id: 7, role: "staff", branchId: 2 } as JwtUser }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query }));
vi.mock("../src/middleware/auth.js", () => ({
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); },
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next()
}));
import { collectionHistoryRouter } from "../src/routes/collectionHistory.js";
import { loanRouter } from "../src/routes/loans.js";
import { borrowerRouter } from "../src/routes/borrowers.js";
import { paymentRouter } from "../src/routes/payments.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(collectionHistoryRouter);
  app.use("/loans", loanRouter);
  app.use("/borrowers", borrowerRouter);
  app.use("/payments", paymentRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
  mocks.query.mockReset();
  mocks.query.mockResolvedValueOnce({ rows: [{ total: 1, amount: 150, payments: 1, members: 1 }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, kind: "payment" }] });
});

describe("collector history access and filters", () => {
  it.each([
    ["/loans/9/payments", "c.created_by"],
    ["/loans/9/remarks", "lr.created_by"],
    ["/borrowers/9/remarks", "br.created_by"]
  ])("limits collector records on %s even through direct URLs", async (path, actor) => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 9, branch_id: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect((await fetch(`${base}${path}?collectorId=8`)).status).toBe(200);
    expect(mocks.query.mock.calls[1][0]).toContain(`AND ${actor} = $2`);
    expect(mocks.query.mock.calls[1][1]).toEqual([9, 7]);
  });
  it("limits the general payments endpoint to the signed-in collector", async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect((await fetch(`${base}/payments`)).status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).toContain("WHERE b.branch_id = $1 AND c.created_by = $2");
    expect(mocks.query.mock.calls[0][1]).toEqual([2, 7]);
  });
  it("limits unfiltered manager history to their own branch's collectors", async () => {
    mocks.user.role = "branch_admin";
    expect((await fetch(base)).status).toBe(200);
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).toContain("a.branch_id = $1 AND u.role = 'staff' AND u.branch_id = $2");
      expect(params).toEqual([2, 2]);
    }
  });
  it("scopes both totals and records to the collector and branch", async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).toContain("a.branch_id = $1 AND a.collector_id = $2");
      expect(params).toEqual([2, 7]);
    }
  });
  it("rejects attempts to view another collector", async () => {
    expect((await fetch(`${base}?collectorId=8`)).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("keeps branch administrators scoped when filtering another collector", async () => {
    mocks.user.role = "branch_admin";
    expect((await fetch(`${base}?collectorId=8`)).status).toBe(200);
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(params).toEqual([2, 8, 2]);
      expect(sql).toContain("u.role = 'staff' AND u.branch_id = $3");
    }
  });
  it("allows super administrators to review across branches with inclusive end dates", async () => {
    mocks.user.role = "super_admin";
    await fetch(`${base}?from=2026-09-01&to=2026-09-22`);
    expect(mocks.query.mock.calls[0][0]).not.toContain("a.branch_id =");
    expect(mocks.query.mock.calls[0][0]).toContain("a.occurred_at < DATE_ADD($2, INTERVAL 1 DAY)");
    expect(mocks.query.mock.calls[0][1]).toEqual(["2026-09-01", "2026-09-22"]);
  });
  it.each(["payments", "remarks"])("paginates %s separately while retaining overall totals", async type => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ total: 45, amount: 150, payments: 21, members: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await fetch(`${base}?type=${type}&page=3`);
    const body = await response.json();
    expect(body.total).toBe(type === "payments" ? 21 : 24);
    expect(body.page).toBe(2);
    expect(body.summary.total).toBe(45);
    expect(mocks.query.mock.calls[1][0]).toContain(type === "payments" ? "AND a.kind = 'payment'" : "AND a.kind IN ('loan_remark', 'member_remark')");
    expect(mocks.query.mock.calls[1][0]).toContain("LIMIT 20 OFFSET 20");
    expect(mocks.query.mock.calls[1][1]).toEqual([2, 7]);
  });
  it.each(["from=2026-02-30", "from=2026-09-22&to=2026-09-01", "page=-1", "collectorId=abc", "type=invalid"])("rejects invalid filters: %s", async query => {
    expect((await fetch(`${base}?${query}`)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
