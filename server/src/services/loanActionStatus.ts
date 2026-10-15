import type { QueryClient } from "../config/db.js";
import { LOAN_ACTION_STATUSES } from "./access.js";

/**
 * Sets a loan's field status from its newest primary remark (Visited, Partial, Settled),
 * or clears it when none is left. Call after adding, editing or deleting a loan remark.
 */
export async function refreshLoanActionStatus(client: QueryClient, loanId: number) {
  const latest = await client.query<{ remark_category: string; created_at: string; created_by: number | null }>(
    `SELECT remark_category, created_at, created_by FROM loan_remarks
     WHERE loan_id = $1 AND remark_category IN ($2)
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [loanId, [...LOAN_ACTION_STATUSES]]
  );
  const row = latest.rows[0];
  await client.query(
    "UPDATE loans SET action_status = $1, action_status_at = $2, action_status_by = $3 WHERE id = $4",
    [row?.remark_category ?? null, row?.created_at ?? null, row?.created_by ?? null, loanId]
  );
}
