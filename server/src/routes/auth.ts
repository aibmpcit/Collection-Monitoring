import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requiredEnv } from "../config/env.js";
import { query } from "../config/db.js";
import { spendPasswordCheckTime, verifyPassword } from "../services/access.js";
import type { Role } from "../types/models.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { parsePermissions } from "../services/permissions.js";
import { recordActivity } from "../services/activity.js";
import { recordAudit } from "../services/audit.js";
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from "../services/loginLimiter.js";

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

    const username = parsed.data.username.trim();
    // req.ip is only a real visitor address when the proxy in front is trusted (TRUST_PROXY).
    const ip = req.app.get("trust proxy") ? req.ip : undefined;
    const retryAfter = loginRetryAfter(username, ip);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` });
    }

    const result = await query<{
      id: number;
      username: string;
      password_hash: string;
      role: Role;
      branch_id: number | null;
      branch_name: string | null;
      permissions: unknown;
      token_version: number | null;
    }>(
      `SELECT
         u.id,
         u.username,
         u.password_hash,
         u.role,
         u.permissions,
         u.token_version,
         u.branch_id,
         b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.username = $1
       LIMIT 1`,
      [username]
    );

    const user = result.rows[0];
    const matches = user ? await verifyPassword(parsed.data.password, user.password_hash) : (await spendPasswordCheckTime(parsed.data.password), false);
    if (!user || !matches) {
      recordLoginFailure(username, ip);
      // This failure reached the limit: someone may be guessing. Warn in the server log and audit it.
      if (loginRetryAfter(username, ip) > 0) {
        console.warn(`Sign-in locked for 15 minutes after repeated failures: username "${username.slice(0, 60)}"${ip ? ` from ${ip}` : ""}`);
        void recordAudit({ action: "auth.lockout", details: { username: username.slice(0, 120) }, ip: ip ?? req.socket.remoteAddress ?? null });
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }
    recordLoginSuccess(username);

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        branchId: user.branch_id,
        tokenVersion: Number(user.token_version ?? 0)
      },
      requiredEnv("JWT_SECRET"),
      { expiresIn: "8h" }
    );

    // Tracking must never block sign-in.
    await recordActivity(user.id, "login").catch(error => console.error("Unable to record login", error));

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        branchId: user.branch_id,
        branchName: user.branch_name,
        permissions: parsePermissions(user.permissions)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", authenticate, (req: AuthedRequest, res) => res.json(req.user));

export { router as authRouter };
