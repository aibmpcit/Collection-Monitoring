export const REMARK_CATEGORIES = [
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
