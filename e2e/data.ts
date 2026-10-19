import { expect, type APIRequestContext } from "@playwright/test";
import { ADMIN } from "./helpers";
import { API_BASE } from "./ports";

// Test data created through the API before a test, so tests start from a known state quickly.
// Every name carries a unique tag, so tests never see each other's records.

export function uniqueTag() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function call<T>(request: APIRequestContext, token: string, method: "get" | "post", path: string, data?: unknown): Promise<T> {
  const response = await request[method](`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method.toUpperCase()} ${path} -> ${response.status()} ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}

export async function apiToken(request: APIRequestContext, account = ADMIN) {
  const response = await request.post(`${API_BASE}/auth/login`, { data: account });
  expect(response.ok(), "test admin can sign in through the API").toBe(true);
  return (await response.json()).token as string;
}

export async function createBranch(request: APIRequestContext, token: string, tag: string) {
  return call<{ id: number; code: string; name: string }>(request, token, "post", "/branches", { code: `E2E${tag}`.slice(0, 30), name: `E2E Branch ${tag}` });
}

export interface TestLoan {
  cifKey: string; loanAccountNo: string; memberName: string;
  loanType?: string; parAge?: number; total?: number; maturityDate?: string; dateRelease?: string;
}

/** Imports loans for a branch like a manager's upload. closeMissing settles the branch's loans that aren't listed. */
export async function importLoans(request: APIRequestContext, token: string, branchId: number, loans: TestLoan[], closeMissing = false) {
  const rows = loans.map((loan, index) => ({
    row: index + 2, cifKey: loan.cifKey, loanAccountNo: loan.loanAccountNo, memberName: loan.memberName,
    loanType: loan.loanType ?? "Salary Loan", dateRelease: loan.dateRelease ?? "2026-01-15", maturityDate: loan.maturityDate ?? "2027-01-15",
    loanAmount: 50000, loanBalance: 20000, principalDue: 5000, penaltyDue: 0, interest: 500,
    total: loan.total ?? 5500, parAge: loan.parAge ?? 0, address: "Barbaza, Antique"
  }));
  return call<{ inserted: number; updated: number; closed: number }>(request, token, "post", "/loans/bulk",
    { rows, branchId, closeMissing, fileName: "e2e.xlsx", rowsInFile: rows.length });
}

export async function loanIdFor(request: APIRequestContext, token: string, loanAccountNo: string) {
  const page = await call<{ items: Array<{ id: number; loanAccountNo: string }> }>(request, token, "get",
    `/loans?page=1&pageSize=5&search=${encodeURIComponent(loanAccountNo)}`);
  const loan = page.items.find(item => item.loanAccountNo === loanAccountNo);
  expect(loan, `loan ${loanAccountNo} exists`).toBeTruthy();
  return loan!.id;
}

export async function addActionTaken(request: APIRequestContext, token: string, loanId: number, remark: string, remarkCategory = "visited") {
  return call<{ id: number }>(request, token, "post", `/loans/${loanId}/remarks`, { remark, remarkCategory });
}

/** A collector ("staff") or LAS account in the branch; returns its sign-in details. */
export async function createAccount(request: APIRequestContext, token: string, branchId: number, role: "staff" | "las", tag: string) {
  const account = { username: `e2e-${role}-${tag}`.toLowerCase(), password: "E2e-Field-123" };
  await call(request, token, "post", "/staff", { ...account, branchId, role });
  return account;
}

/** A branch with three loans of different PAR ages, totals and maturities, all tagged. */
export async function seedBranch(request: APIRequestContext, tag = uniqueTag()) {
  const token = await apiToken(request);
  const branch = await createBranch(request, token, tag);
  const loans: TestLoan[] = [
    { cifKey: `C-${tag}-1`, loanAccountNo: `LN-${tag}-1`, memberName: `Ana Garcia ${tag}`, parAge: 45, total: 8000, maturityDate: "2026-09-30" },
    { cifKey: `C-${tag}-2`, loanAccountNo: `LN-${tag}-2`, memberName: `Ben Reyes ${tag}`, parAge: 120, total: 62000 },
    { cifKey: `C-${tag}-3`, loanAccountNo: `LN-${tag}-3`, memberName: `Cora Santos ${tag}`, parAge: 10, total: 15000, loanType: "Emergency Loan", dateRelease: "2026-03-10" }
  ];
  await importLoans(request, token, branch.id, loans);
  return { tag, token, branch, loans };
}
