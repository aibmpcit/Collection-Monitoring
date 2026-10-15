import type { LoanPayload, Paged } from "../../types/models";

export interface LoanRow extends LoanPayload {
  id: number;
  branchId?: number;
  cifKey: string;
  memberName: string;
  contactInfo: string;
  address: string;
  importedAt: string;
  latestRemarks: Array<{ remark: string; remarkCategory: string }>;
  /** Type of the newest payment ("partial" or "settled"); null until a payment is recorded. */
  actionStatus?: string | null;
  actionStatusAt?: string | null;
  actionStatusBy?: string | null;
  /** "not_in_import" (settled) or "deleted", with when it happened; null for open loans. */
  closedReason?: string | null;
  closedAt?: string | null;
}

export interface PaymentRecordRow {
  paymentStatus?: string | null;
  id: number;
  paymentId: string;
  loanId: number;
  branchId?: number;
  loanAccountNo: string;
  cifKey: string;
  memberName: string;
  amount: number;
  orNo: string;
  collectedBy: string;
  collectedAt: string;
}

export interface RemarkRecordRow {
  id: number;
  kind: "loan_remark" | "member_remark";
  branch_id?: number;
  branch_name?: string | null;
  loan_id?: number | null;
  loan_account_no?: string | null;
  loan_type?: string | null;
  loan_status?: string | null;
  maturity_date?: string | null;
  member_id: number;
  member_name: string;
  cif_key?: string | null;
  contact_info?: string | null;
  address?: string | null;
  category?: string | null;
  remark: string;
  collector_name?: string | null;
  occurred_at: string;
  attachment_name?: string | null;
}

export interface RemarkGroupRow extends RemarkRecordRow {
  recentRemarks: RemarkRecordRow[];
}

export interface LoanQuickRef {
  id: number;
  loanAccountNo: string;
  memberName: string;
}

export interface LoanImportSkipRow {
  row: number;
  loanId: number;
  memberId: number;
  loanAccountNo: string;
  cifKey: string;
  reason: string;
}

export interface LoanListPage extends Paged<LoanRow> {
  loanTypes: string[];
  latestImportedAt: string;
  /** Latest confirmed upload for the branch in view (any branch for super admins viewing all). */
  lastImport?: { uploadedAt: string; fileName: string; uploadedBy: string; branch: string } | null;
}
