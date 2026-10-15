import { LOAN_ACTION_STATUSES, OTHER_REMARK_CATEGORIES } from "../constants/remarkCategories";

/** Options for a loan remark type picker: the four statuses (primary remarks) first, then the rest. */
export function RemarkCategoryOptions() {
  return (
    <>
      <optgroup label="Loan status (primary remark)">
        {LOAN_ACTION_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </optgroup>
      <optgroup label="Other remarks">
        {OTHER_REMARK_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </optgroup>
    </>
  );
}
