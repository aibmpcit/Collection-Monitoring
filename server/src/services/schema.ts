import { ensureAuditTable } from "./audit.js";
import { query } from "../config/db.js";
import { ensureRemarkAttachmentTable } from "./remarkAttachments.js";
import { ensureRemarkPhotoTable } from "./remarkPhotos.js";
import { ensureFieldEvidenceTables } from "./fieldEvidence.js";

// Idempotent structural upgrades for databases created from an older schema.mysql.sql.
// Runs from the migrate script and again at server start, so `npm start` alone is safe.

async function columnExists(tableName: string, columnName: string) {
  const result = await query<{ present: number }>(
    `SELECT COUNT(*) AS present FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return Number(result.rows[0]?.present ?? 0) > 0;
}

async function ensureIndex(tableName: string, indexName: string, columns: string) {
  const result = await query<{ present: number }>(
    `SELECT COUNT(*) AS present FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = $1 AND index_name = $2`,
    [tableName, indexName]
  );
  if (Number(result.rows[0]?.present ?? 0) === 0) {
    await query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columns})`);
  }
}

export async function ensureSchema() {
  await ensureAuditTable();
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(190) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB`);

  if (!(await columnExists("loans", "loan_balance"))) {
    await query("ALTER TABLE loans ADD COLUMN loan_balance DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER loan_amount");
  }
  if (!(await columnExists("loans", "total"))) {
    await query("ALTER TABLE loans ADD COLUMN total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER other_charges");
  }

  // Why and when a loan was closed: "not_in_import" (settled: missing from its branch's upload) or "deleted".
  if (!(await columnExists("loans", "closed_reason"))) {
    await query("ALTER TABLE loans ADD COLUMN closed_reason VARCHAR(16) NULL, ADD COLUMN closed_at DATETIME NULL");
  }

  // Payment type (partial / settled); the newest one is the loan's field status.
  if (!(await columnExists("collections", "payment_status"))) {
    await query("ALTER TABLE collections ADD COLUMN payment_status VARCHAR(16) NULL");
  }

  // One id per save attempt, so a double tap or a retry can't record the same payment twice.
  if (!(await columnExists("collections", "request_id"))) {
    await query("ALTER TABLE collections ADD COLUMN request_id VARCHAR(64) NULL, ADD UNIQUE KEY uq_collections_request (request_id)");
  }

  // Field status from the newest payment's type.
  if (!(await columnExists("loans", "action_status"))) {
    await query("ALTER TABLE loans ADD COLUMN action_status VARCHAR(16) NULL, ADD COLUMN action_status_at DATETIME NULL, ADD COLUMN action_status_by INT UNSIGNED NULL");
  }

  if (!(await columnExists("users", "permissions"))) {
    await query("ALTER TABLE users ADD COLUMN permissions JSON NULL");
  }
  // Incremented on password change so tokens issued before it stop working.
  if (!(await columnExists("users", "token_version"))) {
    await query("ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0");
  }
  const roleColumn = await query<{ column_type: string }>(
    `SELECT COLUMN_TYPE AS column_type FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role'`
  );
  if (roleColumn.rows[0] && !roleColumn.rows[0].column_type.includes("'las'")) {
    await query("ALTER TABLE users MODIFY COLUMN role ENUM('super_admin', 'branch_admin', 'staff', 'las') NOT NULL");
  }

  await ensureRemarkAttachmentTable();
  await ensureRemarkPhotoTable();
  await ensureFieldEvidenceTables();
  // Payment proof location became optional.
  const proofLatitude = await query<{ nullable: string }>(
    `SELECT is_nullable AS nullable FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'payment_proofs' AND column_name = 'latitude'`
  );
  if (proofLatitude.rows[0]?.nullable === "NO") {
    await query("ALTER TABLE payment_proofs MODIFY latitude DECIMAL(9,6) NULL, MODIFY longitude DECIMAL(9,6) NULL");
  }
  // "Add location" on remarks.
  for (const table of ["loan_remarks", "borrower_remarks"]) {
    if (!(await columnExists(table, "latitude"))) {
      await query(`ALTER TABLE ${table} ADD COLUMN latitude DECIMAL(9,6) NULL, ADD COLUMN longitude DECIMAL(9,6) NULL, ADD COLUMN location_accuracy INT UNSIGNED NULL`);
    }
  }
  // Barangay / town shown instead of raw coordinates.
  for (const table of ["loan_remarks", "borrower_remarks", "payment_proofs", "remark_photos"]) {
    if (!(await columnExists(table, "place_name"))) {
      await query(`ALTER TABLE ${table} ADD COLUMN place_name VARCHAR(160) NULL`);
    }
  }
  await query(`CREATE TABLE IF NOT EXISTS user_activity_daily (
    user_id INT UNSIGNED NOT NULL,
    day DATE NOT NULL,
    logins INT UNSIGNED NOT NULL DEFAULT 0,
    visits INT UNSIGNED NOT NULL DEFAULT 0,
    screen_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    last_seen_at DATETIME NULL,
    PRIMARY KEY (user_id, day), KEY idx_user_activity_day (day),
    CONSTRAINT fk_user_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  // Remarks are imported once per branch (first import); later uploads update loans only.
  await query(`CREATE TABLE IF NOT EXISTS branch_remark_imports (
  branch_id INT UNSIGNED NOT NULL,
  imported_by INT UNSIGNED NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks_imported INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id),
  CONSTRAINT fk_branch_remark_imports_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_branch_remark_imports_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB`);
  // One row per confirmed upload, for "data as of" and upload history.
  await query(`CREATE TABLE IF NOT EXISTS loan_import_runs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id INT UNSIGNED NOT NULL,
  uploaded_by INT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  file_name VARCHAR(255) NULL,
  rows_in_file INT UNSIGNED NOT NULL DEFAULT 0,
  inserted INT UNSIGNED NOT NULL DEFAULT 0,
  updated INT UNSIGNED NOT NULL DEFAULT 0,
  reopened INT UNSIGNED NOT NULL DEFAULT 0,
  closed INT UNSIGNED NOT NULL DEFAULT 0,
  skipped INT UNSIGNED NOT NULL DEFAULT 0,
  remarks_imported INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY idx_loan_import_runs_branch (branch_id, uploaded_at),
  CONSTRAINT fk_loan_import_runs_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_loan_import_runs_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB`);

  // Date-range reports and the loan list's newest-remarks lookup.
  await ensureIndex("collections", "idx_collections_collected_at", "collected_at");
  await ensureIndex("loan_remarks", "idx_loan_remarks_loan_created", "loan_id, created_at, id");
  await ensureIndex("loan_remarks", "idx_loan_remarks_created", "created_at");
  await ensureIndex("borrower_remarks", "idx_borrower_remarks_created", "created_at");
  await ensureIndex("loans", "idx_loans_status", "status");
  await ensureIndex("loans", "idx_loans_action_status", "action_status");
  await ensureIndex("loans", "idx_loans_closed", "status, closed_reason, closed_at");
}
