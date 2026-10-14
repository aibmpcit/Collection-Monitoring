import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), user: { id: 3, role: "branch_admin", branchId: 2 } as JwtUser }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); }
}));
import { reportsRouter } from "../src/routes/reports.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(reportsRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.user = { id: 3, role: "branch_admin", branchId: 2 } as JwtUser;
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("reports summary", () => {
  it("scopes branch admins to their own branch even when another branch is requested", async () => {
    const response = await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30&branchId=9`);
    expect(response.status).toBe(200);
    const calls = mocks.query.mock.calls;
    expect(calls).toHaveLength(9);
    for (const [sql, params] of calls) {
      expect(sql).toContain("b.branch_id = $");
      expect(params).toContain(2);
      expect(params).not.toContain(9);
    }
  });

  it("lets super admins view all branches or filter one", async () => {
    mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
    await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30`);
    expect(mocks.query.mock.calls[0][0]).not.toContain("b.branch_id = $");
    mocks.query.mockClear();
    await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30&branchId=9`);
    expect(mocks.query.mock.calls[0][1]).toEqual(["2026-09-01", "2026-09-30", 9]);
  });

  it("rejects collectors and invalid date ranges", async () => {
    mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
    expect((await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30`)).status).toBe(403);
    mocks.user = { id: 3, role: "branch_admin", branchId: 2 } as JwtUser;
    expect((await fetch(`${base}/summary?from=2026-09-30&to=2026-09-01`)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("user activity report", () => {
  it("is limited to super admins", async () => {
    expect((await fetch(`${base}/users?from=2026-09-01&to=2026-09-30`)).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("filters users by branch and ranks totals", async () => {
    mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
    mocks.query.mockResolvedValueOnce({ rows: [
      { id: 4, username: "ana", role: "staff", branch_name: "Main", logins: 3, visits: 20, screen_seconds: 3600, last_seen_at: "2026-09-30 10:00:00", payments: 5, collected: 1500, remarks: 2 },
      { id: 5, username: "ben", role: "staff", branch_name: "Main", logins: null, visits: null, screen_seconds: null, last_seen_at: null, payments: null, collected: null, remarks: null }
    ] });
    const response = await fetch(`${base}/users?from=2026-09-01&to=2026-09-30&branchId=2`);
    const body = await response.json();
    expect(mocks.query.mock.calls[0][0]).toContain("WHERE u.branch_id = $3");
    expect(mocks.query.mock.calls[0][1]).toEqual(["2026-09-01", "2026-09-30", 2]);
    expect(body.totals).toEqual({ users: 2, byRole: { staff: 2 }, activeUsers: 1, logins: 3, visits: 20, screenSeconds: 3600 });
    expect(body.users[0]).toMatchObject({ username: "ana", actions: 7, collected: 1500 });
    expect(body.users[1]).toMatchObject({ username: "ben", actions: 0, lastSeenAt: null });
  });
});

describe("reports summary collector and PAR age", () => {
  it("filters collections and remarks by collector while keeping open loans branch-wide", async () => {
    mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
    await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30&branchId=9&collectorId=4`);
    const calls = mocks.query.mock.calls as [string, unknown[]][];
    const collectionCalls = calls.filter(([sql]) => sql.includes("FROM collections c"));
    expect(collectionCalls.length).toBeGreaterThan(0);
    for (const [sql, params] of collectionCalls) {
      expect(sql).toContain("AND b.branch_id = $3");
      expect(sql).toContain("AND c.created_by = $4");
      expect(params).toEqual(["2026-09-01", "2026-09-30", 9, 4]);
    }
    const remarkCall = calls.find(([sql]) => sql.includes("FROM loan_remarks r"))!;
    expect(remarkCall[0]).toContain("AND b.created_by = $4");
    const openLoans = calls.find(([sql]) => sql.includes("l.status != 'closed'"))!;
    expect(openLoans[0]).not.toContain("created_by");
    expect(openLoans[1]).toEqual([9]);
  });

  it("numbers the collector parameter correctly without a branch", async () => {
    mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
    await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30&collectorId=4`);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("AND c.created_by = $3");
    expect(params).toEqual(["2026-09-01", "2026-09-30", 4]);
  });

  it("returns every PAR age group with members collected and open members", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("AS bucket") && sql.includes("FROM collections c")) {
        return { rows: [{ bucket: "1-30", members: 3, payments: 4, amount: 900 }, { bucket: "over-365", members: 1, payments: 1, amount: 50 }] };
      }
      if (sql.includes("AS bucket")) return { rows: [{ bucket: "1-30", members: 10, loans: 12 }, { bucket: "current", members: 40, loans: 41 }] };
      return { rows: [] };
    });
    const body = await (await fetch(`${base}/summary?from=2026-09-01&to=2026-09-30`)).json();
    expect(body.byParAge.map((row: { bucket: string }) => row.bucket))
      .toEqual(["current", "1-30", "31-60", "61-90", "91-180", "181-365", "over-365"]);
    expect(body.byParAge[1]).toMatchObject({ membersCollected: 3, payments: 4, amount: 900, openMembers: 10, openLoans: 12 });
    expect(body.byParAge[0]).toMatchObject({ membersCollected: 0, openMembers: 40 });
    expect(body.byParAge[6]).toMatchObject({ membersCollected: 1, openMembers: 0 });
    const bucketSql = (mocks.query.mock.calls as [string][]).find(([sql]) => sql.includes("AS bucket"))![0];
    expect(bucketSql).toContain("WHEN l.par_age BETWEEN 1 AND 30 THEN '1-30'");
    expect(bucketSql).toContain("WHEN l.par_age >= 366 THEN 'over-365'");
  });
});
