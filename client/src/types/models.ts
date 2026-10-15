export type Role = "super_admin" | "branch_admin" | "staff" | "las";
export type Permission = "import_collections" | "add_remarks" | "add_payments";

export interface User {
  id: number;
  username: string;
  role: Role;
  branchId?: number | null;
  branchName?: string | null;
  permissions?: Partial<Record<Permission, boolean>>;
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  address: string;
  branchAdminCount?: number;
}

export interface Loan {
  id: number;
  borrowerId: number;
  loanAccountNo: string;
  loanType: string;
  dateRelease: string;
  maturityDate: string;
  loanAmount: number;
  loanBalance: number;
  principalDue: number;
  penaltyDue: number;
  otherCharges: number;
  total: number;
  parAge: number;
  principal: number;
  interest: number;
  penalty: number;
  dueDate: string;
  status: "active" | "closed" | "overdue";
  /** Type of the newest payment ("partial" or "settled"); null until a payment is recorded. */
  actionStatus?: string | null;
  actionStatusAt?: string | null;
  actionStatusBy?: string | null;
  notes?: string;
}

export interface Borrower {
  id: number;
  cifKey: string;
  branchId?: number | null;
  branchName?: string | null;
  memberName: string;
  contactInfo: string;
  address: string;
  name: string;
  phone: string;
  email: string;
  latestLoan?: Loan;
}

export interface BorrowerPayload {
  cifKey: string;
  memberName: string;
  contactInfo: string;
  address: string;
  branchId?: number;
}

export interface LoanPayload {
  borrowerId: number;
  loanAccountNo: string;
  loanType: string;
  dateRelease: string;
  maturityDate: string;
  loanAmount: number;
  loanBalance: number;
  principalDue: number;
  penaltyDue: number;
  interest: number;
  otherCharges: number;
  total: number;
  parAge: number;
  status: "active" | "closed" | "overdue";
  notes: string;
}

export interface OverdueAccount {
  loanId: number;
  borrowerId: number;
  loanAccountNo: string;
  name: string;
  phone: string;
  email: string;
  principal: number;
  interest: number;
  penalty: number;
  totalOutstanding: number;
  dueDate: string;
  daysOverdue: number;
}

export interface DashboardMetrics {
  totalPortfolio: number;
  totalOverdue: number;
  collectionsToday: number;
  activeLoans: number;
  overdueLoans: number;
}

/** One page of a server-side list. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LoanRemark {
  canEdit?: boolean;
  id: number;
  loanId: number;
  remark: string;
  remarkCategory: string;
  createdAt: string;
  createdBy: string;
  attachmentName?: string | null;
  /** Field photo with where and when it was taken; null when the remark has none. */
  photo?: { latitude: number | null; longitude: number | null; accuracy: number | null; capturedAt: string } | null;
  /** Where the remark was recorded ("Add location"). */
  location?: { latitude: number; longitude: number; accuracy: number | null } | null;
}

export interface LoanPayment {
  canEdit?: boolean;
  /** Photo or file proving the payment, with where it was recorded. */
  proof?: { kind: string; fileName: string; latitude: number; longitude: number; accuracy: number | null; capturedAt: string } | null;
  /** "partial" or "settled"; older payments may have none. */
  paymentStatus?: string | null;
  id: number;
  paymentId: string;
  loanId: number;
  amount: number;
  orNo: string;
  collectedBy: string;
  collectedAt: string;
}
