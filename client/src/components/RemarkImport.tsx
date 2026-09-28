import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { IMPORT_REMARK_CATEGORIES } from "../constants/remarkCategories";
import { apiRequest } from "../services/api";
import type { Branch } from "../types/models";

type ImportRow = { row: number; loanAccountNo: string; remarks: { category: string; description: string }[] };
const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function RemarkImport({ branches, onImported }: { branches: Branch[]; onImported: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(0);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialogRef.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  async function readFile(file?: File) {
    setRows([]); setIssues([]); setMessage("");
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("The file has no worksheet.");
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
      const headers = (grid[0] ?? []).map(value => normalize(String(value)));
      const accountIndex = headers.findIndex(header => ["loanacctno", "loanaccountno", "loanaccountnumber"].includes(header));
      if (accountIndex < 0) throw new Error("Missing Loan Acct. No. column.");
      const columns = IMPORT_REMARK_CATEGORIES.map(category => ({ ...category, index: headers.indexOf(normalize(category.label)) }));
      if (!columns.some(column => column.index >= 0)) throw new Error("No recognized remark category columns found.");
      const nextRows: ImportRow[] = [];
      const errors: string[] = [];
      const accounts = new Set<string>();
      grid.slice(1).forEach((cells, index) => {
        const remarks = columns.filter(column => column.index >= 0).map(column => ({ category: column.value, description: String(cells[column.index] ?? "").trim() })).filter(remark => remark.description);
        if (!remarks.length) return;
        const loanAccountNo = String(rawGrid[index + 1]?.[accountIndex] ?? cells[accountIndex] ?? "").trim();
        const row = index + 2;
        if (!loanAccountNo) { errors.push(`Row ${row}: missing loan account number.`); return; }
        if (remarks.some(remark => remark.description.length > 2000)) { errors.push(`Row ${row}: a description exceeds 2,000 characters.`); return; }
        if (accounts.has(loanAccountNo.toLowerCase())) { errors.push(`Row ${row}: duplicate loan account ${loanAccountNo}. Combine its remarks into one row.`); return; }
        accounts.add(loanAccountNo.toLowerCase());
        nextRows.push({ row, loanAccountNo, remarks });
      });
      setRows(nextRows); setIssues(errors);
      if (!nextRows.length && !errors.length) setMessage("No non-empty remark category cells found.");
    } catch (error) { setIssues([error instanceof Error ? error.message : "Unable to read file."]); }
    finally { setBusy(false); }
  }

  async function importRows() {
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ imported: number; remarksImported: number; skipped: { row: number; reason: string }[] }>("/loans/remarks/import", "POST", { branchId, rows });
      setRows([]);
      setMessage(`Imported ${result.remarksImported} remarks for ${result.imported} loans. Skipped ${result.skipped.length} rows.`);
      setIssues(result.skipped.map(item => `Row ${item.row}: ${item.reason}`));
      await onImported();
    } catch (error) { setIssues([error instanceof Error ? error.message : "Unable to import remarks."]); }
    finally { setBusy(false); }
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const headers = ["Member Code", "Member Name", "Address", "Contact No.", "Loan Acct. No.", "Loan Product", "Release Date", "Maturity", "Loan Amount", "Loan Balance", "Principal Arears", "Interest", "Fines", "Total", "PAR Age", "Remarks", ...IMPORT_REMARK_CATEGORIES.map(category => category.label)];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), "Remarks Import");
    XLSX.writeFile(workbook, "remarks-import-template.xlsx");
  }

  return <div className="mb-3 w-full">
    <button type="button" className="btn-muted" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>Bulk Import Remarks</button>
    {open && createPortal(<dialog ref={dialogRef}
      className="modal-card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl space-y-3 overflow-y-auto backdrop:bg-slate-900/40"
      aria-labelledby="remark-import-title"
      onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="remark-import-title" className="text-lg font-semibold">Bulk Import Remarks</h2>
        <button type="button" className="btn-muted" disabled={busy} onClick={() => setOpen(false)}>Close</button>
      </div>
      <p className="text-sm text-slate-600">Choose a branch and upload the shared loan spreadsheet. Each non-empty category cell becomes a remark description. Loan data and the general Remarks column are ignored. You can import multiple times. Each import adds new remarks, including duplicates if the same file is imported again.</p>
      <div className="flex flex-wrap gap-3">
        <select aria-label="Remarks import branch" className="field" value={branchId} disabled={busy} onChange={event => setBranchId(Number(event.target.value))}>
          <option value={0}>Select branch</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
        </select>
        <input aria-label="Remarks spreadsheet" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void readFile(file); }} />
        <button type="button" className="btn-muted" disabled={busy} onClick={() => void downloadTemplate().catch(() => setIssues(["Unable to download template."]))}>Download Template</button>
      </div>
      {rows.length > 0 && <>
        <p className="text-sm">Ready: {rows.length} loans, {rows.reduce((sum, row) => sum + row.remarks.length, 0)} remarks. Showing the first 10 loans.</p>
        <div className="max-h-64 overflow-auto"><table className="table-clean"><thead><tr><th>Loan Account</th><th>Category</th><th>Description</th></tr></thead><tbody>
          {rows.slice(0, 10).flatMap(row => row.remarks.map(remark => <tr key={`${row.row}-${remark.category}`}><td>{row.loanAccountNo}</td><td>{IMPORT_REMARK_CATEGORIES.find(category => category.value === remark.category)?.label}</td><td className="whitespace-pre-wrap">{remark.description}</td></tr>))}
        </tbody></table></div>
      </>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {issues.length > 0 && <ul role="alert" className="max-h-48 overflow-auto text-sm text-red-700">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      <button type="button" className="btn-primary" disabled={busy || !branchId || !rows.length || issues.length > 0} onClick={() => void importRows()}>{busy ? "Processing..." : "Import Remarks"}</button>
    </dialog>, document.body)}
  </div>;
}
