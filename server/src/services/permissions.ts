import type { JwtUser, Permission } from "../types/models.js";

export function parsePermissions(value: unknown): JwtUser["permissions"] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const result: NonNullable<JwtUser["permissions"]> = {};
    for (const key of ["import_collections", "add_remarks", "add_payments"] as const) {
      if (typeof parsed?.[key] === "boolean") result[key] = parsed[key];
    }
    return result;
  } catch { return {}; }
}

export function hasPermission(user: JwtUser, permission: Permission): boolean {
  if (user.role === "super_admin") return true;
  if (typeof user.permissions?.[permission] === "boolean") return user.permissions[permission]!;
  if (permission === "import_collections") return user.role === "branch_admin";
  return user.role === "branch_admin" || user.role === "staff";
}
