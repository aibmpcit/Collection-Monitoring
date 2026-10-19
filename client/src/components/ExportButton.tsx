import { Download } from "lucide-react";
import { useState } from "react";
import { exportToExcel, exportToPdf, MAX_EXPORT_ROWS, type TableExport } from "../services/tableExport";
import { ExportChoiceDialog } from "./ExportChoiceDialog";
import { ToastNotification } from "./ToastNotification";

/** Export icon beside a list's filters: asks Excel or PDF, then exports every row matching the current filters. */
export function ExportButton<T>({ label, prepare }: {
  /** What is exported, e.g. "loan records". */
  label: string;
  /** Loads the matching rows and describes the file. */
  prepare: () => Promise<TableExport<T>>;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "success" } | null>(null);

  async function run(format: "excel" | "pdf") {
    setBusy(true);
    setMessage(null);
    try {
      const table = await prepare();
      if (format === "excel") await exportToExcel(table); else await exportToPdf(table);
      setMessage(table.rows.length >= MAX_EXPORT_ROWS
        ? { text: `Exported the first ${MAX_EXPORT_ROWS.toLocaleString()} ${label}. Narrow the filters to export the rest.`, tone: "error" }
        : { text: `Exported ${table.rows.length.toLocaleString()} ${label}.`, tone: "success" });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : `Unable to export ${label}.`, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message && <ToastNotification message={message.text} tone={message.tone} onClose={() => setMessage(null)} />}
      <button
        type="button"
        className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700 disabled:opacity-60"
        aria-label={busy ? `Exporting ${label}...` : `Export ${label}`}
        title="Export to Excel or PDF"
        disabled={busy}
        onClick={() => setChoosing(true)}
      >
        <Download size={16} aria-hidden="true" className={busy ? "animate-pulse" : ""} />
        {busy ? "Exporting..." : "Export"}
      </button>
      <ExportChoiceDialog open={choosing} title={`Export ${label}`} description="Includes every record matching the current search and filters."
        onExcel={() => void run("excel")} onPdf={() => void run("pdf")} onClose={() => setChoosing(false)} />
    </>
  );
}
