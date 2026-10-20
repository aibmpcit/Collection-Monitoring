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
import { errorResponse } from "../src/services/access.js";
import { loanRouter } from "../src/routes/loans.js";
import { borrowerRouter } from "../src/routes/borrowers.js";
import { paymentRouter } from "../src/routes/payments.js";

let server: Server;
let base: string;
let latestPayment: Array<Record<string, unknown>>;
const calls = () => mocks.query.mock.calls as [string, unknown[]][];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/loans", loanRouter);
  app.use("/borrowers", borrowerRouter);
  app.use("/payments", paymentRouter);
  // Same error handling as the real app, so thrown validation errors come back as JSON.
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const { status, message } = errorResponse(error);
    res.status(status).json({ message });
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
  latestPayment = [{ payment_status: "partial", collected_at: "2026-10-15 09:00:00", created_by: 7 }];
  const handle = async (sql: string) => {
    if (sql.includes("FROM loans l") && sql.includes("WHERE l.id = $1")) return { rows: [{ id: 9, branch_id: 2, borrower_id: 4 }], rowCount: 1 };
    if (sql.includes("created_by, b.branch_id")) return { rows: [{ created_by: 7, branch_id: 2, remark_category: "others" }], rowCount: 1 };
    if (sql.includes("payment_status IS NOT NULL")) return { rows: latestPayment, rowCount: latestPayment.length };
    if (sql.includes("SELECT loan_id FROM collections")) return { rows: [{ loan_id: 9 }], rowCount: 1 };
    if (sql.includes("SELECT branch_id FROM borrowers")) return { rows: [{ branch_id: 2 }], rowCount: 1 };
    return { rows: [{ id: 31 }], rowCount: 1 };
  };
  mocks.query.mockReset().mockImplementation(handle);
  mocks.transaction.mockReset().mockImplementation(handler => handler({ query: mocks.query }));
});

const post = (path: string, body: unknown, method = "POST") => fetch(`${base}${path}`, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});

const PROOF = {
  kind: "photo", name: "receipt.jpg", type: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
  latitude: 11.5841234, longitude: 122.5432109, accuracy: 9, placeName: "Brgy. Centro Norte, Culasi, Antique", capturedAt: "2026-10-15T09:00:00"
};

const ATTACHMENT = { name: "letter.pdf", type: "application/pdf", data: Buffer.from("pdf").toString("base64") };

describe("payment double-submit protection", () => {
  const body = { amount: 500, collectedAt: "2026-10-15T09:00", paymentStatus: "partial", proof: PROOF, requestId: "req-1234-abcd" };
  const savedRow = { id: 55, loan_id: 9, amount: 500, or_no: null, collected_at: "2026-10-15 09:00:00", payment_status: "partial", created_by: 7 };

  it("saves once; the same request again returns the saved payment without a second insert", async () => {
    let saved = false;
    const base = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("WHERE request_id = $1")) return { rows: saved ? [savedRow] : [], rowCount: saved ? 1 : 0 };
      if (sql.includes("INSERT INTO collections")) { saved = true; return { rows: [{ id: 55 }], rowCount: 1 }; }
      return base(sql, params);
    });
    const first = await post("/loans/9/payments", body);
    expect(first.status).toBe(201);
    expect(calls().find(([sql]) => sql.includes("INSERT INTO collections"))![1].at(-1)).toBe("req-1234-abcd");
    mocks.query.mockClear();
    const again = await post("/loans/9/payments", body);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: 55, paymentId: "PAY-000055", replayed: true });
    expect(calls().some(([sql]) => sql.includes("INSERT INTO collections"))).toBe(false);
  });

  it("refuses a request id that someone else already used", async () => {
    const base = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) =>
      sql.includes("WHERE request_id = $1") ? { rows: [{ ...savedRow, created_by: 99 }], rowCount: 1 } : base(sql, params));
    expect((await post("/loans/9/payments", body)).status).toBe(409);
    expect(calls().some(([sql]) => sql.includes("INSERT INTO collections"))).toBe(false);
  });
});

