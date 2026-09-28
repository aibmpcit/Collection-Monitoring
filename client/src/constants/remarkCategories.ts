export const IMPORT_REMARK_CATEGORIES = [
  {
    "value": "other_source_of_income",
    "label": "Other Source of Income"
  },
  {
    "value": "personal_visit",
    "label": "Personal Visit"
  },
  {
    "value": "reminder_letter",
    "label": "Reminder Letter"
  },
  {
    "value": "demand_letter",
    "label": "Demand Letter"
  },
  {
    "value": "branch_final_demand",
    "label": "Branch Final Demand"
  },
  {
    "value": "branch_compromise_agreement",
    "label": "Branch Compromise Agreement"
  },
  {
    "value": "mediated",
    "label": "Mediated"
  },
  {
    "value": "letter_for_non_compliance",
    "label": "Letter for Non-Compliance"
  },
  {
    "value": "atty_s_final_demand",
    "label": "Atty's Final Demand"
  },
  {
    "value": "attys_demand_for_blocked_atm",
    "label": "Attys Demand for Blocked ATM"
  },
  {
    "value": "notice_for_co_makership",
    "label": "Notice for Co-Makership"
  },
  {
    "value": "final_notice_for_small_claims",
    "label": "Final Notice for Small Claims"
  },
  {
    "value": "small_claims",
    "label": "Small Claims"
  },
  {
    "value": "bp22_estafa",
    "label": "BP22/ESTAFA"
  },
  {
    "value": "foreclosed",
    "label": "Foreclosed"
  },
  {
    "value": "endorsed_to_rmu",
    "label": "Endorsed to RMU"
  }
] as const;

export const REMARK_CATEGORIES = [
  ...IMPORT_REMARK_CATEGORIES,
  { value: "follow_up_collection", label: "Follow-up Collection" },
  { value: "with_small_claims", label: "With Small Claims" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "fully_paid", label: "Fully Paid" },
  { value: "rescheduled_payment", label: "Rescheduled Payment" },
  { value: "sent_legal_notice", label: "Sent Legal Notice" },
  { value: "promised_to_pay", label: "Promised to Pay" },
  { value: "others", label: "Others" }
] as const;

export type RemarkCategory = (typeof REMARK_CATEGORIES)[number]["value"];

export const DEFAULT_REMARK_CATEGORY: RemarkCategory = "follow_up_collection";

export function getRemarkCategoryLabel(category: string | null | undefined): string {
  const match = REMARK_CATEGORIES.find((item) => item.value === category);
  return match ? match.label : "Follow-up Collection";
}
