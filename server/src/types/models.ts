export type Role = "super_admin" | "branch_admin" | "staff";

export type LoanStatus = "active" | "closed" | "overdue";

export interface JwtUser {
  id: number;
  username: string;
  role: Role;
  branchId?: number | null;
}
