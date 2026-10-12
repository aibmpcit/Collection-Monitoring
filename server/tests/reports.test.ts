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
    expect(calls).toHaveLength(7);
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
