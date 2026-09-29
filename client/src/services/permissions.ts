import type { Permission, User } from "../types/models";

export const ACCOUNT_PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "import_collections", label: "Import collections" },
  { key: "add_remarks", label: "Add loan remarks" },
  { key: "add_payments", label: "Add loan payments" }
];

export function hasPermission(user: Pick<User, "role" | "permissions"> | null, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (typeof user.permissions?.[permission] === "boolean") return user.permissions[permission]!;
  if (permission === "import_collections") return user.role === "branch_admin";
  return user.role === "branch_admin" || user.role === "staff";
}
