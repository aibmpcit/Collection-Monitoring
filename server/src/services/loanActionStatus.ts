import type { QueryClient } from "../config/db.js";

/**
 * Sets a loan's field status from its newest payment's type (partially paid or settled), or clears
 * it when the loan has no typed payment. Call after adding, editing or deleting a payment.
 */
export async function refreshLoanActionStatus(client: QueryClient, loanId: number) {
  const latest = await client.query<{ payment_status: string; collected_at: string; created_by: number | null }>(
    `SELECT payment_status, collected_at, created_by FROM collections
     WHERE loan_id = $1 AND payment_status IS NOT NULL
     ORDER BY collected_at DESC, id DESC LIMIT 1`,
    [loanId]
  );
  const row = latest.rows[0];
  await client.query(
    "UPDATE loans SET action_status = $1, action_status_at = $2, action_status_by = $3 WHERE id = $4",
    [row?.payment_status ?? null, row?.collected_at ?? null, row?.created_by ?? null, loanId]
  );
}
