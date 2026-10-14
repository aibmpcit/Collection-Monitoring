import { FileSpreadsheet, FileText } from "lucide-react";

interface ExportChoiceDialogProps {
  open: boolean;
  title: string;
  description?: string;
  onExcel: () => void;
  onPdf: () => void;
  onClose: () => void;
}

export function ExportChoiceDialog({ open, title, description, onExcel, onPdf, onClose }: ExportChoiceDialogProps) {
  if (!open) return null;

  const choices = [
    { label: "Excel", note: "Spreadsheet (.xlsx)", icon: <FileSpreadsheet size={22} />, run: onExcel },
    { label: "PDF", note: "Printable report (.pdf)", icon: <FileText size={22} />, run: onPdf }
  ];

  return <div className="fixed left-0 top-0 z-[200] flex h-[100dvh] w-screen items-center justify-center bg-slate-950/45 p-4" role="presentation"
    onMouseDown={onClose} onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="export-choice-title" onMouseDown={event => event.stopPropagation()}>
      <h2 id="export-choice-title" className="text-lg font-bold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {choices.map((choice, index) => <button key={choice.label} type="button" autoFocus={index === 0}
          className="surface-soft flex items-center gap-3 p-4 text-left transition hover:border-brand-600 hover:bg-brand-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          onClick={() => { onClose(); choice.run(); }}>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700">{choice.icon}</span>
          <span><span className="block font-semibold text-slate-900">{choice.label}</span><span className="block text-xs text-slate-500">{choice.note}</span></span>
        </button>)}
      </div>
      <button type="button" className="btn-muted mt-4 w-full justify-center" onClick={onClose}>Cancel</button>
    </section>
  </div>;
}
