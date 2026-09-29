export type Role = "super_admin" | "branch_admin" | "staff" | "las";
export type Permission = "import_collections" | "add_remarks" | "add_payments";

export type LoanStatus = "active" | "closed" | "overdue";

export interface JwtUser {
  id: number;
  username: string;
  role: Role;
  branchId?: number | null;
  permissions?: Partial<Record<Permission, boolean>>;
}
