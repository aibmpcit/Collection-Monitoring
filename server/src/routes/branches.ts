import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { branchAdminPassword, hashPassword, uniqueBranchAdminUsername, verifyPassword } from "../services/access.js";

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
      branch_admin_username: string | null;
    }>(
      `SELECT
         b.id,
         b.code,
         b.name,
         b.address,
         (
           SELECT u.username
           FROM users u
           WHERE u.branch_id = b.id AND u.role = 'branch_admin'
           ORDER BY u.id ASC
           LIMIT 1
         ) AS branch_admin_username
       FROM branches b
       ORDER BY b.name ASC`
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        address: row.address ?? "",
        branchAdminUsername: row.branch_admin_username ?? ""
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

    const payload = await withTransaction(async (client) => {
      const branchResult = await client.query<{ id: number }>(
        "INSERT INTO branches (code, name, address) VALUES ($1, $2, $3) RETURNING id",
        [parsed.data.code.trim().toUpperCase(), parsed.data.name.trim(), parsed.data.address.trim()]
      );

      const branchId = branchResult.rows[0].id;
      const username = await uniqueBranchAdminUsername(client, parsed.data.code, branchId);
      const plainPassword = branchAdminPassword(parsed.data.code, branchId);
      const passwordHash = await hashPassword(plainPassword);

      const adminResult = await client.query<{ id: number }>(
        "INSERT INTO users (username, password_hash, role, branch_id) VALUES ($1, $2, 'branch_admin', $3) RETURNING id",
        [username, passwordHash, branchId]
      );

      return {
        id: branchId,
        code: parsed.data.code.trim().toUpperCase(),
        name: parsed.data.name.trim(),
        address: parsed.data.address.trim(),
        branchAdmin: {
          id: adminResult.rows[0].id,
          username,
          password: plainPassword
        }
      };
    });

    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:branchId/admin-credentials", authenticate, authorize(["super_admin"]), async (req, res, next) => {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ message: "Invalid branch id" });
    }

    const branchResult = await query<{ id: number; code: string }>(
      "SELECT id, code FROM branches WHERE id = $1 LIMIT 1",
      [branchId]
    );
    const branch = branchResult.rows[0];
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const plainPassword = branchAdminPassword(branch.code, branchId);
    const accountResult = await query<{ id: number; username: string; password_hash: string }>(
      "SELECT id, username, password_hash FROM users WHERE branch_id = $1 AND role = 'branch_admin' ORDER BY id ASC LIMIT 1",
      [branchId]
    );

    const account = accountResult.rows[0];
    if (account) {
      const matches = await verifyPassword(plainPassword, account.password_hash);
      if (!matches) {
        const passwordHash = await hashPassword(plainPassword);
        await query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, account.id]);
      }

      return res.json({
        branchId,
        username: account.username,
        password: plainPassword
      });
    }

    const created = await withTransaction(async (client) => {
      const username = await uniqueBranchAdminUsername(client, branch.code, branchId);
      const passwordHash = await hashPassword(plainPassword);
      await client.query(
        "INSERT INTO users (username, password_hash, role, branch_id) VALUES ($1, $2, 'branch_admin', $3)",
        [username, passwordHash, branchId]
      );
      return username;
    });

    return res.status(201).json({
      branchId,
      username: created,
      password: plainPassword
    });
  } catch (error) {
    return next(error);
  }
});

export { router as branchRouter };
