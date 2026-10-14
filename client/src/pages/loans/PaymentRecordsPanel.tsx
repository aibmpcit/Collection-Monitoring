import { Search } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PaginationControls } from "../../components/PaginationControls";
import { formatCurrency, formatDateTime } from "./format";
import { LoanRecordField } from "./LoanRecordField";
import type { PaymentRecordRow } from "./types";

interface PaymentRecordsPanelProps {
  paymentQuery: string;
  setPaymentQuery: (value: string) => void;
  paginatedPaymentRecords: PaymentRecordRow[];
  paymentTotal: number;
  paymentPage: number;
  totalPaymentPages: number;
  rowsPerPage: number;
  setPaymentPage: (page: number) => void;
  canDeletePayments: boolean;
  selectedPaymentIds: number[];
  setSelectedPaymentIds: (ids: number[]) => void;
  togglePaymentSelection: (id: number, checked: boolean) => void;
  togglePaymentPageSelection: (checked: boolean) => void;
  selectAllMatchingPayments: () => Promise<void>;
  handleRequestBulkPaymentDelete: () => void;
}

/** The Collections page's Payments tab: one server page of payments with search and bulk selection. */
export function PaymentRecordsPanel({
  paymentQuery,
  setPaymentQuery,
  paginatedPaymentRecords,
  paymentTotal,
  paymentPage,
  totalPaymentPages,
  rowsPerPage,
  setPaymentPage,
  canDeletePayments,
  selectedPaymentIds,
  setSelectedPaymentIds,
  togglePaymentSelection,
  togglePaymentPageSelection,
  selectAllMatchingPayments,
  handleRequestBulkPaymentDelete
}: PaymentRecordsPanelProps) {
  const navigate = useNavigate();
  const selectedPaymentIdSet = useMemo(() => new Set(selectedPaymentIds), [selectedPaymentIds]);
  const hasAnyPaymentSelection = selectedPaymentIds.length > 0;
  const hasPaymentPageRows = paginatedPaymentRecords.length > 0;
  const allPaymentPageSelected = hasPaymentPageRows && paginatedPaymentRecords.every((row) => selectedPaymentIdSet.has(row.id));

  return (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="field pl-9"
                value={paymentQuery}
                onChange={(event) => setPaymentQuery(event.target.value)}
                placeholder="Search payments"
              />
            </div>
            {canDeletePayments && (
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <button
                  type="button"
                  className="btn-muted w-full sm:w-auto"
                  onClick={() => void selectAllMatchingPayments()}
                  disabled={paymentTotal === 0}
                >
                  Select All Results
                </button>
                <button
                  type="button"
                  className="btn-muted w-full sm:w-auto"
                  onClick={() => setSelectedPaymentIds([])}
                  disabled={!hasAnyPaymentSelection}
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  className="btn-danger w-full sm:w-auto"
                  onClick={handleRequestBulkPaymentDelete}
                  disabled={!hasAnyPaymentSelection}
                >
                  Delete Selected ({selectedPaymentIds.length})
                </button>
              </div>
            )}
          </div>
          <div className="mobile-record-list mt-3">
            {paginatedPaymentRecords.map((row) => (
              <article key={row.id} className="mobile-record-card cursor-pointer transition hover:bg-slate-50" tabIndex={0}
                    onClick={() => navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`)}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`);
                      }
                    }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{row.memberName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.paymentId} | {row.loanAccountNo}
                    </p>
                  </div>
                  {canDeletePayments && (
                    <input
                      type="checkbox"
                      aria-label={`Select payment ${row.paymentId}`}
                      onClick={event => event.stopPropagation()}
                      checked={selectedPaymentIdSet.has(row.id)}
                      onChange={(event) => togglePaymentSelection(row.id, event.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                    />
                  )}
                </div>

                <div className="mobile-record-grid">
                  <LoanRecordField label="OR No" value={row.orNo || "-"} />
                  <LoanRecordField label="Collected By" value={row.collectedBy || "System"} />
                  <LoanRecordField label="Amount" value={formatCurrency(row.amount)} />
                  <LoanRecordField label="Collected At" value={formatDateTime(row.collectedAt)} />
                </div>
              </article>
            ))}
            {paymentTotal === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No payments found.</p>}
          </div>

          <div className="table-shell loan-records-scroll mt-3 hidden w-full min-w-0 max-w-full overflow-x-auto pb-2 lg:block">
            <table className="table-clean w-[1050px] text-xs">
              <thead className="sticky top-0 z-10 bg-c1">
                <tr>
                  {canDeletePayments && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all payments on current page"
                        checked={allPaymentPageSelected}
                        onChange={(event) => togglePaymentPageSelection(event.target.checked)}
                        disabled={!hasPaymentPageRows}
                        className="h-4 w-4 accent-brand-600"
                      />
                    </th>
                  )}
                  <th>Payment ID</th>
                  <th>OR No</th>
                  <th>Collected By</th>
                  <th>Loan Account No</th>
                  <th>Member Name</th>
                  <th>Amount</th>
                  <th>Collected At</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPaymentRecords.map((row) => (
                  <tr key={row.id} className="cursor-pointer transition hover:bg-slate-50" tabIndex={0}
                    onClick={() => navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`)}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`);
                      }
                    }}>
                    {canDeletePayments && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select payment ${row.paymentId}`}
                      onClick={event => event.stopPropagation()}
                          checked={selectedPaymentIdSet.has(row.id)}
                          onChange={(event) => togglePaymentSelection(row.id, event.target.checked)}
                          className="h-4 w-4 accent-brand-600"
                        />
                      </td>
                    )}
                    <td>{row.paymentId}</td>
                    <td>{row.orNo || "-"}</td>
                    <td>{row.collectedBy || "System"}</td>
                    <td>{row.loanAccountNo}</td>
                    <td>{row.memberName}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>{formatDateTime(row.collectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paymentTotal === 0 && <p className="p-3 text-sm text-slate-600">No payments found.</p>}
          </div>
          <PaginationControls
            currentPage={paymentPage}
            totalPages={totalPaymentPages}
            totalItems={paymentTotal}
            pageSize={rowsPerPage}
            onPageChange={setPaymentPage}
          />
        </>
  );
}
