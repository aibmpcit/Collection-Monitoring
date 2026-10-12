import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = { id: 7, role: "staff", branchId: 2 } as JwtUser; next(); }
}));
import { activityRouter } from "../src/routes/activity.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(activityRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => { mocks.query.mockReset(); mocks.query.mockResolvedValue({ rows: [], rowCount: 1 }); });

describe("activity tracking", () => {
  it("records a visit for the signed-in user", async () => {
    expect((await fetch(`${base}/visit`, { method: "POST" })).status).toBe(200);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("visits = visits + 1");
    expect(params).toEqual([7, 0, 1, 0]);
  });

  it("only adds screen time when the previous heartbeat is old enough", async () => {
    expect((await fetch(`${base}/heartbeat`, { method: "POST" })).status).toBe(200);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/screen_seconds = screen_seconds \+ IF\(last_seen_at IS NULL OR last_seen_at <= NOW\(\) - INTERVAL 50 SECOND, 60, 0\)/);
    expect(sql.indexOf("screen_seconds = screen_seconds")).toBeLessThan(sql.lastIndexOf("last_seen_at = NOW()"));
    expect(params).toEqual([7, 0, 0, 60]);
  });
});
