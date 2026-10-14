import type { ReactNode } from "react";

export function LoanRecordField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <div className="mobile-record-value">{value}</div>
    </div>
  );
}
