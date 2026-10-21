import { getRemarkCategoryLabel, paymentStatusLabel } from "../../constants/remarkCategories";
import { plainDate, plainDateTime, type ExportColumn } from "../../services/tableExport";
import type { LoanRow, PaymentRecordRow } from "./types";

// Columns for the Collection Records exports (Excel and PDF).

const status = (value: string | null | undefined) => value ? paymentStatusLabel(value) : "No payment yet";

export const LOAN_EXPORT_COLUMNS: ExportColumn<LoanRow>[] = [
  { label: "Member Code", value: row => row.cifKey, width: 1 },
  { label: "Member Name", value: row => row.memberName, width: 1.6 },
  { label: "Loan Account", value: row => row.loanAccountNo, width: 1.1 },
  { label: "Loan Type", value: row => row.loanType, width: 1.1 },
  { label: "Status", value: row => status(row.actionStatus), width: 1 },
  { label: "Maturity", value: row => plainDate(row.maturityDate), width: 0.9 },
  { label: "PAR Age", value: row => row.parAge, width: 0.6 },
  { label: "Loan Balance", value: row => row.loanBalance, width: 1.1, money: true },
  { label: "Total Due", value: row => row.total, width: 1.1, money: true },
  { label: "Latest Action Taken", value: row => row.latestRemarks[0] ? `${getRemarkCategoryLabel(row.latestRemarks[0].remarkCategory)}: ${row.latestRemarks[0].remark}` : "", width: 2 },
  { label: "Contact", value: row => row.contactInfo, width: 1 },
  { label: "Address", value: row => row.address, width: 1.5 }
];

export const SETTLED_EXPORT_COLUMNS: ExportColumn<LoanRow>[] = [
  { label: "Member Code", value: row => row.cifKey },
  { label: "Member Name", value: row => row.memberName, width: 1.6 },
  { label: "Loan Account", value: row => row.loanAccountNo, width: 1.1 },
  { label: "Loan Type", value: row => row.loanType, width: 1.1 },
  { label: "Last Payment", value: row => status(row.actionStatus) },
  { label: "Settled On", value: row => plainDateTime(row.closedAt), width: 1.1 },
  { label: "Loan Balance", value: row => row.loanBalance, width: 1.1, money: true },
  { label: "Total Due", value: row => row.total, width: 1.1, money: true }
];

export const PAYMENT_EXPORT_COLUMNS: ExportColumn<PaymentRecordRow>[] = [
  { label: "Payment ID", value: row => row.paymentId },
  { label: "Date", value: row => plainDateTime(row.collectedAt), width: 1.1 },
  { label: "Member Code", value: row => row.cifKey },
  { label: "Member Name", value: row => row.memberName, width: 1.6 },
  { label: "Loan Account", value: row => row.loanAccountNo, width: 1.1 },
  { label: "Payment Type", value: row => status(row.paymentStatus) },
  { label: "Amount", value: row => row.amount, width: 1.1, money: true },
  { label: "OR Number", value: row => row.orNo },
  { label: "Collected By", value: row => row.collectedBy }
];

/** One action taken, as returned by /loans/remarked?export=true. */
export interface ActionTakenExportRow {
  id: number; occurredAt: string; category: string; remark: string; recordedBy: string;
  loanAccountNo: string; loanType: string; cifKey: string; memberName: string; branchName: string;
}

export const ACTION_TAKEN_EXPORT_COLUMNS: ExportColumn<ActionTakenExportRow>[] = [
  { label: "Date", value: row => row.occurredAt, width: 1.1 },
  { label: "Member Code", value: row => row.cifKey },
  { label: "Member Name", value: row => row.memberName, width: 1.5 },
  { label: "Loan Account", value: row => row.loanAccountNo, width: 1.1 },
  { label: "Loan Type", value: row => row.loanType },
  { label: "Category", value: row => getRemarkCategoryLabel(row.category), width: 1.2 },
  { label: "Action Taken", value: row => row.remark, width: 2.6 },
  { label: "Recorded By", value: row => row.recordedBy },
  { label: "Branch", value: row => row.branchName }
];
