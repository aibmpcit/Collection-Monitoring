import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import {
  assertBranchAccess,
  getRequestUser,
  hashPassword,
  isSuperAdmin,
  staffPassword,
  userBranchId,
  verifyPassword
} from "../services/access.js";

const router = Router();

const createStaffSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(8),
  branchId: z.coerce.number().int().positive()
});

const updateStaffSchema = z.object({
  branchId: z.coerce.number().int().positive()
});

router.get("/", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const where = isSuperAdmin(user) ? "WHERE u.role = 'staff'" : "WHERE u.role = 'staff' AND u.branch_id = $1";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
    }

    const result = await query<{
      id: number;
      username: string;
      role: "staff";
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
      return res.status(400).json({ message: "Username and password (min 8 chars) are required" });
    }

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
      "INSERT INTO users (username, password_hash, role, branch_id) VALUES ($1, $2, 'staff', $3) RETURNING id",
      [parsed.data.username.trim(), passwordHash, branchId]
    );

    return res.status(201).json({
      id: created.rows[0].id,
      username: parsed.data.username.trim(),
      role: "staff",
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
      return res.status(400).json({ message: "Valid branch is required" });
    }

    const branch = await query<{ id: number }>("SELECT id FROM branches WHERE id = $1 LIMIT 1", [parsed.data.branchId]);
    if (branch.rowCount === 0) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const target = await query<{ id: number; role: string }>("SELECT id, role FROM users WHERE id = $1 LIMIT 1", [targetUserId]);
    if (target.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    if (target.rows[0].role !== "staff") {
      return res.status(400).json({ message: "Only staff accounts can be edited here" });
    }

    await query("UPDATE users SET branch_id = $1 WHERE id = $2", [parsed.data.branchId, targetUserId]);
    return res.json({ message: "Account updated" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:userId/credentials", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const targetResult = await query<{
      id: number;
      username: string;
      role: string;
      password_hash: string;
      branch_id: number | null;
    }>(
      "SELECT id, username, role, password_hash, branch_id FROM users WHERE id = $1 LIMIT 1",
      [targetUserId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }
    if (target.role !== "staff") {
      return res.status(400).json({ message: "Only staff account credentials can be shown here" });
    }

    assertBranchAccess(user, Number(target.branch_id ?? 0));

    const plainPassword = staffPassword(target.username, target.id);
    const matches = await verifyPassword(plainPassword, target.password_hash);
    if (!matches) {
      const passwordHash = await hashPassword(plainPassword);
      await query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, target.id]);
    }

    return res.json({
      id: target.id,
      username: target.username,
      password: plainPassword
    });
  } catch (error) {
    return next(error);
  }
});

export { router as staffRouter };