describe("loan status from payments", () => {
  it("records the payment type and sets the loan's status from the newest payment", async () => {
    const response = await post("/loans/9/payments", { amount: 500, orNo: "OR-1", collectedAt: "2026-10-15T09:00", paymentStatus: "partial", proof: PROOF });
    expect(response.status).toBe(201);
    const insert = calls().find(([sql]) => sql.includes("INSERT INTO collections"))!;
    expect(insert[1]).toEqual([9, 500, "OR-1", "2026-10-15 09:00:00", "partial", 7, null]);
    const proof = calls().find(([sql]) => sql.includes("INSERT INTO payment_proofs"))!;
    expect(proof[1][1]).toBe("photo");
    expect(proof[1].slice(5)).toEqual([11.584123, 122.543211, 9, "Brgy. Centro Norte, Culasi, Antique", "2026-10-15 09:00:00"]);
    const update = calls().find(([sql]) => sql.includes("UPDATE loans SET action_status"))!;
    expect(update[1]).toEqual(["partial", "2026-10-15 09:00:00", 7, 9]);
  });

  it("requires a payment type and proof with a location", async () => {
    const base = { amount: 100, collectedAt: "2026-10-15T09:00" };
    const noType = await post("/loans/9/payments", { ...base, proof: PROOF });
    expect(noType.status).toBe(400);
    expect((await noType.json()).message).toBe("Choose the payment type: partially paid or settled");
    expect((await post("/loans/9/payments", { ...base, paymentStatus: "visited", proof: PROOF })).status).toBe(400);
    const noProof = await post("/loans/9/payments", { ...base, paymentStatus: "settled" });
    expect((await noProof.json()).message).toBe("Add a photo or an attachment, with location, as proof of payment");
    const noLocation = await post("/loans/9/payments", { ...base, paymentStatus: "settled", proof: { ...PROOF, latitude: null, longitude: null } });
    expect(noLocation.status).toBe(400);
    expect((await noLocation.json()).message).toMatch(/needs a location/);
    const attachment = await post("/loans/9/payments", { ...base, paymentStatus: "settled", proof: { ...PROOF, kind: "attachment", name: "receipt.pdf", type: "application/pdf" } });
    expect(attachment.status).toBe(201);
  });

  it("lets remarks be saved without a photo, attachment or location (they are optional)", async () => {
    expect((await post("/loans/9/remarks", { remark: "Called the member", remarkCategory: "others" })).status).toBe(201);
    expect((await post("/loans/9/remarks", { remark: "At the house", remarkCategory: "visited", location: { latitude: 11.5, longitude: 122.5 } })).status).toBe(201);
    expect((await post("/loans/9/remarks/31", { remark: "x", remarkCategory: "visited", location: null }, "PATCH")).status).toBe(200);
  });

  it("saves a remark's location with its evidence", async () => {
    const response = await post("/loans/9/remarks", { remark: "At the member's house", remarkCategory: "visited", attachment: ATTACHMENT, location: { latitude: 11.5, longitude: 122.5, accuracy: 12 } });
    expect(response.status).toBe(201);
    const saved = calls().find(([sql]) => sql.includes("UPDATE loan_remarks SET latitude"))!;
    expect(saved[1]).toEqual([11.5, 122.5, 12, null, 31]);
    expect((await post("/loans/9/remarks", { remark: "x", location: { latitude: 200, longitude: 1 } })).status).toBe(400);
  });

  it("updates the status when a payment is edited, keeping its type if none is sent", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT c.created_by")) return { rows: [{ created_by: 7, branch_id: 2 }], rowCount: 1 };
      if (sql.includes("payment_status IS NOT NULL")) return { rows: [{ payment_status: "settled", collected_at: "2026-10-15 10:00:00", created_by: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await post("/loans/9/payments/5", { amount: 900, collectedAt: "2026-10-15T10:00", paymentStatus: "settled" }, "PATCH");
    const edit = calls().find(([sql]) => sql.includes("UPDATE collections"))!;
    expect(edit[1]).toEqual([900, null, "2026-10-15 10:00:00", "settled", 5]);
    expect(calls().find(([sql]) => sql.includes("UPDATE loans SET action_status"))![1][0]).toBe("settled");
    mocks.query.mockClear();
    await post("/loans/9/payments/5", { amount: 900, collectedAt: "2026-10-15T10:00" }, "PATCH");
    expect(calls().find(([sql]) => sql.includes("UPDATE collections"))![1][3]).toBeNull();
  });

  it("falls back to the previous payment's type when a payment is deleted", async () => {
    mocks.user = { id: 3, role: "branch_admin", branchId: 2 } as JwtUser;
    latestPayment = [];
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT b.branch_id")) return { rows: [{ branch_id: 2 }], rowCount: 1 };
      if (sql.includes("SELECT loan_id FROM collections")) return { rows: [{ loan_id: 9 }], rowCount: 1 };
      if (sql.includes("payment_status IS NOT NULL")) return { rows: latestPayment, rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    expect((await fetch(`${base}/payments/5`, { method: "DELETE" })).status).toBe(200);
    expect(calls().find(([sql]) => sql.includes("UPDATE loans SET action_status"))![1]).toEqual([null, null, null, 9]);
  });

  it("no longer sets a status from remarks; Visited is an ordinary remark", async () => {
    expect((await post("/loans/9/remarks", { remark: "", remarkCategory: "visited" })).status).toBe(400);
    expect((await post("/loans/9/remarks", { remark: "Talked to the member", remarkCategory: "visited", attachment: ATTACHMENT, location: { latitude: 11.5, longitude: 122.5 } })).status).toBe(201);
    expect(calls().find(([sql]) => sql.includes("INSERT INTO loan_remarks"))![1][2]).toBe("visited");
    expect(calls().some(([sql]) => sql.includes("UPDATE loans SET action_status"))).toBe(false);
  });

  it("filters the Collections list by payment status, including loans with no payment yet", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("COUNT(*)") ? { rows: [{ total: 0 }] } : { rows: [] });
    await fetch(`${base}/loans?page=1&actionStatus=settled`);
    expect(calls().find(([sql]) => sql.includes("COUNT(*)"))![0]).toContain("l.action_status = $2");
    mocks.query.mockClear();
    await fetch(`${base}/loans?page=1&actionStatus=none`);
    expect(calls().find(([sql]) => sql.includes("COUNT(*)"))![0]).toContain("l.action_status IS NULL");
    expect((await fetch(`${base}/loans?page=1&actionStatus=visited`)).status).toBe(400);
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

describe("active / overdue / closed label", () => {
  const loanBody = (parAge: number) => ({
    borrowerId: 4, loanAccountNo: "LN-50", loanType: "Salary", dateRelease: "2026-01-01", maturityDate: "2026-12-01",
    loanAmount: 1000, principalDue: 100, penaltyDue: 0, interest: 10, parAge, status: "closed"
  });

  it("is worked out from PAR age when a loan is created, ignoring any status sent", async () => {
    mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
    expect((await post("/loans", loanBody(5))).status).toBe(201);
    const insert = calls().find(([sql]) => sql.includes("INSERT INTO loans"))!;
    expect(insert[1].at(-1)).toBe("overdue");
    mocks.query.mockClear();
    await post("/loans", loanBody(0));
    expect(calls().find(([sql]) => sql.includes("INSERT INTO loans"))![1].at(-1)).toBe("active");
  });

  it("follows PAR age on edit, but a closed loan stays closed", async () => {
    mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
    const base = mocks.query.getMockImplementation()!;
    let stored = "active";
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) =>
      sql.startsWith("SELECT status FROM loans") ? { rows: [{ status: stored }], rowCount: 1 } : base(sql, params));
    await post("/loans/9", loanBody(0), "PATCH");
    expect(calls().find(([sql]) => sql.includes("UPDATE loans") && sql.includes("status = $17"))![1].at(-2)).toBe("active");
    mocks.query.mockClear();
    stored = "closed";
    await post("/loans/9", loanBody(30), "PATCH");
    expect(calls().find(([sql]) => sql.includes("UPDATE loans") && sql.includes("status = $17"))![1].at(-2)).toBe("closed");
  });
});
