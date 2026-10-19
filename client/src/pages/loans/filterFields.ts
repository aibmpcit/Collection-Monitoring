import { PERIOD_OPTIONS, type FilterField } from "../../components/FilterButton";
import { PAYMENT_STATUSES, REMARK_CATEGORIES } from "../../constants/remarkCategories";

// Filter fields for each Collection Records tab. Each key is sent to the server under the same name.

export const PAR_AGE_OPTIONS = [
  ["1-30", "PAR 1-30"], ["31-60", "PAR 31-60"], ["61-90", "PAR 61-90"],
  ["91-180", "PAR 91-180"], ["181-365", "PAR 181-365"], ["over-365", "PAR over 365"]
] as const;

const loanTypeField = (loanTypes: string[]): FilterField => ({
  key: "loanType", label: "Loan type", allLabel: "All loan types", options: loanTypes.map(type => [type, type] as const)
});

export function loanFilterFields(loanTypes: string[]): FilterField[] {
  return [
    loanTypeField(loanTypes),
    { key: "parAge", label: "PAR age", ariaLabel: "Filter by PAR age", allLabel: "All PAR ages", options: PAR_AGE_OPTIONS },
    { key: "actionStatus", label: "Status", allLabel: "All statuses",
      options: [["none", "No payment yet"], ...PAYMENT_STATUSES.map(status => [status.value, status.label] as const)] },
    { key: "followUp", label: "Action taken", allLabel: "Any",
      options: [["none", "No action taken yet"], ["recent", "Action taken in the last 7 days"], ["stale", "No action in the last 30 days"]] },
    { key: "maturity", label: "Maturity", allLabel: "Any maturity",
      options: [["past", "Past maturity"], ["soon", "Matures within 30 days"], ["later", "Matures after 30 days"]] },
    { key: "totalDue", label: "Total due", allLabel: "Any amount",
      options: [["under-10k", "Under ₱10,000"], ["10k-50k", "₱10,000 - ₱50,000"], ["over-50k", "Over ₱50,000"]] },
    { key: "sort", label: "Sort by", ariaLabel: "Sort by", allLabel: "Member name", isSort: true,
      options: [["par", "Highest PAR age"], ["total", "Highest total due"], ["maturity", "Nearest maturity"]] }
  ];
}

export function remarkFilterFields(loanTypes: string[]): FilterField[] {
  return [
    { key: "category", label: "Category", allLabel: "All categories", options: REMARK_CATEGORIES.map(category => [category.value, category.label] as const) },
    { key: "period", label: "Date", allLabel: "Any date", options: PERIOD_OPTIONS },
    loanTypeField(loanTypes)
  ];
}

export const PAYMENT_FILTER_FIELDS: FilterField[] = [
  { key: "paymentStatus", label: "Payment type", allLabel: "All payment types", options: PAYMENT_STATUSES.map(status => [status.value, status.label] as const) },
  { key: "period", label: "Date", allLabel: "Any date", options: PERIOD_OPTIONS },
  { key: "sort", label: "Sort by", ariaLabel: "Sort by", allLabel: "Member name", isSort: true, options: [["recent", "Most recent first"]] }
];

export function settledFilterFields(loanTypes: string[], branches: ReadonlyArray<readonly [string, string]> | null): FilterField[] {
  return [
    ...(branches ? [{ key: "branchId", label: "Branch", allLabel: "All branches", options: branches }] : []),
    loanTypeField(loanTypes),
    { key: "settledWithin", label: "Settled", allLabel: "Any time",
      options: [["7d", "In the last 7 days"], ["30d", "In the last 30 days"], ["90d", "In the last 90 days"]] },
    { key: "sort", label: "Sort by", ariaLabel: "Sort by", allLabel: "Most recently settled", isSort: true,
      options: [["name", "Member name"], ["total", "Highest total due"]] }
  ];
}
