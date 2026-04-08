import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "../config/db.js";
import { verifyPassword } from "../services/access.js";
import type { Role } from "../types/models.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

router.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid login payload" });
    }

    const result = await query<{
      id: number;
      username: string;
      password_hash: string;
      role: Role;
      branch_id: number | null;
      branch_name: string | null;
    }>(
      `SELECT
         u.id,
         u.username,
         u.password_hash,
         u.role,
         u.branch_id,
         b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.username = $1
       LIMIT 1`,
      [parsed.data.username.trim()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const matches = await verifyPassword(parsed.data.password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        branchId: user.branch_id
      },
      process.env.JWT_SECRET ?? "",
      { expiresIn: "8h" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        branchId: user.branch_id,
        branchName: user.branch_name
      }
    });
  } catch (error) {
    return next(error);
  }
});

export { router as authRouter };
