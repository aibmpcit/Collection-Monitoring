import type { LoanPayload } from "../../types/models";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatCurrency(value: number): string {
  return pesoFormatter.format(value || 0);
}

export function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString();
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

export const EMPTY_FORM: LoanPayload = {
  borrowerId: 0,
  loanAccountNo: "",
  loanType: "",
  dateRelease: "",
  maturityDate: "",
  loanAmount: 0,
  loanBalance: 0,
  principalDue: 0,
  penaltyDue: 0,
  interest: 0,
  otherCharges: 0,
  total: 0,
  parAge: 0,
  status: "active",
  notes: ""
};

export function computeRowsPerPage(viewportHeight: number): number {
  // Keep pagination consistent across screen sizes.
  void viewportHeight;
  return 15;
}

export function loanStatusClass(status: string): string {
  if (status === "overdue") return "status-danger";
  if (status === "closed") return "status-warning";
  return "status-success";
}
