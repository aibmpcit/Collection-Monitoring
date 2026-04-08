import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import type { AuthedRequest } from "../middleware/auth.js";
import type { JwtUser, Role } from "../types/models.js";

export const REMARK_CATEGORIES = new Set([
  "follow_up_collection",
  "with_small_claims",
  "partially_paid",
  "fully_paid",
  "rescheduled_payment",
  "sent_legal_notice",
  "promised_to_pay"
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

export function branchAdminPassword(branchCode: string, branchId: number): string {
  let base = branchCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!base) base = "BRANCH";
  return `${base.slice(0, 8)}@${String(branchId).padStart(4, "0")}!`;
}

export function staffPassword(username: string, userId: number): string {
  let base = username.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!base) base = "STAFF";
  return `${base.slice(0, 8)}@${String(userId).padStart(4, "0")}!`;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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

export async function uniqueBranchAdminUsername(client: PoolClient, branchCode: string, branchId: number): Promise<string> {
  let base = branchCode.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (!base) base = `branch${branchId}`;
  let candidate = `${base}_admin`;
  let suffix = 1;

  while (true) {
    const existing = await client.query<{ id: number }>("SELECT id FROM users WHERE username = $1 LIMIT 1", [candidate]);
    if (existing.rowCount === 0) {
      return candidate;
    }
    candidate = `${base}_admin${suffix}`;
    suffix += 1;
  }
}

export async function nextLoanAccountNo(client: PoolClient): Promise<string> {
  const latest = await client.query<{ loan_account_no: string }>(
    "SELECT loan_account_no FROM loans WHERE loan_account_no LIKE 'LAN-%' ORDER BY id DESC LIMIT 1"
  );
  const value = latest.rows[0]?.loan_account_no;
  const match = value?.match(/LAN-(\d+)/);
  const next = match ? Number(match[1]) + 1 : 1;
  return `LAN-${String(next).padStart(4, "0")}`;
}

export function errorResponse(error: unknown) {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status ?? 500;
    return {
      status,
      message: error.message || "Internal server error"
    };
  }

  return {
    status: 500,
    message: "Internal server error"
  };
}
