import { ModalShell } from "../../components/ModalShell";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../../services/api";
import { gridToRecords, loadXlsx, readSpreadsheet } from "../../services/spreadsheet";
import type { Branch } from "../../types/models";
import { buildLoanTemplateWorkbook, splitLoanImportRows, type DroppedImportRow, type LoanImportRow } from "./loanImport";
import type { LoanImportSkipRow } from "./types";

export interface LoanImportResult {
  preview: boolean;
  closeMissing: boolean;
  notInFile: number;
  remarksDuplicate: number;
  inserted: number;
  updated: number;
  reopened: number;
  closed: number;
  openBefore: number;
  skipped: number;
  skippedRows: LoanImportSkipRow[];
  closedLoans: Array<{ loanAccountNo: string; memberName: string }>;
  remarksImported: number;
  remarksInFile: number;
  remarksNote: string;
}

/** Closing more than this share of a branch's open loans usually means the wrong file or branch. */
const CLOSE_WARNING_SHARE = 0.25;

interface LoanImportDialogProps {
  isSuperAdmin: boolean;
  branches: Branch[];
  importBranchId: number;
  setImportBranchId: (branchId: number) => void;
  branchError: string;
  onClose: () => void;
  onImported: (message: string) => void;
}

type Step = "choose" | "review" | "done";

/**
 * Upload of a branch's overdue list. The file is checked first (nothing saved), then confirmed.
 * Loans missing from the file are listed, and closed only when "Close loans that are not in this
 * file" is ticked. Whether remark columns are imported is decided by the server (REMARK_IMPORT_ONCE).
 */
