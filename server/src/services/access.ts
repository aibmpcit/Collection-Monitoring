import bcrypt from "bcryptjs";
import type { QueryClient } from "../config/db.js";
import type { AuthedRequest } from "../middleware/auth.js";
import type { JwtUser, Role } from "../types/models.js";

export const IMPORT_REMARK_CATEGORIES = new Set([
"other_source_of_income",
"personal_visit",
"reminder_letter",
"demand_letter",
"branch_final_demand",
"branch_compromise_agreement",
"mediated",
"letter_for_non_compliance",
"atty_s_final_demand",
"attys_demand_for_blocked_atm",
"notice_for_co_makership",
"final_notice_for_small_claims",
"small_claims",
"bp22_estafa",
"foreclosed",
"endorsed_to_rmu",
]);

/**
 * Primary remarks (Visited, Partial, Settled): recording one sets the loan's field status (latest wins). Only loans that
 * collectors or LAS have acted on have a status.
 */
export const LOAN_ACTION_STATUSES = ["visited", "partial", "settled"] as const;
export type LoanActionStatus = typeof LOAN_ACTION_STATUSES[number];

export function isLoanActionStatus(value: string | null | undefined): value is LoanActionStatus {
  return (LOAN_ACTION_STATUSES as readonly string[]).includes(String(value ?? ""));
}

export const REMARK_CATEGORIES = new Set([
  ...LOAN_ACTION_STATUSES,
  ...IMPORT_REMARK_CATEGORIES,
  "follow_up_collection",
  "with_small_claims",
  "partially_paid",
  "fully_paid",
  "rescheduled_payment",
  "sent_legal_notice",
  "promised_to_pay",
  "others"
]);

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number(value ?? 0);
}

export function normalizePasswordHash(hash: string): string {
  return hash.replace(/^\$2y\$/, "$2a$");
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, normalizePasswordHash(hash));
}

export function formatPaymentId(id: number): string {
  return `PAY-${String(id).padStart(6, "0")}`;
}

export function normalizeRemarkCategory(category: string | undefined): string {
  const candidate = (category ?? "follow_up_collection").trim() || "follow_up_collection";
  return REMARK_CATEGORIES.has(candidate) ? candidate : "follow_up_collection";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Who may edit or delete a remark: super admins and branch admins may manage any remark in a
 * branch they can access (checked separately); collectors and LAS only the remarks they wrote.
 */
export function canManageRemark(user: JwtUser, authorId: number | null | undefined): boolean {
  if (user.role === "super_admin" || user.role === "branch_admin") return true;
  return authorId != null && Number(authorId) === user.id;
}

export function isSuperAdmin(user: JwtUser): boolean {
  return user.role === "super_admin";
}

export function userBranchId(user: JwtUser): number {
  return Number(user.branchId ?? 0);
}

export function requireRole(user: JwtUser | undefined, roles: Role[]) {
  return Boolean(user && roles.includes(user.role));
}

export function assertBranchAccess(user: JwtUser, resourceBranchId: number) {
  if (isSuperAdmin(user)) return;
  if (userBranchId(user) <= 0 || resourceBranchId <= 0 || userBranchId(user) !== resourceBranchId) {
    const error = new Error("Forbidden");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
}

export function getRequestUser(req: AuthedRequest): JwtUser {
  if (!req.user) {
    const error = new Error("Authentication token missing");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  return req.user;
}

export async function nextLoanAccountNo(client: QueryClient): Promise<string> {
  const latest = await client.query<{ loan_account_no: string }>(
    "SELECT loan_account_no FROM loans WHERE loan_account_no LIKE 'LAN-%' ORDER BY id DESC LIMIT 1"
  );
  const value = latest.rows[0]?.loan_account_no;
  const match = value?.match(/LAN-(\d+)/);
  const next = match ? Number(match[1]) + 1 : 1;
  return `LAN-${String(next).padStart(4, "0")}`;
}

const DUPLICATE_MESSAGES: Record<string, string> = {
  uq_users_username: "That username is already taken",
  uq_branches_code: "That branch code already exists",
  uq_loans_account: "That loan account number already exists",
  uq_borrowers_cif: "That member code already exists"
};

export function errorResponse(error: unknown) {
  const details = error as (Error & { status?: number; code?: string; sqlMessage?: string }) | undefined;
  if (details?.code === "ER_DUP_ENTRY") {
    const key = Object.keys(DUPLICATE_MESSAGES).find(name => details.sqlMessage?.includes(name));
    return { status: 409, message: key ? DUPLICATE_MESSAGES[key] : "That record already exists" };
  }
  const status = error instanceof Error ? details?.status ?? 500 : 500;
  // Server faults are logged, never shown: they can include SQL and schema details.
  if (status >= 500 || !(error instanceof Error)) {
    return { status, message: "Internal server error" };
  }
  return { status, message: error.message || "Request failed" };
}
