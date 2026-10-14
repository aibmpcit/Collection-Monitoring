import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), user: { id: 1, role: "super_admin", branchId: null } as JwtUser }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); },
  authorizePermission: () => (_req: unknown, _res: unknown, next: () => void) => next()
}));
import { identifierKey } from "../src/services/identifiers.js";
import { loanRouter } from "../src/routes/loans.js";
import { borrowerRouter } from "../src/routes/borrowers.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/loans", loanRouter);
  app.use("/borrowers", borrowerRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const BRANCHES = [{ id: 2, code: "BR-2", name: "North" }, { id: 3, code: "BR-3", name: "South" }];
let borrowers: Array<Record<string, unknown>>;
let loans: Array<Record<string, unknown>>;
let writes: Array<{ sql: string; params: unknown[] }>;
let lookups: Array<{ sql: string; params: unknown[] }>;
let remarkLock: Array<Record<string, unknown>>;
let runs: Array<{ sql: string; params: unknown[] }>;

beforeEach(() => {
  mocks.user = { id: 1, role: "super_admin", branchId: null } as JwtUser;
  borrowers = [];
  loans = [];
  writes = [];
  lookups = [];
  remarkLock = [];
  runs = [];
  const handle = async (sql: string, params: unknown[] = []) => {
    if (sql.trim().startsWith("SELECT")) lookups.push({ sql, params });
    if (sql.includes("FROM branches")) return { rows: BRANCHES, rowCount: BRANCHES.length };
    if (sql.trim().startsWith("SELECT") && sql.includes("branch_remark_imports")) return { rows: remarkLock, rowCount: remarkLock.length };
    if (sql.includes("COUNT(*) AS total")) return { rows: [{ total: loans.filter(loan => loan.status !== "closed").length }], rowCount: 1 };
    if (sql.trim().startsWith("SELECT") && sql.includes("FROM loans") && sql.includes("l.status != 'closed'")) {
      const open = loans.filter(loan => loan.status !== "closed");
      return { rows: open, rowCount: open.length };
    }
    if (sql.trim().startsWith("SELECT") && sql.includes("FROM loans")) return { rows: loans, rowCount: loans.length };
    if (sql.trim().startsWith("SELECT") && sql.includes("FROM borrowers")) return { rows: borrowers, rowCount: borrowers.length };
    // The upload log is recorded separately from changes to loans and members.
    if (sql.includes("loan_import_runs")) { runs.push({ sql, params }); return { rows: [], rowCount: 1 }; }
    writes.push({ sql, params });
    return { rows: [{ id: 99 }], rowCount: 1 };
  };
  mocks.query.mockReset().mockImplementation(handle);
  mocks.transaction.mockReset().mockImplementation(handler => handler({ query: handle }));
});

const post = (path: string, rows: unknown[], extra: Record<string, unknown> = { branchId: 2 }) => fetch(`${base}${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows, ...extra })
});
const loanRow = (overrides: Record<string, unknown> = {}) => ({
  cifKey: "MC-1", loanAccountNo: "LN-1", memberName: "Ana Cruz", loanType: "Salary", dateRelease: "2026-01-01",
  maturityDate: "2026-12-01", loanAmount: 1000, principalDue: 100, penaltyDue: 0, interest: 10, parAge: 0, branchId: 2, ...overrides
});

describe("identifier matching", () => {
  it("ignores case and leading zeros on all-digit codes only", () => {
    expect(identifierKey("000123")).toBe("123");
    expect(identifierKey(" 0 ")).toBe("0");
    expect(identifierKey("MC-007")).toBe("mc-007");
    expect(identifierKey("00A1")).toBe("00a1");
  });
});

describe("collection import", () => {
  it("matches records saved without leading zeros and repairs them instead of duplicating", async () => {
    borrowers = [{ id: 5, branch_id: 2, cif_key: "123", member_name: "Ana Cruz", contact_info: "9171234567", address: "Poblacion" }];
    loans = [{ id: 9, borrower_id: 5, branch_id: 2, loan_account_no: "12345", cif_key: "123" }];
    const response = await post("/loans/bulk", [loanRow({ cifKey: "000123", loanAccountNo: "0012345", contactInfo: "09171234567", address: "Poblacion" })]);
    const body = await response.json();
    expect(body).toMatchObject({ inserted: 0, updated: 1, skipped: 0 });
    expect(writes.some(write => write.sql.includes("INSERT"))).toBe(false);
    const borrowerUpdate = writes.find(write => write.sql.includes("UPDATE borrowers"))!;
    expect(borrowerUpdate.params.slice(0, 1)).toEqual(["000123"]);
    expect(borrowerUpdate.params[3]).toBe("09171234567");
    const loanUpdate = writes.find(write => write.sql.includes("UPDATE loans"))!;
    expect(loanUpdate.params[1]).toBe("0012345");
  });

  it("looks up existing records by matching key", async () => {
    await post("/loans/bulk", [loanRow({ cifKey: "000123", loanAccountNo: "0012345" })]);
    const borrowerLookup = lookups.find(lookup => lookup.sql.includes("FROM borrowers") && lookup.sql.includes("TRIM(LEADING '0'"))!;
    expect(borrowerLookup.params).toEqual([[], ["123"]]);
    const loanLookup = lookups.find(lookup => lookup.sql.includes("FROM loans l") && lookup.sql.includes("TRIM(LEADING '0'"))!;
    expect(loanLookup.params).toEqual([[], ["12345"]]);
  });

  it("keeps a member's stored contact and address when the file leaves them blank", async () => {
    borrowers = [{ id: 5, branch_id: 2, cif_key: "MC-1", member_name: "Ana", contact_info: "09171234567", address: "Poblacion" }];
    loans = [{ id: 9, borrower_id: 5, branch_id: 2, loan_account_no: "LN-1", cif_key: "MC-1" }];
    const body = await (await post("/loans/bulk", [loanRow({ memberName: "Ana Cruz", contactInfo: "", address: "" })])).json();
    expect(body.updated).toBe(1);
    const borrowerUpdate = writes.find(write => write.sql.includes("UPDATE borrowers"))!;
    expect(borrowerUpdate.params).toEqual(["MC-1", 2, "Ana Cruz", "09171234567", "Poblacion", "Ana Cruz", "09171234567", expect.any(String), 5]);
  });

  it("still uses NA for a brand-new member with no address", async () => {
    const body = await (await post("/loans/bulk", [loanRow({ address: "" })])).json();
    expect(body.inserted).toBe(1);
    const borrowerInsert = writes.find(write => write.sql.includes("INSERT INTO borrowers"))!;
    expect(borrowerInsert.params[4]).toBe("NA");
  });

  it("skips a new loan whose member is registered in another branch", async () => {
    borrowers = [{ id: 5, branch_id: 3, cif_key: "MC-1", member_name: "Ana", contact_info: "", address: "South" }];
    const body = await (await post("/loans/bulk", [loanRow({ branchId: 2 })])).json();
    expect(body).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
    expect(body.skippedRows[0].reason).toBe("Member MC-1 belongs to BR-3 - South; import it under that branch");
    expect(writes).toHaveLength(0);
  });

  it("skips an existing loan when the file is imported for a different branch", async () => {
    borrowers = [{ id: 5, branch_id: 3, cif_key: "MC-1", member_name: "Ana", contact_info: "", address: "South" }];
    loans = [{ id: 9, borrower_id: 5, branch_id: 3, loan_account_no: "LN-1", cif_key: "MC-1" }];
    const body = await (await post("/loans/bulk", [loanRow({ branchId: 2 })])).json();
    expect(body.skippedRows[0].reason).toBe("Loan LN-1 belongs to BR-3 - South; import it under that branch");
    expect(writes).toHaveLength(0);
  });

  it("explains when an account number already belongs to a different member", async () => {
    borrowers = [{ id: 6, branch_id: 2, cif_key: "MC-9", member_name: "Ben", contact_info: "", address: "North" }];
    loans = [{ id: 9, borrower_id: 6, branch_id: 2, loan_account_no: "LN-1", cif_key: "MC-9" }];
    const body = await (await post("/loans/bulk", [loanRow()])).json();
    expect(body.skippedRows[0].reason).toBe("Loan LN-1 already belongs to member MC-9");
  });
});

describe("member import", () => {
  it("never moves a member from another branch into the importer's branch", async () => {
    mocks.user = { id: 4, role: "branch_admin", branchId: 2 } as JwtUser;
    borrowers = [{ id: 5, cif_key: "MC-1", branch_id: 3, contact_info: "0917", address: "South" }];
    const body = await (await post("/borrowers/bulk", [{ cifKey: "MC-1", memberName: "Ana Cruz", contactInfo: "0918", address: "North" }])).json();
    expect(body).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
    expect(body.skippedRows[0].reason).toBe("Member MC-1 belongs to BR-3 - South; import it under that branch");
    expect(writes).toHaveLength(0);
  });

  it("updates a same-branch member, repairing its code and keeping details the file leaves blank", async () => {
    mocks.user = { id: 4, role: "branch_admin", branchId: 2 } as JwtUser;
    borrowers = [{ id: 5, cif_key: "123", branch_id: 2, contact_info: "09171234567", address: "Poblacion" }];
    const body = await (await post("/borrowers/bulk", [{ cifKey: "000123", memberName: "Ana Cruz", contactInfo: "", address: "" }])).json();
    expect(body).toMatchObject({ inserted: 0, updated: 1, skipped: 0 });
    expect(writes[0].sql).toContain("UPDATE borrowers");
    expect(writes[0].params).toEqual(["000123", 2, "Ana Cruz", "09171234567", "Poblacion", "Ana Cruz", "09171234567", expect.any(String), 5]);
  });

  it("inserts members that do not exist yet", async () => {
    const body = await (await post("/borrowers/bulk", [{ cifKey: "MC-2", memberName: "Ben Reyes", contactInfo: "0918", address: "", branchId: 2 }])).json();
    expect(body).toMatchObject({ inserted: 1, updated: 0 });
    expect(writes[0].sql).toContain("INSERT INTO borrowers");
    expect(writes[0].params[4]).toBe("NA");
  });
});

describe("daily upload rules", () => {
  const branchLoans = () => {
    borrowers = [{ id: 5, branch_id: 2, cif_key: "MC-1", member_name: "Ana", contact_info: "", address: "North" }];
    loans = [
      { id: 1, borrower_id: 5, branch_id: 2, loan_account_no: "LN-1", cif_key: "MC-1", status: "active", member_name: "Ana" },
      { id: 2, borrower_id: 5, branch_id: 2, loan_account_no: "LN-2", cif_key: "MC-1", status: "overdue", member_name: "Ana" },
      { id: 3, borrower_id: 5, branch_id: 2, loan_account_no: "LN-3", cif_key: "MC-1", status: "closed", member_name: "Ana" }
    ];
  };

  it("requires a super admin to choose the file's branch", async () => {
    const response = await post("/loans/bulk", [loanRow()], {});
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Choose the branch this file belongs to");
  });

  it("lists loans missing from the file but leaves them open unless asked", async () => {
    branchLoans();
    const body = await (await post("/loans/bulk", [loanRow()])).json();
    expect(body).toMatchObject({ closeMissing: false, updated: 1, closed: 0, notInFile: 1, closedLoans: [{ loanAccountNo: "LN-2" }] });
    expect(writes.some(write => write.sql.includes("SET status = 'closed'"))).toBe(false);
  });

  it("closes open loans missing from the branch's file when asked, and logs the upload", async () => {
    branchLoans();
    const body = await (await post("/loans/bulk", [loanRow()], { branchId: 2, fileName: "altavas-oct15.xlsx", rowsInFile: 3, closeMissing: true })).json();
    expect(body).toMatchObject({ preview: false, updated: 1, closed: 1, notInFile: 1, openBefore: 2, closedLoans: [{ loanAccountNo: "LN-2", memberName: "Ana" }] });
    const close = writes.find(write => write.sql.includes("SET status = 'closed'"))!;
    expect(close.params).toEqual([[2]]);
    expect(runs).toHaveLength(1);
    expect(runs[0].params).toEqual([2, 1, "altavas-oct15.xlsx", 3, 0, 1, 0, 1, 0, 0]);
  });

  it("never closes a loan that is in the file, even when its row was skipped", async () => {
    branchLoans();
    const body = await (await post("/loans/bulk", [loanRow(), loanRow({ loanAccountNo: "LN-2", loanType: "" })], { branchId: 2, closeMissing: true })).json();
    expect(body).toMatchObject({ updated: 1, skipped: 1, closed: 0 });
    expect(writes.some(write => write.sql.includes("SET status = 'closed'"))).toBe(false);
  });

  it("closes nothing when no row could be saved", async () => {
    branchLoans();
    const body = await (await post("/loans/bulk", [loanRow({ cifKey: "" , loanAccountNo: "" })], { branchId: 2, closeMissing: true })).json();
    expect(body).toMatchObject({ inserted: 0, updated: 0, closed: 0 });
    expect(writes.some(write => write.sql.includes("SET status = 'closed'"))).toBe(false);
  });

  it("previews the result without keeping it", async () => {
    branchLoans();
    let rolledBack = false;
    mocks.transaction.mockImplementationOnce(async handler => {
      const handle = mocks.query.getMockImplementation()!;
      try { return await handler({ query: handle }); } catch (error) { rolledBack = true; throw error; }
    });
    const body = await (await post("/loans/bulk", [loanRow()], { branchId: 2, preview: true, closeMissing: true })).json();
    expect(body).toMatchObject({ preview: true, updated: 1, closed: 1 });
    expect(rolledBack).toBe(true);
    expect(runs).toHaveLength(0);
  });

  it("counts loans that come back after being closed", async () => {
    branchLoans();
    const body = await (await post("/loans/bulk", [loanRow(), loanRow({ loanAccountNo: "LN-3", parAge: 5 })])).json();
    expect(body).toMatchObject({ updated: 2, reopened: 1 });
  });

  it("reports the spreadsheet row and a plain reason for skipped rows", async () => {
    const body = await (await post("/loans/bulk", [loanRow({ row: 7, loanType: "" })])).json();
    expect(body.skippedRows[0]).toMatchObject({ row: 7, reason: "Loan product is missing or too short" });
  });
});

describe("first-import remarks (REMARK_IMPORT_ONCE=true)", () => {
  beforeEach(() => { process.env.REMARK_IMPORT_ONCE = "true"; });
  afterAll(() => { delete process.env.REMARK_IMPORT_ONCE; });
  const withRemarks = (overrides: Record<string, unknown> = {}) => loanRow({
    remarks: [{ category: "personal_visit", description: "Visited member" }, { category: "not_a_category", description: "x" }],
    ...overrides
  });

  it("imports remarks on a super admin's first import for the branch, then locks it", async () => {
    const body = await (await post("/loans/bulk", [withRemarks()])).json();
    expect(body).toMatchObject({ inserted: 1, remarksImported: 1, remarksInFile: 1, remarksNote: "" });
    const remark = writes.find(write => write.sql.includes("INSERT INTO loan_remarks"))!;
    expect(remark.params).toEqual([99, "Visited member", "personal_visit", 1]);
    const lock = writes.find(write => write.sql.includes("INSERT INTO branch_remark_imports"))!;
    expect(lock.params).toEqual([2, 1, 1]);
  });

  it("ignores remark columns once the branch's remarks were imported", async () => {
    remarkLock = [{ imported_at: "2026-10-01 08:00:00", username: "admin" }];
    const body = await (await post("/loans/bulk", [withRemarks()])).json();
    expect(body).toMatchObject({ inserted: 1, remarksImported: 0, remarksInFile: 1 });
    expect(body.remarksNote).toBe("Remarks for this branch were already imported on 2026-10-01 by admin; remark columns were ignored.");
    expect(writes.some(write => write.sql.includes("loan_remarks") || write.sql.includes("branch_remark_imports"))).toBe(false);
  });

  it("never imports remarks for branch admins", async () => {
    mocks.user = { id: 4, role: "branch_admin", branchId: 2 } as JwtUser;
    const body = await (await post("/loans/bulk", [withRemarks()], {})).json();
    expect(body).toMatchObject({ remarksImported: 0, remarksInFile: 1 });
    expect(body.remarksNote).toBe("Only a super admin can import remarks, on a branch's first import; remark columns were ignored.");
    expect(writes.some(write => write.sql.includes("loan_remarks"))).toBe(false);
  });
});

describe("upload history", () => {
  it("lists a branch admin's own branch uploads", async () => {
    mocks.user = { id: 4, role: "branch_admin", branchId: 2 } as JwtUser;
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 1, branch_id: 2, branch_code: "BR-2", branch_name: "North", uploaded_at: "2026-10-15 07:00:00", username: "mgr", file_name: "oct15.xlsx", rows_in_file: 10, inserted: 1, updated: 8, reopened: 0, closed: 2, skipped: 1, remarks_imported: 0 }] });
    const body = await (await fetch(`${base}/loans/imports?branchId=9`)).json();
    expect(body[0]).toMatchObject({ branch: "BR-2 - North", uploadedBy: "mgr", fileName: "oct15.xlsx", closed: 2 });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE r.branch_id = $1");
    expect(params).toEqual([2]);
  });
});

describe("testing phase: remarks on every import", () => {
  const withRemarks = () => loanRow({ remarks: [{ category: "personal_visit", description: "Visited member" }, { category: "demand_letter", description: "Sent letter" }] });

  it("imports remarks for any importer without locking the branch", async () => {
    mocks.user = { id: 4, role: "branch_admin", branchId: 2 } as JwtUser;
    const body = await (await post("/loans/bulk", [withRemarks()], {})).json();
    expect(body).toMatchObject({ remarksImported: 2, remarksDuplicate: 0, remarksNote: "" });
    expect(lookups.some(lookup => lookup.sql.includes("branch_remark_imports"))).toBe(false);
    expect(writes.some(write => write.sql.includes("branch_remark_imports"))).toBe(false);
  });

  it("skips remarks the loan already has, so re-importing a file adds nothing twice", async () => {
    borrowers = [{ id: 5, branch_id: 2, cif_key: "MC-1", member_name: "Ana Cruz", contact_info: "", address: "North" }];
    loans = [{ id: 9, borrower_id: 5, branch_id: 2, loan_account_no: "LN-1", cif_key: "MC-1", status: "active" }];
    const handle = mocks.query.getMockImplementation()!;
    const withStored = async (sql: string, params: unknown[] = []) => sql.includes("SELECT remark_category, remark_text FROM loan_remarks")
      ? { rows: [{ remark_category: "personal_visit", remark_text: "Visited member " }], rowCount: 1 }
      : handle(sql, params);
    mocks.transaction.mockImplementationOnce(handler => handler({ query: withStored }));
    const body = await (await post("/loans/bulk", [withRemarks()])).json();
    expect(body).toMatchObject({ updated: 1, remarksImported: 1, remarksDuplicate: 1 });
    expect(body.remarksNote).toBe("1 remark(s) were already in the system and were skipped.");
    const inserted = writes.filter(write => write.sql.includes("INSERT INTO loan_remarks"));
    expect(inserted.map(write => write.params[2])).toEqual(["demand_letter"]);
  });
});
