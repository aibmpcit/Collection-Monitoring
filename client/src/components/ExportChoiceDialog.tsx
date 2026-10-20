import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { FileSpreadsheet, FileText } from "lucide-react";
import { createPortal } from "react-dom";

interface ExportChoiceDialogProps {
  open: boolean;
  title: string;
  description?: string;
  onExcel: () => void;
  onPdf: () => void;
  onClose: () => void;
}

/** Asks Excel or PDF. Uses the shared modal backdrop and card, rendered over the whole page. */
export function ExportChoiceDialog({ open, title, description, onExcel, onPdf, onClose }: ExportChoiceDialogProps) {
  useEscapeToClose(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const choices = [
    { label: "Excel", note: "Spreadsheet (.xlsx)", icon: <FileSpreadsheet size={22} aria-hidden="true" />, run: onExcel },
    { label: "PDF", note: "Printable report (.pdf)", icon: <FileText size={22} aria-hidden="true" />, run: onPdf }
  ];

  return createPortal(
    <section className="modal-shell grid place-items-center" role="dialog" aria-modal="true" aria-labelledby="export-choice-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card max-w-md">
        <h2 id="export-choice-title" className="text-lg font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {choices.map((choice, index) => <button key={choice.label} type="button" autoFocus={index === 0}
            className="surface-soft flex items-center gap-3 p-4 text-left transition hover:border-brand-600 hover:bg-brand-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            onClick={() => { onClose(); choice.run(); }}>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700">{choice.icon}</span>
            <span className="min-w-0">
              <span className="block font-semibold text-slate-900">{choice.label}</span>
              <span className="block whitespace-nowrap text-xs text-slate-500">{choice.note}</span>
            </span>
          </button>)}
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-muted" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </section>,
    document.body
  );
}
