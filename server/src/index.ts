import { app } from "./app.js";
import { ensureRemarkAttachmentTable } from "./services/remarkAttachments.js";
import { query } from "./config/db.js";

const port = Number(process.env.PORT ?? 4000);

async function ensureAccountColumns() {
  const result = await query<{ present: number }>(
    `SELECT COUNT(*) AS present FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'permissions'`
  );
  if (Number(result.rows[0]?.present ?? 0) === 0) {
    await query("ALTER TABLE users ADD COLUMN permissions JSON NULL");
  }
  const role = await query<{ column_type: string }>(
    `SELECT COLUMN_TYPE AS column_type FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role'`
  );
  if (role.rows[0] && !role.rows[0].column_type.includes("'las'")) {
    await query("ALTER TABLE users MODIFY COLUMN role ENUM('super_admin', 'branch_admin', 'staff', 'las') NOT NULL");
  }
}

ensureRemarkAttachmentTable()
  .then(() => ensureAccountColumns())
  .then(() => app.listen(port, () => console.log(`Server running at http://localhost:${port}`)))
  .catch(error => {
    console.error("Unable to initialize database", error);
    process.exit(1);
  });
