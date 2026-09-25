import { closeDatabase, query, withTransaction } from "../config/db.js";

const RESET_MIGRATION = "20260925_reset_collection_data_for_revised_loan_schema";
const PAR_STATUS_MIGRATION = "20260925_derive_overdue_status_from_par_age";

async function columnExists(tableName: string, columnName: string) {
  const result = await query<{ present: number }>(
    `SELECT COUNT(*) AS present FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return Number(result.rows[0]?.present ?? 0) > 0;
}

async function ensureLoanColumns() {
  if (!(await columnExists("loans", "loan_balance"))) {
    await query("ALTER TABLE loans ADD COLUMN loan_balance DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER loan_amount");
  }
  if (!(await columnExists("loans", "total"))) {
    await query("ALTER TABLE loans ADD COLUMN total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER other_charges");
  }
}

async function run() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(190) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB`);

  await ensureLoanColumns();

  const parStatusApplied = await query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1 LIMIT 1", [PAR_STATUS_MIGRATION]);
  if (parStatusApplied.rowCount === 0) {
    await withTransaction(async client => {
      await client.query("UPDATE loans SET status = 'overdue' WHERE par_age > 0 AND status = 'active'");
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [PAR_STATUS_MIGRATION]);
    });
    console.log("Existing active loans with positive PAR age were marked overdue.");
  }

  if (process.env.RUN_DATA_RESET_MIGRATION !== "true") {
    console.log("Schema is current. Operational data reset was not requested.");
    return;
  }

  const applied = await query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1 LIMIT 1", [RESET_MIGRATION]);
  if (applied.rowCount > 0) {
    console.log("Operational data reset migration was already applied.");
    return;
  }

  await withTransaction(async client => {
    await client.query("DELETE FROM remark_attachments");
    await client.query("DELETE FROM collections");
    await client.query("DELETE FROM loan_remarks");
    await client.query("DELETE FROM borrower_remarks");
    await client.query("DELETE FROM loans");
    await client.query("DELETE FROM borrowers");
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [RESET_MIGRATION]);
  });

  console.log("Operational collection data was reset. Users and branches were retained.");
}

run()
  .catch(error => {
    console.error("Database migration failed", error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
