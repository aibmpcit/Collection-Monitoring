import { toNumber } from "./access.js";

/** Maps a `loans` row to the API shape shared by every loan endpoint. */
export function mapLoanRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    borrowerId: Number(row.borrower_id),
    loanAccountNo: String(row.loan_account_no ?? ""),
    loanType: String(row.loan_type ?? ""),
    dateRelease: String(row.date_release ?? row.due_date ?? ""),
    maturityDate: String(row.maturity_date ?? row.due_date ?? ""),
    loanAmount: toNumber(row.loan_amount ?? row.principal ?? 0),
    loanBalance: toNumber(row.loan_balance ?? 0),
    principalDue: toNumber(row.principal_due ?? row.principal ?? 0),
    penaltyDue: toNumber(row.penalty_due ?? row.penalty ?? 0),
    otherCharges: toNumber(row.other_charges ?? 0),
    total: toNumber(row.total ?? 0),
    parAge: Number(row.par_age ?? 0),
    notes: String(row.notes ?? ""),
    principal: toNumber(row.principal_due ?? row.principal ?? 0),
    interest: toNumber(row.interest ?? 0),
    penalty: toNumber(row.penalty_due ?? row.penalty ?? 0),
    dueDate: String(row.due_date ?? row.maturity_date ?? ""),
    status: String(row.status ?? "active"),
    importedAt: String(row.imported_at ?? row.created_at ?? "")
  };
}
