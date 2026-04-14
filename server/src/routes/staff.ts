import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import {
  getRequestUser,
  hashPassword,
  isSuperAdmin,
  userBranchId
} from "../services/access.js";

const router = Router();

const managedRoleSchema = z.enum(["staff", "branch_admin"]);

const createStaffSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(8),
  branchId: z.coerce.number().int().positive(),
  role: managedRoleSchema.optional()
});

const updateStaffSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  password: z.string().min(8).optional()
}).refine((data) => data.branchId !== undefined || data.password !== undefined, {
  message: "At least one change is required"
});

router.get("/", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const where = isSuperAdmin(user)
      ? "WHERE u.role IN ('staff', 'branch_admin')"
      : "WHERE u.role = 'staff' AND u.branch_id = $1";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
    }

    const result = await query<{
      id: number;
      username: string;
      role: "staff" | "branch_admin";
      branch_id: number | null;
      branch_name: string | null;
    }>(
      `SELECT
         u.id,
         u.username,
         u.role,
         u.branch_id,
         b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       ${where}
      ORDER BY u.username ASC`,
      params
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        role: row.role,
        branchId: row.branch_id,
        branchName: row.branch_name
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = createStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Username, password (min 8 chars), and branch are required" });
    }

    const role = isSuperAdmin(user) ? (parsed.data.role ?? "staff") : "staff";
    const branchId = isSuperAdmin(user) ? parsed.data.branchId : userBranchId(user);
    if (branchId <= 0) {
      return res.status(400).json({ message: "Branch is required" });
    }

    const branch = await query<{ id: number }>("SELECT id FROM branches WHERE id = $1 LIMIT 1", [branchId]);
    if (branch.rowCount === 0) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const created = await query<{ id: number }>(
      "INSERT INTO users (username, password_hash, role, branch_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [parsed.data.username.trim(), passwordHash, role, branchId]
    );

    return res.status(201).json({
      id: created.rows[0].id,
      username: parsed.data.username.trim(),
      role,
      branchId
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:userId", authenticate, authorize(["super_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (targetUserId === user.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    const targetResult = await query<{ id: number; role: string }>(
      "SELECT id, role FROM users WHERE id = $1 LIMIT 1",
      [targetUserId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!["branch_admin", "staff"].includes(target.role)) {
      return res.status(400).json({ message: "Only staff or branch admin accounts can be deleted" });
    }

    await query("DELETE FROM users WHERE id = $1", [targetUserId]);
    return res.json({ message: "Account deleted" });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:userId", authenticate, authorize(["super_admin"]), async (req, res, next) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const parsed = updateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Provide a valid branch or password (min 8 chars)" });
    }

    const target = await query<{ id: number; role: string }>("SELECT id, role FROM users WHERE id = $1 LIMIT 1", [targetUserId]);
    if (target.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!["staff", "branch_admin"].includes(target.rows[0].role)) {
      return res.status(400).json({ message: "Only staff or branch admin accounts can be edited here" });
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (parsed.data.branchId !== undefined) {
      const branch = await query<{ id: number }>("SELECT id FROM branches WHERE id = $1 LIMIT 1", [parsed.data.branchId]);
      if (branch.rowCount === 0) {
        return res.status(404).json({ message: "Branch not found" });
      }

      params.push(parsed.data.branchId);
      updates.push(`branch_id = $${params.length}`);
    }

    if (parsed.data.password) {
      const passwordHash = await hashPassword(parsed.data.password);
      params.push(passwordHash);
      updates.push(`password_hash = $${params.length}`);
    }

    params.push(targetUserId);
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
    return res.json({ message: "Account updated" });
  } catch (error) {
    return next(error);
  }
});

export { router as staffRouter };
