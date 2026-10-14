import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), user: { id: 3, role: "branch_admin", branchId: 2 } as JwtUser }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); }
}));
import { loanRouter } from "../src/routes/loans.js";
import { paymentRouter } from "../src/routes/payments.js";
import { dashboardRouter } from "../src/routes/dashboard.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/loans", loanRouter);
  app.use("/payments", paymentRouter);
  app.use("/dashboard", dashboardRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.user = { id: 3, role: "branch_admin", branchId: 2 } as JwtUser;
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

const calls = () => mocks.query.mock.calls as [string, unknown[]][];

describe("paged loan list", () => {
  it("filters, counts and pages on the server, scoped to the branch admin's branch", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*) AS total")) return { rows: [{ total: 45 }] };
      if (sql.includes("WITH page_loans")) return { rows: [{ id: 7, borrower_id: 1, branch_id: 2, member_name: "Ana", latest_remark_1: "Called", latest_remark_category_1: "others" }] };
      if (sql.includes("DISTINCT TRIM(l.loan_type)")) return { rows: [{ loan_type: "Salary" }] };
      if (sql.includes("MAX(l.created_at)")) return { rows: [{ latest: "2026-10-01T09:00:00" }] };
      return { rows: [] };
    });
    const response = await fetch(`${base}/loans?page=2&pageSize=20&search=ana&loanType=Salary&parAge=1-30&branchId=9`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ total: 45, page: 2, pageSize: 20, loanTypes: ["Salary"], latestImportedAt: "2026-10-01T09:00:00" });
    expect(body.items[0]).toMatchObject({ id: 7, memberName: "Ana", latestRemarks: [{ remark: "Called", remarkCategory: "others" }] });

    const [countSql, countParams] = calls().find(([sql]) => sql.includes("COUNT(*) AS total"))!;
    expect(countSql).toContain("b.branch_id = $1");
    expect(countSql).toContain("l.status != 'closed'");
    expect(countSql).toContain("l.loan_type = $2");
    expect(countSql).toContain("l.par_age BETWEEN 1 AND 30");
    expect(countSql).toContain("LOCATE($3");
    expect(countParams).toEqual([2, "Salary", "ana"]);
    const pageSql = calls().find(([sql]) => sql.includes("WITH page_loans"))![0];
    expect(pageSql).toContain("LIMIT 20 OFFSET 20");
    expect(pageSql).toContain("lr.loan_id IN (SELECT id FROM page_loans)");
    // Filter options ignore the type/PAR/search filters so other choices stay available.
    expect(calls().find(([sql]) => sql.includes("DISTINCT TRIM(l.loan_type)"))![1]).toEqual([2]);
  });

  it("clamps a page past the end to the last page", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("COUNT(*)") ? { rows: [{ total: 5 }] } : { rows: [] });
    const body = await (await fetch(`${base}/loans?page=9&pageSize=10`)).json();
    expect(body.page).toBe(1);
    expect(calls().find(([sql]) => sql.includes("WITH page_loans"))![0]).toContain("LIMIT 10 OFFSET 0");
  });

  it("returns every matching id for select-all", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 4 }, { id: 9 }] });
    const body = await (await fetch(`${base}/loans?idsOnly=true&parAge=over-365`)).json();
    expect(body).toEqual({ ids: [4, 9] });
    expect(calls()[0][0]).toContain("l.par_age >= 366");
    expect(calls()).toHaveLength(1);
  });

  it("returns one member's loans in every status without paging", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 1, borrower_id: 5, status: "closed" }] });
    const body = await (await fetch(`${base}/loans?borrowerId=5`)).json();
    expect(Array.isArray(body)).toBe(true);
    const [sql, params] = calls()[0];
    expect(sql).toContain("l.borrower_id = $2");
    expect(sql).not.toContain("l.status != 'closed'");
    expect(sql).not.toContain("LIMIT");
    expect(params).toEqual([2, 5]);
  });

  it("rejects unknown PAR groups", async () => {
    expect((await fetch(`${base}/loans?page=1&parAge=1-1000`)).status).toBe(400);
  });
});

