import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = Router();

const branchSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  address: z.string().trim().optional().default("")
});

router.get("/", authenticate, authorize(["super_admin", "branch_admin"]), async (_req, res, next) => {
  try {
    const result = await query<{
      id: number;
      code: string;
      name: string;
      address: string | null;
      branch_admin_count: number;
    }>(
      `SELECT
         b.id,
         b.code,
         b.name,
         b.address,
         COUNT(u.id)::int AS branch_admin_count
       FROM branches b
       LEFT JOIN users u
         ON u.branch_id = b.id
        AND u.role = 'branch_admin'
       GROUP BY b.id, b.code, b.name, b.address
       ORDER BY b.name ASC`
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        address: row.address ?? "",
        branchAdminCount: row.branch_admin_count
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/", authenticate, authorize(["super_admin"]), async (req, res, next) => {
  try {
    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Branch code and name are required" });
    }

    const result = await query<{ id: number; code: string; name: string; address: string | null }>(
      "INSERT INTO branches (code, name, address) VALUES ($1, $2, $3) RETURNING id, code, name, address",
      [parsed.data.code.trim().toUpperCase(), parsed.data.name.trim(), parsed.data.address.trim()]
    );

    const branch = result.rows[0];
    return res.status(201).json({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      address: branch.address ?? "",
      branchAdminCount: 0
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:branchId", authenticate, authorize(["super_admin"]), async (req, res, next) => {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ message: "Invalid branch id" });
    }

    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Branch code and name are required" });
    }

    const result = await query<{ id: number; code: string; name: string; address: string | null }>(
      `UPDATE branches
       SET code = $1, name = $2, address = $3
       WHERE id = $4
       RETURNING id, code, name, address`,
      [
        parsed.data.code.trim().toUpperCase(),
        parsed.data.name.trim(),
        parsed.data.address.trim(),
        branchId
      ]
    );

    const branch = result.rows[0];
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    return res.json({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      address: branch.address ?? ""
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:branchId", authenticate, authorize(["super_admin"]), async (req, res, next) => {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ message: "Invalid branch id" });
    }

    const existing = await query<{ id: number; name: string }>("SELECT id, name FROM branches WHERE id = $1 LIMIT 1", [branchId]);
    const branch = existing.rows[0];
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    await query("DELETE FROM branches WHERE id = $1", [branchId]);
    return res.json({ message: `Branch deleted: ${branch.name}` });
  } catch (error) {
    return next(error);
  }
});

export { router as branchRouter };
