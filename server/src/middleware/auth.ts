import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requiredEnv } from "../config/env.js";
import type { JwtUser, Permission, Role } from "../types/models.js";
import { query } from "../config/db.js";
import { hasPermission, parsePermissions } from "../services/permissions.js";

interface AuthedRequest extends Request {
  user?: JwtUser;
}

export async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication token missing" });
  }

  const token = authHeader.slice("Bearer ".length);

  let payload: JwtUser;
  try {
    payload = jwt.verify(token, requiredEnv("JWT_SECRET")) as JwtUser;
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
  try {
    const result = await query<{ id: number; username: string; role: Role; branch_id: number | null; permissions: unknown }>(
      "SELECT id, username, role, branch_id, permissions FROM users WHERE id = $1 LIMIT 1", [payload.id]
    );
    const current = result.rows[0];
    if (!current) return res.status(401).json({ message: "Account no longer exists" });
    req.user = { id: current.id, username: current.username, role: current.role, branchId: current.branch_id, permissions: parsePermissions(current.permissions) };
    return next();
  } catch (error) { return next(error); }
}

export function authorizePermission(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !hasPermission(req.user, permission)) return res.status(403).json({ message: "You do not have permission for this action" });
    next();
  };
}

export function authorize(roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

export type { AuthedRequest };
