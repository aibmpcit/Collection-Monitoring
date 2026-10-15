import { closeDatabase, query, withTransaction } from "../config/db.js";
import { ensureSchema } from "../services/schema.js";

const RESET_MIGRATION = "20260925_reset_collection_data_for_revised_loan_schema";
const PAR_STATUS_MIGRATION = "20260925_derive_overdue_status_from_par_age";
const PAYMENT_STATUS_MIGRATION = "20261016_field_status_from_payments";

async function run() {
  await ensureSchema();

  const paymentStatusApplied = await query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1 LIMIT 1", [PAYMENT_STATUS_MIGRATION]);
  if (paymentStatusApplied.rowCount === 0) {
    await withTransaction(async client => {
      // Field status now comes from payments; statuses set by remarks earlier are cleared.
      await client.query("UPDATE loans SET action_status = NULL, action_status_at = NULL, action_status_by = NULL WHERE action_status IS NOT NULL");
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [PAYMENT_STATUS_MIGRATION]);
    });
  }

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