describe("due soon", () => {
  it("pages open loans maturing today or later, soonest first", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ total: 9 }] };
      return { rows: [{ id: 3, borrower_id: 1, member_name: "Ben", days_until_due: 2, outstanding: 1500 }] };
    });
    const body = await (await fetch(`${base}/loans/due-soon?page=2&pageSize=8`)).json();
    expect(body).toMatchObject({ total: 9, page: 2, pageSize: 8 });
    expect(body.items[0]).toMatchObject({ id: 3, memberName: "Ben", daysUntilDue: 2, outstanding: 1500 });
    const pageSql = calls()[1][0];
    expect(pageSql).toContain("COALESCE(l.maturity_date, l.due_date) >= CURRENT_DATE");
    expect(pageSql).toContain("ORDER BY days_until_due ASC, outstanding DESC");
    expect(pageSql).toContain("LIMIT 8 OFFSET 8");
    expect(calls()[1][1]).toEqual([2]);
  });
});

describe("remarks tab", () => {
  it("groups the two newest remarks per loan and only accepts known categories", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
      if (sql.includes("ROW_NUMBER()")) {
        return { rows: [
          { id: 11, loan_id: 7, remark_text: "Older", remark_category: "others", created_at: "2026-10-01 08:00:00", collector_name: "ana", position: 2 },
          { id: 12, loan_id: 7, remark_text: "Newest", remark_category: "personal_visit", created_at: "2026-10-02 08:00:00", collector_name: "ana", position: 1 }
        ] };
      }
      return { rows: [{ id: 7, branch_id: 2, loan_account_no: "LN-7", loan_type: "Salary", status: "overdue", borrower_id: 5, member_name: "Ana" }] };
    });
    const body = await (await fetch(`${base}/loans/remarked?page=1&pageSize=10&search=visit&categories=personal_visit,drop_tables`)).json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: 12, loan_id: 7, remark: "Newest", member_name: "Ana", loan_status: "overdue" });
    expect(body.items[0].recentRemarks.map((remark: { id: number }) => remark.id)).toEqual([12, 11]);
    const [countSql, countParams] = calls()[0];
    expect(countSql).toContain("r.remark_category IN ($3)");
    expect(countParams).toEqual([2, "visit", ["personal_visit"]]);
  });

  it("looks up every remark id on the selected loans within the branch", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const response = await fetch(`${base}/loans/remarked/remark-ids`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loanIds: [7, 8] })
    });
    expect(await response.json()).toEqual({ ids: [1, 2] });
    expect(calls()[0][0]).toContain("AND b.branch_id = $2");
    expect(calls()[0][1]).toEqual([[7, 8], 2]);
  });

  it("does not let collectors look up remark ids for deletion", async () => {
    mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
    const response = await fetch(`${base}/loans/remarked/remark-ids`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loanIds: [7] })
    });
    expect(response.status).toBe(403);
  });
});

describe("paged payments", () => {
  it("keeps collectors to their own payments and supports the dashboard's recent list", async () => {
    mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
    mocks.query.mockImplementation(async (sql: string) => sql.includes("COUNT(*)") ? { rows: [{ total: 3 }] } : { rows: [] });
    const body = await (await fetch(`${base}/payments?page=1&pageSize=7&sort=recent&openLoansOnly=true`)).json();
    expect(body).toMatchObject({ items: [], total: 3, page: 1, pageSize: 7 });
    const [sql, params] = calls()[1];
    expect(sql).toContain("b.branch_id = $1 AND c.created_by = $2 AND l.status != 'closed'");
    expect(sql).toContain("ORDER BY c.collected_at DESC, c.id DESC LIMIT 7 OFFSET 0");
    expect(params).toEqual([2, 7]);
  });

  it("searches payment numbers and returns ids for select-all", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const body = await (await fetch(`${base}/payments?idsOnly=true&search=PAY-000005`)).json();
    expect(body).toEqual({ ids: [5] });
    expect(calls()[0][0]).toContain("CONCAT('PAY-', LPAD(c.id, 6, '0'))");
  });

  it("returns one member's payments as a plain list", async () => {
    await fetch(`${base}/payments?borrowerId=5`);
    expect(calls()[0][0]).toContain("l.borrower_id = $2");
    expect(calls()[0][0]).not.toContain("LIMIT");
  });
});

describe("dashboard metrics", () => {
  it("includes active and overdue loan counts", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("active_loans")
      ? { rows: [{ total_portfolio: 100, total_overdue: 40, active_loans: 6, overdue_loans: 2 }] }
      : { rows: [{ total: 10 }] });
    const body = await (await fetch(`${base}/dashboard/metrics`)).json();
    expect(body).toMatchObject({ activeLoans: 6, overdueLoans: 2, totalPortfolio: 100, collectionsToday: 10 });
  });
});
