import { createPortal } from "react-dom";
import { getRemarkCategoryLabel } from "../constants/remarkCategories";

interface DetailGroup {
  name: string;
  cifKey?: string;
  contact?: string;
  address?: string;
  branch?: string;
}

interface LoanGroup {
  accountNo: string;
  type?: string;
  status?: string;
  maturityDate?: string;
}

export function RemarkSummaryModal({
  open, remark, category, createdAt, createdBy, member, loan, attachmentName, onDownload, onClose
}: {
  open: boolean;
  remark: string;
  category: string;
  createdAt: string;
  createdBy: string;
  member: DetailGroup;
  loan?: LoanGroup;
  attachmentName?: string | null;
  onDownload?: () => void;
  onClose: () => void;
}) {
  if (!open || typeof document === "undefined") return null;
  const displayDate = Number.isNaN(new Date(createdAt).getTime()) ? createdAt : new Date(createdAt).toLocaleString();
  return createPortal(
    <section className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="remark-summary-title" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal-card max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Remark Summary</p>
            <h2 id="remark-summary-title" className="mt-1 text-xl font-semibold">{getRemarkCategoryLabel(category)}</h2>
            <p className="mt-1 text-xs text-slate-500">{displayDate} | By: {createdBy}</p>
          </div>
          <button type="button" className="btn-muted" onClick={onClose}>Close</button>
        </div>

        <section className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remark</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-900">{remark}</p>
        </section>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <section className="surface-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Member details</p>
            <p className="mt-2 font-semibold">{member.name}</p>
            <p className="text-sm text-slate-600">CIF: {member.cifKey || "-"}</p>
            <p className="text-sm text-slate-600">Contact: {member.contact || "-"}</p>
            <p className="text-sm text-slate-600">Address: {member.address || "-"}</p>
            {member.branch && <p className="text-sm text-slate-600">Branch: {member.branch}</p>}
          </section>
          {loan && <section className="surface-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loan details</p>
            <p className="mt-2 font-semibold">{loan.accountNo}</p>
            <p className="text-sm text-slate-600">Type: {loan.type || "-"}</p>
            <p className="text-sm text-slate-600">Status: {loan.status || "-"}</p>
            <p className="text-sm text-slate-600">Maturity: {loan.maturityDate || "-"}</p>
          </section>}
        </div>

        <section className="mt-4 surface-soft p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attachment</p>
          {attachmentName && onDownload
            ? <button type="button" className="mt-2 font-semibold text-brand-700 underline" onClick={onDownload}>{attachmentName}</button>
            : <p className="mt-2 text-sm text-slate-500">No attachment</p>}
        </section>
      </div>
    </section>,
    document.body
  );
}
