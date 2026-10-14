import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), user: { id: 7, role: "staff", branchId: 2 } as JwtUser, authorId: 7 }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); }
}));
import { canManageRemark } from "../src/services/access.js";
import { loanRouter } from "../src/routes/loans.js";
import { borrowerRouter } from "../src/routes/borrowers.js";

let server: Server;
let base: string;
let deletes: string[];
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
  deletes = [];
  mocks.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("created_by, b.branch_id")) return { rows: [{ created_by: mocks.authorId, branch_id: 2 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  mocks.transaction.mockReset().mockImplementation(handler => handler({
    query: async (sql: string) => { deletes.push(sql); return { rows: [], rowCount: 1 }; }
  }));
});

const as = (role: JwtUser["role"], id: number, authorId: number) => {
  mocks.user = { id, role, branchId: 2 } as JwtUser;
  mocks.authorId = authorId;
};
const send = (path: string, method: "PATCH" | "DELETE") => fetch(`${base}${path}`, {
  method, headers: { "content-type": "application/json" },
  body: method === "PATCH" ? JSON.stringify({ remark: "Updated note", remarkCategory: "others" }) : undefined
});

describe("canManageRemark", () => {
  it("lets admins manage any remark and others only their own", () => {
    expect(canManageRemark({ id: 1, role: "super_admin" } as JwtUser, 9)).toBe(true);
    expect(canManageRemark({ id: 2, role: "branch_admin" } as JwtUser, 9)).toBe(true);
    expect(canManageRemark({ id: 7, role: "staff" } as JwtUser, 7)).toBe(true);
    expect(canManageRemark({ id: 7, role: "staff" } as JwtUser, 9)).toBe(false);
    expect(canManageRemark({ id: 8, role: "las" } as JwtUser, 8)).toBe(true);
    expect(canManageRemark({ id: 8, role: "las" } as JwtUser, 9)).toBe(false);
    expect(canManageRemark({ id: 8, role: "las" } as JwtUser, null)).toBe(false);
  });
});

describe.each([
  ["loan", "/loans/9/remarks/11", "loan_remarks"],
  ["member", "/borrowers/9/remarks/11", "borrower_remarks"]
])("%s remarks", (_kind, path, table) => {
  it.each([["staff", 7], ["las", 8]] as const)("lets %s edit and delete their own remark", async (role, id) => {
    as(role, id, id);
    expect((await send(path, "PATCH")).status).toBe(200);
    expect((await send(path, "DELETE")).status).toBe(200);
    expect(deletes.some(sql => sql.includes(`DELETE FROM ${table}`))).toBe(true);
  });

  it.each([["staff", 7], ["las", 8]] as const)("stops %s editing or deleting someone else's remark", async (role, id) => {
    as(role, id, 99);
    expect((await send(path, "PATCH")).status).toBe(403);
    expect((await send(path, "DELETE")).status).toBe(403);
    expect(deletes).toHaveLength(0);
  });

  it("lets a branch manager edit and delete any remark in the branch", async () => {
    as("branch_admin", 4, 99);
    expect((await send(path, "PATCH")).status).toBe(200);
    expect((await send(path, "DELETE")).status).toBe(200);
    expect(deletes.some(sql => sql.includes("DELETE FROM remark_attachments"))).toBe(true);
  });
});
