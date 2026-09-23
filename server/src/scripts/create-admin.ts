import { query } from "../config/db.js";
import { hashPassword } from "../services/access.js";

const username = process.env.ADMIN_USERNAME?.trim() || "admin";
const password = process.env.ADMIN_PASSWORD;

if (!password || password.length < 8) {
  throw new Error("Set ADMIN_PASSWORD to at least 8 characters before running create-admin");
}

const passwordHash = await hashPassword(password);
await query(
  `INSERT INTO users (username, password_hash, role, branch_id)
   VALUES ($1, $2, 'super_admin', NULL)
   ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'super_admin', branch_id = NULL`,
  [username, passwordHash]
);

console.log(`Local administrator '${username}' is ready.`);
process.exit(0);
