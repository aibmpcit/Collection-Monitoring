export type Role = "super_admin" | "branch_admin" | "staff";

export interface User {
  id: number;
  username: string;
  role: Role;
  branchId?: number | null;
  branchName?: string | null;
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
  principalDue: number;
  penaltyDue: number;
  otherCharges: number;
  parAge: number;
  principal: number;
  interest: number;
  penalty: number;
  dueDate: string;
  status: "active" | "closed" | "overdue";
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
  principalDue: number;
  penaltyDue: number;
  interest: number;
  otherCharges: number;
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
}

export interface LoanRemark {
  id: number;
  loanId: number;
  remark: string;
  remarkCategory: string;
  createdAt: string;
  createdBy: string;
}

export interface LoanPayment {
  id: number;
  paymentId: string;
  loanId: number;
  amount: number;
  orNo: string;
  collectedBy: string;
  collectedAt: string;
}