export function LoanImportDialog({ isSuperAdmin, branches, importBranchId, setImportBranchId, branchError, onClose, onImported }: LoanImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [step, setStep] = useState<Step>("choose");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<LoanImportRow[]>([]);
  const [rowsInFile, setRowsInFile] = useState(0);
  const [dropped, setDropped] = useState<DroppedImportRow[]>([]);
  const [result, setResult] = useState<LoanImportResult | null>(null);
  // On by default: loans missing from the branch's updated list move to Settled Accounts.
  // Untick only for a partial file.
  const [closeMissing, setCloseMissing] = useState(true);

  const branch = branches.find(item => item.id === importBranchId);
  const branchLabel = isSuperAdmin ? (branch ? `${branch.code} - ${branch.name}` : "the selected branch") : "your branch";
  const problemCount = dropped.length + (result?.skippedRows.length ?? 0);
  const closingShare = result && result.openBefore > 0 ? result.closed / result.openBefore : 0;

  function reset() {
    setStep("choose");
    setResult(null);
    setRows([]);
    setDropped([]);
    setError("");
  }

  function send(preview: boolean) {
    return apiRequest<LoanImportResult>("/loans/bulk", "POST", {
      rows, preview, closeMissing, fileName: file?.name ?? "", rowsInFile,
      ...(isSuperAdmin ? { branchId: importBranchId } : {})
    });
  }

  async function checkFile(close = closeMissing) {
    if (!file) return;
    setPending(true);
    setError("");
    try {
      const { grid, headerRow } = await readSpreadsheet(file);
      const records = gridToRecords(grid, headerRow);
      const split = splitLoanImportRows(records);
      setRows(split.rows);
      setDropped(split.dropped);
      setRowsInFile(records.length);
      if (split.rows.length === 0) {
        setResult(null);
        setError(records.length ? "None of the rows in this file can be imported. Download the list below to see why." : "This file has no data rows.");
        setStep(records.length ? "review" : "choose");
        return;
      }
      const preview = await apiRequest<LoanImportResult>("/loans/bulk", "POST", {
        rows: split.rows, preview: true, closeMissing: close, fileName: file.name, rowsInFile: records.length,
        ...(isSuperAdmin ? { branchId: importBranchId } : {})
      });
      setResult(preview);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to read this file.");
    } finally {
      setPending(false);
    }
  }

  async function confirmImport() {
    setPending(true);
    setError("");
    try {
      const saved = await send(false);
      setResult(saved);
      setStep("done");
      const parts = [`${saved.inserted} new`, `${saved.updated} updated`];
      if (saved.reopened) parts.push(`${saved.reopened} reopened`);
      if (saved.closeMissing) parts.push(`${saved.closed} moved to Settled Accounts`);
      if (saved.remarksImported) parts.push(`${saved.remarksImported} actions taken imported`);
      onImported(`Import complete: ${parts.join(", ")}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to import this file.");
    } finally {
      setPending(false);
    }
  }

  function toggleCloseMissing(next: boolean) {
    setCloseMissing(next);
    // The preview depends on this choice, so check the file again.
    if (step === "review" && file) void checkFile(next);
  }

  async function downloadProblems() {
    const XLSX = await loadXlsx();
    const lines = [
      ...dropped.map(item => ({ Row: item.row, "Loan Account": item.loanAccountNo, "Member Code": item.cifKey, Reason: item.reason })),
      ...(result?.skippedRows ?? []).map(item => ({ Row: item.row, "Loan Account": item.loanAccountNo, "Member Code": item.cifKey, Reason: item.reason }))
    ].sort((a, b) => a.Row - b.Row);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lines), "Not Imported");
    XLSX.writeFile(workbook, `not-imported-${(file?.name ?? "loans").replace(/\.[^.]+$/, "")}.xlsx`);
  }

  async function downloadTemplate() {
    try {
      const XLSX = await loadXlsx();
      XLSX.writeFile(buildLoanTemplateWorkbook(XLSX), "loan-import-template.xlsx");
    } catch {
      setError("Unable to download the template.");
    }
  }

  return createPortal(
    <ModalShell labelledBy="loan-import-title" onClose={onClose} busy={pending}>
      <div className="modal-card max-w-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 id="loan-import-title" className="text-lg font-semibold">Import Loans</h3>
          <button type="button" className="btn-muted" onClick={onClose} disabled={pending}>Close</button>
        </div>

        <div className="surface-soft grid gap-3 border-dashed border-black/20 p-3" aria-busy={pending}>
          {step === "choose" && <>
            <Upload size={16} className="text-black/60" />
            <p className="text-sm text-black/70">Upload the branch's overdue list from the loan system.</p>
            <div className="flex flex-wrap items-center gap-2">
              {isSuperAdmin && (
                <select className="field w-56" value={importBranchId} onChange={event => { setImportBranchId(Number(event.target.value)); reset(); }}
                  aria-label="Select branch for loan import" disabled={pending}>
                  <option value={0}>Select import branch</option>
                  {branches.map(item => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}
                </select>
              )}
              <input key={inputKey} type="file" accept=".csv,.xls,.xlsx" className="text-sm" disabled={pending} aria-label="Loan spreadsheet"
                onChange={event => { setFile(event.target.files?.[0] ?? null); reset(); }} />
              <button type="button" className="btn-primary" onClick={() => void checkFile()}
                disabled={pending || !file || (isSuperAdmin && importBranchId <= 0)}>
                {pending ? "Checking..." : "Check File"}
              </button>
            </div>
            <p className="text-xs text-black/70">{file ? `Selected file: ${file.name}` : "Choose a CSV or Excel file, then click Check File. Nothing is saved until you confirm."}</p>
          </>}

          {step !== "done" && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={closeMissing} disabled={pending}
                onChange={event => toggleCloseMissing(event.target.checked)} />
              <span>Move loans that are not in this file to Settled Accounts<span className="block text-xs text-slate-500">On for the branch's complete updated list. Untick only for a partial file. Settled loans keep their payments and actions taken, and come back if they appear in a later upload.</span></span>
            </label>
          )}

          {step !== "choose" && <div className="grid gap-3 text-sm">
            <p className="font-semibold text-slate-900">
              {step === "done" ? "Imported" : "Ready to import"} {file?.name} into {branchLabel}
            </p>
            {result && <ul className="grid gap-1">
              <li>{result.inserted} new loan(s)</li>
              <li>{result.updated} updated loan(s){result.reopened ? `, ${result.reopened} of them reopened` : ""}</li>
              {result.notInFile > 0 && <li>
                {result.closeMissing
                  ? `${result.closed} loan(s) ${step === "done" ? "moved" : "will move"} to Settled Accounts because they are not in this file`
                  : `${result.notInFile} open loan(s) are not in this file and ${step === "done" ? "stayed" : "will stay"} open`}
                {result.closedLoans.length > 0 && <span className="block text-xs text-slate-500">
                  {result.closedLoans.slice(0, 5).map(loan => `${loan.loanAccountNo} (${loan.memberName})`).join(", ")}
                  {result.notInFile > 5 ? ` and ${result.notInFile - 5} more` : ""}
                </span>}
              </li>}
              {result.remarksImported > 0 && <li>{result.remarksImported} remark(s) {step === "done" ? "imported" : "will be imported"}</li>}
            </ul>}
            {result?.remarksNote && <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">{result.remarksNote}</p>}
            {step === "review" && result?.closeMissing && closingShare > CLOSE_WARNING_SHARE && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                This would move {result.closed} of {result.openBefore} open loans ({Math.round(closingShare * 100)}%) to Settled Accounts.
                Check that this is the complete list for {branchLabel} before confirming.
              </p>
            )}
            {problemCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <span>{problemCount} row(s) {step === "done" ? "were" : "will be"} skipped.</span>
              <button type="button" className="btn-muted h-8 gap-1.5 px-3 text-xs" onClick={() => void downloadProblems()}>
                <Download size={14} /><span>Download list</span>
              </button>
            </div>}
            <div className="flex flex-wrap justify-end gap-2">
              {step === "review" && <>
                <button type="button" className="btn-muted" disabled={pending} onClick={() => { reset(); setFile(null); setInputKey(key => key + 1); }}>Choose another file</button>
                {result && <button type="button" className="btn-primary" disabled={pending} onClick={() => void confirmImport()}>
                  {pending ? "Importing..." : "Confirm Import"}
                </button>}
              </>}
              {step === "done" && <button type="button" className="btn-primary" onClick={onClose}>Done</button>}
            </div>
          </div>}

          {(error || branchError) && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error || branchError}</p>}
          {pending && (
            <div className="import-progress-track" role="progressbar" aria-label="Loan import in progress" aria-valuetext="Working on the loan file">
              <div className="import-progress-bar" />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-3">
            <p className="text-xs text-black/70">Not sure about the format? Start from the template.</p>
            <button type="button" className="btn-muted h-9 gap-1.5 px-3 text-sm" onClick={() => void downloadTemplate()} disabled={pending}>
              <Download size={15} /><span>Download Template</span>
            </button>
          </div>
          <p className="text-xs text-black/60">Columns: Member Code, Member Name, Address, Contact No., Loan Account Number, Loan Product, Release Date, Maturity, Loan Amount, Loan Balance, Principal Arrears, Interest, Fines, Total, PAR Age. plus any action taken columns (Personal Visit, Demand Letter, …).</p>
        </div>
      </div>
    </ModalShell>,
    document.body
  );
}
