import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams, useParams } from "react-router-dom";
import { DuesCard } from "../components/DuesCard";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { RemarkSummaryModal } from "../components/RemarkSummaryModal";
import { DEFAULT_REMARK_CATEGORY, getRemarkCategoryLabel, REMARK_CATEGORIES, type RemarkCategory } from "../constants/remarkCategories";
import { apiDownload, apiRequest } from "../services/api";
import { fileToAttachment } from "../services/attachments";
import type { Loan, LoanPayment, LoanRemark } from "../types/models";

interface LoanDetails extends Loan {
  cifKey: string;
  memberName: string;
  contactInfo: string;
  address: string;
}

const HISTORY_PAGE_SIZE = 5;

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatCurrency(value: number): string {
  return pesoFormatter.format(value || 0);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString();
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function getLocalDateTimeInputValue(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function toLocalDateTimeInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getLocalDateTimeInputValue();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function LoanDetailsPage() {
  const { loanId = "0" } = useParams();
  const [searchParams] = useSearchParams();
  const numericLoanId = Number(loanId);
  const [loan, setLoan] = useState<LoanDetails | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [remarks, setRemarks] = useState<LoanRemark[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [historyTab, setHistoryTab] = useState<"payments" | "remarks">("remarks");
  const [paymentPage, setPaymentPage] = useState(1);
  const [remarkPage, setRemarkPage] = useState(1);
  const paymentPages = Math.max(1, Math.ceil(payments.length / HISTORY_PAGE_SIZE));
  const remarkPages = Math.max(1, Math.ceil(remarks.length / HISTORY_PAGE_SIZE));
  const currentPaymentPage = Math.min(paymentPage, paymentPages);
  const currentRemarkPage = Math.min(remarkPage, remarkPages);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [remarksLoading, setRemarksLoading] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [remarksSubmitting, setRemarksSubmitting] = useState(false);
  const [paymentsSubmitting, setPaymentsSubmitting] = useState(false);
  const [remarkError, setRemarkError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [remarkInput, setRemarkInput] = useState("");
  const [remarkCategory, setRemarkCategory] = useState<RemarkCategory>(DEFAULT_REMARK_CATEGORY);
  const [remarkAttachment, setRemarkAttachment] = useState<File | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentOrNo, setPaymentOrNo] = useState("");
  const [paymentDateTime, setPaymentDateTime] = useState(getLocalDateTimeInputValue());
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [remarkModalOpen, setRemarkModalOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [editingRemarkId, setEditingRemarkId] = useState<number | null>(null);
  const [summaryRemark, setSummaryRemark] = useState<LoanRemark | null>(null);
  const remarkDialogRef = useRef<HTMLDialogElement>(null);
  const paymentDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!paymentModalOpen && !remarkModalOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = paymentModalOpen ? paymentDialogRef.current : remarkDialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [paymentModalOpen, remarkModalOpen]);
  const origin = searchParams.get("from");
  const backLink =
    origin === "due-monitoring"
      ? { to: "/reports/overdue", label: "Back to Due Monitoring" }
      : { to: "/loans", label: "Back to Collections" };

  async function loadRemarks(targetLoanId: number) {
    setRemarksLoading(true);
    try {
      const data = await apiRequest<LoanRemark[]>(`/loans/${targetLoanId}/remarks`);
      setRemarks(data);
    } finally {
      setRemarksLoading(false);
    }
  }

  async function loadPayments(targetLoanId: number) {
    setPaymentsLoading(true);
    try {
      const data = await apiRequest<LoanPayment[]>(`/loans/${targetLoanId}/payments`);
      setPayments(data);
    } finally {
      setPaymentsLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isInteger(numericLoanId) || numericLoanId <= 0) {
      setLoan(null);
      setRemarks([]);
      setPayments([]);
      setError("Invalid loan selected.");
      setLoading(false);
      return;
    }

    async function fetchLoanWorkspace() {
      setDetailsExpanded(false);
      setPaymentPage(1);
      setRemarkPage(1);
      setLoading(true);
      setError("");
      setMessage("");

      try {
        const [loanData, remarkData, paymentData] = await Promise.all([
          apiRequest<LoanDetails>(`/loans/${numericLoanId}`),
          apiRequest<LoanRemark[]>(`/loans/${numericLoanId}/remarks`),
          apiRequest<LoanPayment[]>(`/loans/${numericLoanId}/payments`)
        ]);
        setLoan(loanData);
        setRemarks(remarkData);
        setPayments(paymentData);
      } catch (e) {
        setLoan(null);
        setRemarks([]);
        setPayments([]);
        setError(e instanceof Error ? e.message : "Unable to load loan details.");
      } finally {
        setLoading(false);
      }
    }

    void fetchLoanWorkspace();
  }, [numericLoanId]);

  async function handleAddRemark(event: React.FormEvent) {
    event.preventDefault();
    if (!loan || remarksSubmitting) return;

    const remark = remarkInput.trim();
    if (!remark) {
      setRemarkError("Enter a remark.");
      return;
    }

    setRemarksSubmitting(true);
    setRemarkError("");
    setMessage("");
    try {
      const attachment = await fileToAttachment(remarkAttachment);
      await apiRequest(`/loans/${loan.id}/remarks${editingRemarkId ? `/${editingRemarkId}` : ""}`, editingRemarkId ? "PATCH" : "POST", { remark, remarkCategory, attachment });
      setRemarkInput("");
      setRemarkAttachment(null);
      setEditingRemarkId(null);
      setRemarkModalOpen(false);
      setMessage(editingRemarkId ? "Remark updated." : "Remark added.");
      try {
        await loadRemarks(loan.id);
        setRemarkPage(1);
      } catch {
        setError("Remark was added, but the remarks list could not be refreshed. Reload the page to see it.");
      }
    } catch (e) {
      setRemarkError(e instanceof Error ? e.message : "Unable to add remark.");
    } finally {
      setRemarksSubmitting(false);
    }
  }

  async function handleAddPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!loan || paymentsSubmitting) return;

    const amount = Number(paymentAmount);
    const orNo = paymentOrNo.trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a valid payment amount.");
      return;
    }
    if (orNo.length > 80) {
      setPaymentError("OR No is too long.");
      return;
    }

    setPaymentsSubmitting(true);
    setPaymentError("");
    setMessage("");
    try {
      await apiRequest(`/loans/${loan.id}/payments${editingPaymentId ? `/${editingPaymentId}` : ""}`, editingPaymentId ? "PATCH" : "POST", {
        amount,
        orNo,
        collectedAt: paymentDateTime
      });
      setPaymentAmount("");
      setPaymentOrNo("");
      setPaymentDateTime(getLocalDateTimeInputValue());
      setEditingPaymentId(null);
      setPaymentModalOpen(false);
      setMessage(editingPaymentId ? "Payment updated." : "Payment recorded.");
      try {
        await loadPayments(loan.id);
        setPaymentPage(1);
      } catch {
        setError("Payment was recorded, but the payment list could not be refreshed. Reload the page to see it.");
      }
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Unable to record payment.");
    } finally {
      setPaymentsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <section className="panel p-5 text-sm text-slate-700">Loading loan details...</section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      {loan && summaryRemark && <RemarkSummaryModal
        open
        remark={summaryRemark.remark}
        category={summaryRemark.remarkCategory}
        createdAt={summaryRemark.createdAt}
        createdBy={summaryRemark.createdBy}
        member={{ name: loan.memberName, cifKey: loan.cifKey, contact: loan.contactInfo, address: loan.address }}
        loan={{ accountNo: loan.loanAccountNo, type: loan.loanType, status: loan.status, maturityDate: formatDate(loan.maturityDate) }}
        attachmentName={summaryRemark.attachmentName}
        onDownload={summaryRemark.attachmentName ? () => void apiDownload(
          `/loans/${loan.id}/remarks/${summaryRemark.id}/attachment`, summaryRemark.attachmentName || "attachment"
        ).catch(e => setError(e instanceof Error ? e.message : "Unable to download attachment")) : undefined}
        onClose={() => setSummaryRemark(null)}
      />}
      {paymentModalOpen && createPortal(
        <dialog ref={paymentDialogRef} aria-labelledby="payment-modal-title"
          className="modal-card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto backdrop:bg-slate-900/40"
          onCancel={event => { event.preventDefault(); if (!paymentsSubmitting) { setPaymentModalOpen(false); setEditingPaymentId(null); } }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="payment-modal-title" className="text-lg font-semibold">{editingPaymentId ? "Edit Payment" : "Add Payment"}</h2>
            <button type="button" className="btn-muted" disabled={paymentsSubmitting} onClick={() => { setPaymentModalOpen(false); setEditingPaymentId(null); }}>Close</button>
          </div>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleAddPayment}>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Amount
                  <input
                    className="field"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  OR No
                  <input
                    className="field"
                    value={paymentOrNo}
                    onChange={(event) => setPaymentOrNo(event.target.value)}
                    placeholder="Optional OR number"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80 sm:col-span-2">
                  Payment Date/Time
                  <input
                    className="field"
                    type="datetime-local"
                    value={paymentDateTime}
                    onChange={(event) => setPaymentDateTime(event.target.value)}
                    required
                  />
                </label>
                <div className="flex justify-stretch sm:col-span-2 sm:justify-end">
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled={paymentsSubmitting}>
                    {paymentsSubmitting ? "Saving..." : editingPaymentId ? "Update Payment" : "Save Payment"}
                  </button>
                </div>
              </form>

              {paymentError && <p role="alert" className="mt-3 text-sm text-red-700">{paymentError}</p>}

        </dialog>, document.body
      )}
      {remarkModalOpen && createPortal(
        <dialog ref={remarkDialogRef} aria-labelledby="remark-modal-title"
          className="modal-card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto backdrop:bg-slate-900/40"
          onCancel={event => { event.preventDefault(); if (!remarksSubmitting) { setRemarkModalOpen(false); setEditingRemarkId(null); } }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="remark-modal-title" className="text-lg font-semibold">{editingRemarkId ? "Edit Remark" : "Add Remark"}</h2>
            <button type="button" className="btn-muted" disabled={remarksSubmitting} onClick={() => { setRemarkModalOpen(false); setEditingRemarkId(null); }}>Close</button>
          </div>
              <form className="grid gap-3" onSubmit={handleAddRemark}>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Category
                  <select
                    className="field"
                    value={remarkCategory}
                    onChange={(event) => setRemarkCategory(event.target.value as RemarkCategory)}
                    required
                  >
                    {REMARK_CATEGORIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Remark
                  <textarea
                    className="field"
                    rows={4}
                    value={remarkInput}
                    onChange={(event) => setRemarkInput(event.target.value)}
                    placeholder="Add a loan remark..."
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Attachment (optional, max 5 MB)
                  <input className="field" type="file" onChange={event => setRemarkAttachment(event.target.files?.[0] ?? null)} />
                </label>
                <div className="flex justify-stretch sm:justify-end">
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled={remarksSubmitting}>
                    {remarksSubmitting ? "Saving..." : editingRemarkId ? "Update Remark" : "Save Remark"}
                  </button>
                </div>
              </form>

              {remarkError && <p role="alert" className="mt-3 text-sm text-red-700">{remarkError}</p>}

        </dialog>, document.body
      )}
      <PageHeader
        title="Loan Details"
        eyebrow="Collections"
        actions={
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Link to={backLink.to} className="btn-muted w-full sm:w-auto">
              {backLink.label}
            </Link>
            <PageMetaStamp />
          </div>
        }
      />

      {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loan && (
        <>
          <DuesCard principal={loan.principalDue} interest={loan.interest} penalty={loan.penaltyDue} />

          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="panel cursor-pointer p-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            role="button" tabIndex={0}
            aria-label={`${detailsExpanded ? "Collapse" : "Expand"} loan information for ${loan.memberName}`}
            aria-expanded={detailsExpanded} aria-controls="loan-information-details"
            onClick={() => setDetailsExpanded(expanded => !expanded)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setDetailsExpanded(expanded => !expanded);
              }
            }}>
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{loan.memberName}</h2>
                <p className="text-xs text-slate-600">
                  {loan.cifKey} | {loan.loanType}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={`${loan.status === "overdue" ? "status-danger" : loan.status === "closed" ? "status-warning" : "status-success"}`}>
                  {loan.status}
                </span>
              </div>
            </div>
            <div id="loan-information-details" hidden={!detailsExpanded}>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Detail label="Loan Account No" value={loan.loanAccountNo} />
              <Detail label="CIF Key" value={loan.cifKey} />
              <Detail label="Contact Info" value={loan.contactInfo || "-"} />
              <Detail label="Address" value={loan.address || "-"} />
              <Detail label="Date Release" value={formatDate(loan.dateRelease)} />
              <Detail label="Maturity Date" value={formatDate(loan.maturityDate)} />
              <Detail label="Loan Amount" value={formatCurrency(loan.loanAmount)} />
              <Detail label="Loan Balance" value={formatCurrency(loan.loanBalance)} />
              <Detail label="Principal Arrears" value={formatCurrency(loan.principalDue)} />
              <Detail label="Interest" value={formatCurrency(loan.interest)} />
              <Detail label="Fines" value={formatCurrency(loan.penaltyDue)} />
              <Detail label="Total" value={formatCurrency(loan.total)} />
              <Detail label="PAR Age" value={String(loan.parAge)} />
              <Detail label="Due Date" value={formatDate(loan.dueDate)} />
              <Detail label="Notes" value={loan.notes?.trim() ? loan.notes : "-"} />
            </div>
            </div>
          </motion.section>

          <section className="panel p-4">
            <div className="mb-4 flex gap-2 border-b border-slate-200" role="tablist" aria-label="Loan activity">
              <button
                type="button"
                role="tab"
                aria-selected={historyTab === "remarks"}
                className={`border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  historyTab === "remarks"
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setHistoryTab("remarks")}
              >
                Remarks
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={historyTab === "payments"}
                className={`border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  historyTab === "payments"
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setHistoryTab("payments")}
              >
                Payments
              </button>
            </div>

            {historyTab === "payments" ? (
              <div role="tabpanel">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">Payments</h2>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button type="button" className="btn-primary" onClick={() => {
                    setPaymentError("");
                    setEditingPaymentId(null);
                    setPaymentAmount("");
                    setPaymentOrNo("");
                    setPaymentDateTime(getLocalDateTimeInputValue());
                    setPaymentModalOpen(true);
                  }}>Add Payment</button>
                </div>
              </div>

              {paymentsLoading && <p className="mt-3 text-sm text-slate-600">Loading payments...</p>}

              <div className="surface-soft mt-3 max-h-[28rem] overflow-y-auto">
                {payments.length === 0 && !paymentsLoading ? (
                  <p className="p-3 text-sm text-slate-600">No payments yet.</p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {payments.slice((currentPaymentPage - 1) * HISTORY_PAGE_SIZE, currentPaymentPage * HISTORY_PAGE_SIZE).map((item) => (
                      <li key={item.id} className="p-3">
                        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-start">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{formatCurrency(item.amount)}</p>
                            <p className="text-xs text-black/60">OR No: {item.orNo || "-"}</p>
                            <p className="text-xs text-black/60">Collected By: {item.collectedBy || "System"}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-black/60">{item.paymentId}</span>
                            <button type="button" className="btn-muted h-8 px-3 text-xs" onClick={() => {
                              setEditingPaymentId(item.id);
                              setPaymentAmount(String(item.amount));
                              setPaymentOrNo(item.orNo || "");
                              setPaymentDateTime(toLocalDateTimeInputValue(item.collectedAt));
                              setPaymentError("");
                              setPaymentModalOpen(true);
                            }}>Edit</button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-black/60">{formatDateTime(item.collectedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <HistoryPagination label="Payments" page={currentPaymentPage} pages={paymentPages} onChange={setPaymentPage} disabled={paymentsLoading} />
              </div>
            ) : (
              <div role="tabpanel">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">Loan Remarks</h2>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button type="button" className="btn-primary" onClick={() => {
                    setRemarkError("");
                    setEditingRemarkId(null);
                    setRemarkInput("");
                    setRemarkCategory(DEFAULT_REMARK_CATEGORY);
                    setRemarkAttachment(null);
                    setRemarkModalOpen(true);
                  }}>Add Remark</button>
                </div>
              </div>

              {remarksLoading && <p className="mt-3 text-sm text-slate-600">Loading remarks...</p>}

              <div className="surface-soft mt-3 max-h-[28rem] overflow-y-auto">
                {remarks.length === 0 && !remarksLoading ? (
                  <p className="p-3 text-sm text-slate-600">No remarks yet.</p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {remarks.slice((currentRemarkPage - 1) * HISTORY_PAGE_SIZE, currentRemarkPage * HISTORY_PAGE_SIZE).map((item) => (
                      <li key={item.id} className="relative cursor-pointer p-3 pr-20 transition hover:bg-white/60" role="button" tabIndex={0}
                        onClick={() => setSummaryRemark(item)}
                        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSummaryRemark(item); } }}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {getRemarkCategoryLabel(item.remarkCategory)}
                        </p>
                        <p className="text-sm text-slate-900">{item.remark}</p>
                        <p className="mt-1 text-xs text-black/60">
                          {formatDateTime(item.createdAt)} | By: {item.createdBy}
                        </p>
                        <button type="button" className="btn-muted absolute right-3 top-3 h-8 px-3 text-xs" onClick={event => {
                          event.stopPropagation();
                          setEditingRemarkId(item.id);
                          setRemarkInput(item.remark);
                          setRemarkCategory(item.remarkCategory as RemarkCategory);
                          setRemarkError("");
                          setRemarkAttachment(null);
                          setRemarkModalOpen(true);
                        }}>Edit</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <HistoryPagination label="Remarks" page={currentRemarkPage} pages={remarkPages} onChange={setRemarkPage} disabled={remarksLoading} />
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <article className="surface-soft p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
    </article>
  );
}

function HistoryPagination({ label, page, pages, onChange, disabled }: {
  label: string; page: number; pages: number; onChange: (page: number) => void; disabled: boolean;
}) {
  return <nav aria-label={label + " pagination"} className="mt-4 flex items-center justify-between gap-2">
    <button type="button" className="btn-muted" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span className="text-sm text-slate-600" aria-live="polite">Page {page} of {pages}</span>
    <button type="button" className="btn-muted" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}
