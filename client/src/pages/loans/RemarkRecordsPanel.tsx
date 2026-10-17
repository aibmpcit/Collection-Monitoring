import { Search } from "lucide-react";
import { PaginationControls } from "../../components/PaginationControls";
import { getRemarkCategoryLabel } from "../../constants/remarkCategories";
import { LoanRecordField } from "./LoanRecordField";
import type { RemarkGroupRow, RemarkRecordRow } from "./types";

interface RemarkRecordsPanelProps {
  remarkQuery: string;
  setRemarkQuery: (value: string) => void;
  paginatedRemarkRecords: RemarkGroupRow[];
  remarkTotal: number;
  remarkRecordsPage: number;
  totalRemarkPages: number;
  rowsPerPage: number;
  setRemarkRecordsPage: (page: number) => void;
  canDeleteRemarks: boolean;
  selectedRemarkLoans: number[];
  setSelectedRemarkLoans: (update: number[] | ((current: number[]) => number[])) => void;
  toggleRemarkLoan: (loanId: number, checked: boolean) => void;
  selectAllMatchingRemarkLoans: () => Promise<void>;
  requestRemarkDelete: () => Promise<void>;
  remarkDeletePending: boolean;
  openLoanRemarks: (row: RemarkRecordRow) => void;
}

/** The Collections page's Remarks tab: one row per loan with its newest remarks. */
export function RemarkRecordsPanel({
  remarkQuery,
  setRemarkQuery,
  paginatedRemarkRecords,
  remarkTotal,
  remarkRecordsPage,
  totalRemarkPages,
  rowsPerPage,
  setRemarkRecordsPage,
  canDeleteRemarks,
  selectedRemarkLoans,
  setSelectedRemarkLoans,
  toggleRemarkLoan,
  selectAllMatchingRemarkLoans,
  requestRemarkDelete,
  remarkDeletePending,
  openLoanRemarks
}: RemarkRecordsPanelProps) {
  return (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
          
          <div className="relative w-full max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="field pl-9"
              value={remarkQuery}
              onChange={(event) => setRemarkQuery(event.target.value)}
              placeholder="Search actions taken"
            />
          </div>

          {canDeleteRemarks && <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-muted" disabled={remarkTotal === 0} onClick={() => void selectAllMatchingRemarkLoans()}>Select All Results</button>
            <button type="button" className="btn-muted" disabled={!selectedRemarkLoans.length} onClick={() => setSelectedRemarkLoans([])}>Clear Selection</button>
            <button type="button" className="btn-danger" disabled={!selectedRemarkLoans.length || remarkDeletePending} onClick={() => void requestRemarkDelete()}>Delete Selected ({selectedRemarkLoans.length})</button>
          </div>}
          </div>

          <div className="mobile-record-list mt-3">
            {paginatedRemarkRecords.map((row) => (
              <article
                key={`${row.kind}-${row.id}`}
                className="mobile-record-card cursor-pointer transition hover:bg-white"
                role="button"
                tabIndex={0}
                onClick={() => openLoanRemarks(row)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openLoanRemarks(row);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">{canDeleteRemarks && <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select actions taken for ${row.loan_account_no}`} checked={selectedRemarkLoans.includes(Number(row.loan_id))} onClick={event => event.stopPropagation()} onChange={event => toggleRemarkLoan(Number(row.loan_id), event.target.checked)} />}
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{row.member_name}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {row.loan_type || "-"}
                    </p>
                  </div>
                </div>
                <ul className="mt-3 flex items-center gap-2 overflow-x-auto text-xs text-slate-800">
                  {row.recentRemarks.map(remark => (
                    <li key={remark.id} className="shrink-0">
                      <button
                        type="button"
                        className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 transition hover:border-brand-600 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                        aria-label={`View ${getRemarkCategoryLabel(remark.category)} action taken for ${row.loan_account_no}`}
                        onClick={event => {
                          event.stopPropagation();
                          openLoanRemarks(remark);
                        }}
                      >
                        {getRemarkCategoryLabel(remark.category)}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mobile-record-grid">
                  <LoanRecordField label="Loan Account No" value={row.loan_account_no || "-"} />
                  <LoanRecordField label="Added By" value={row.collector_name || "System"} />
                </div>
              </article>
            ))}
            {remarkTotal === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No loans with actions taken found.</p>}
          </div>

          <div className="table-shell loan-records-scroll mt-3 hidden w-full min-w-0 max-w-full overflow-x-auto pb-2 lg:block">
            <table className="table-clean w-full min-w-[900px] text-xs">
              <thead className="sticky top-0 z-10 bg-c1">
                <tr>
                  {canDeleteRemarks && <th><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label="Select all actions taken on current page" disabled={!paginatedRemarkRecords.length} checked={paginatedRemarkRecords.length > 0 && paginatedRemarkRecords.every(row => selectedRemarkLoans.includes(Number(row.loan_id)))} onChange={event => { const ids = paginatedRemarkRecords.map(row => Number(row.loan_id)); setSelectedRemarkLoans(current => event.target.checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id))); }} /></th>}
                  <th>Member Name</th>
                  <th>Loan Account No</th>
                  <th>Loan Type</th>
                  <th>Actions Taken</th>
                  <th>Added By</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRemarkRecords.map((row) => (
                  <tr
                    key={`${row.kind}-${row.id}`}
                    className="cursor-pointer transition hover:bg-slate-50"
                    tabIndex={0}
                    onClick={() => openLoanRemarks(row)}
                    onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openLoanRemarks(row);
                      }
                    }}
                  >
                    {canDeleteRemarks && <td>{canDeleteRemarks && <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select actions taken for ${row.loan_account_no}`} checked={selectedRemarkLoans.includes(Number(row.loan_id))} onClick={event => event.stopPropagation()} onChange={event => toggleRemarkLoan(Number(row.loan_id), event.target.checked)} />}</td>}
                    <td>{row.member_name}</td>
                    <td>{row.loan_account_no || "-"}</td>
                    <td>{row.loan_type || "-"}</td>
                    <td className="whitespace-nowrap">
                      <ul className="flex items-center justify-center gap-2">
                        {row.recentRemarks.map(remark => (
                          <li key={remark.id} className="shrink-0">
                      <button
                        type="button"
                        className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 transition hover:border-brand-600 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                        aria-label={`View ${getRemarkCategoryLabel(remark.category)} action taken for ${row.loan_account_no}`}
                        onClick={event => {
                          event.stopPropagation();
                          openLoanRemarks(remark);
                        }}
                      >
                        {getRemarkCategoryLabel(remark.category)}
                      </button>
                    </li>
                        ))}
                      </ul>
                    </td>
                    <td>{row.collector_name || "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {remarkTotal === 0 && <p className="p-3 text-sm text-slate-600">No loans with actions taken found.</p>}
          </div>
          <PaginationControls
            currentPage={remarkRecordsPage}
            totalPages={totalRemarkPages}
            totalItems={remarkTotal}
            pageSize={rowsPerPage}
            onPageChange={setRemarkRecordsPage}
          />
        </>
  );
}
