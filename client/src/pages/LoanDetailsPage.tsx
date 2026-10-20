import { newRequestId } from "../services/requestId";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams, useParams } from "react-router-dom";
import { DuesCard } from "../components/DuesCard";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../services/permissions";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { RemarkSummaryModal } from "../components/RemarkSummaryModal";
import { ToastNotification } from "../components/ToastNotification";
import { actionStatusClass, DEFAULT_REMARK_CATEGORY, getRemarkCategoryLabel, PAYMENT_STATUSES, paymentStatusLabel, REMARK_CATEGORIES, type PaymentStatus, type RemarkCategory } from "../constants/remarkCategories";
import { apiBlobUrl, apiDownload, apiRequest } from "../services/api";
import { fileToAttachment } from "../services/attachments";
import { MapLink, PaymentProofField, proofPayload, RemarkEvidenceField, remarkEvidencePayload, type PaymentProofUpload , type RemarkEvidence } from "../components/FieldEvidence";
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
  const { user } = useAuth();
  const { loanId = "0" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const numericLoanId = Number(loanId);
  const [loan, setLoan] = useState<LoanDetails | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [remarks, setRemarks] = useState<LoanRemark[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [historyTab, setHistoryTab] = useState<"payments" | "remarks">(searchParams.get("tab") === "payments" ? "payments" : "remarks");
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
  const [remarkProof, setRemarkProof] = useState<RemarkEvidence | null>(null);
  const [editingHasEvidence, setEditingHasEvidence] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentOrNo, setPaymentOrNo] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const [paymentProof, setPaymentProof] = useState<PaymentProofUpload | null>(null);
  // One id per payment form: a double tap or retry returns the saved payment instead of a second one.
  const paymentRequestId = useRef(newRequestId());
  const [editingPaymentHasProof, setEditingPaymentHasProof] = useState(false);
  const [paymentDateTime, setPaymentDateTime] = useState(getLocalDateTimeInputValue());
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [remarkModalOpen, setRemarkModalOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [editingRemarkId, setEditingRemarkId] = useState<number | null>(null);
  const [confirmingRemarkDelete, setConfirmingRemarkDelete] = useState(false);
  const [summaryPayment, setSummaryPayment] = useState<LoanPayment | null>(null);
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
  useEffect(() => {
    setHistoryTab(searchParams.get("tab") === "payments" ? "payments" : "remarks");
  }, [numericLoanId, searchParams]);

  const origin = searchParams.get("from");
  const backLink =
    origin === "due-monitoring"
      ? { to: "/reports/overdue", label: "Back to Due Monitoring" }
      : origin === "settled"
        ? { to: "/loans?tab=settled", label: "Back to Settled Accounts" }
      : origin === "payments"
        ? { to: "/loans?tab=payments", label: "Back to Payments" }
        : origin === "remarks"
        ? { to: "/loans?tab=remarks", label: "Back to Actions Taken" }
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

  useEffect(() => {
    const requestedId = Number(searchParams.get("paymentId"));
    if (loading || loan?.id !== numericLoanId || !Number.isInteger(requestedId) || requestedId <= 0) return;
    const payment = payments.find(item => item.id === requestedId);
    if (payment) {
      setHistoryTab("payments");
      setSummaryPayment(payment);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("paymentId");
    setSearchParams(nextParams, { replace: true });
  }, [loading, loan, numericLoanId, payments, searchParams, setSearchParams]);

  async function handleAddRemark(event: React.FormEvent) {
    event.preventDefault();
    if (!loan || remarksSubmitting) return;

    const remark = remarkInput.trim();
    if (!remark) {
      setRemarkError("Enter an action taken.");
      return;
    }

    setRemarksSubmitting(true);
    setRemarkError("");
    setMessage("");
    try {
      await apiRequest(`/loans/${loan.id}/remarks${editingRemarkId ? `/${editingRemarkId}` : ""}`, editingRemarkId ? "PATCH" : "POST", { remark, remarkCategory, ...remarkEvidencePayload(remarkProof, Boolean(editingRemarkId)) });
      setRemarkInput("");
      setRemarkProof(null);
      setEditingRemarkId(null);
      setEditingHasEvidence(false);
      setRemarkModalOpen(false);
      setMessage(editingRemarkId ? "Action taken updated." : "Action taken added.");
      try {
        await loadRemarks(loan.id);
        setRemarkPage(1);
      } catch {
        setError("Action taken was added, but the actions taken list could not be refreshed. Reload the page to see it.");
      }
    } catch (e) {
      setRemarkError(e instanceof Error ? e.message : "Unable to add action taken.");
    } finally {
      setRemarksSubmitting(false);
    }
  }

  async function handleDeleteRemark() {
    if (!loan || !editingRemarkId || remarksSubmitting) return;
    setRemarksSubmitting(true);
    setRemarkError("");
    try {
      await apiRequest(`/loans/${loan.id}/remarks/${editingRemarkId}`, "DELETE");
      setEditingRemarkId(null);
      setEditingHasEvidence(false);
      setConfirmingRemarkDelete(false);
      setRemarkModalOpen(false);
      setMessage("Action taken deleted.");
      await loadRemarks(loan.id)
        .catch(() => setError("Action taken was deleted, but the list could not be refreshed. Reload the page."));
    } catch (e) {
      setRemarkError(e instanceof Error ? e.message : "Unable to delete action taken.");
    } finally {
      setRemarksSubmitting(false);
    }
  }

  async function openPaymentProof(paymentId: number, proof: { kind: string; fileName: string }) {
    if (!loan) return;
    const path = `/loans/${loan.id}/payments/${paymentId}/proof`;
    try {
      // Photos open in a new tab; attached files download.
      if (proof.kind === "photo") window.open(await apiBlobUrl(path), "_blank", "noopener");
      else await apiDownload(path, proof.fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open the payment proof.");
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
    if (!paymentStatus) {
      setPaymentError("Choose the payment type.");
      return;
    }
    if (!paymentProof && !(editingPaymentId && editingPaymentHasProof)) {
      setPaymentError("Add a photo or an attachment, with location, as proof of payment.");
      return;
    }

    setPaymentsSubmitting(true);
    setPaymentError("");
    setMessage("");
    try {
      await apiRequest(`/loans/${loan.id}/payments${editingPaymentId ? `/${editingPaymentId}` : ""}`, editingPaymentId ? "PATCH" : "POST", {
        amount,
        orNo,
        collectedAt: paymentDateTime,
        paymentStatus,
        proof: proofPayload(paymentProof),
        ...(editingPaymentId ? {} : { requestId: paymentRequestId.current })
      });
      paymentRequestId.current = newRequestId();
      setPaymentAmount("");
      setPaymentProof(null);
      setPaymentOrNo("");
      setPaymentDateTime(getLocalDateTimeInputValue());
      setEditingPaymentId(null);
      setPaymentModalOpen(false);
      setMessage(editingPaymentId ? "Payment updated." : "Payment recorded.");
      try {
        await loadPayments(loan.id);
        setPaymentPage(1);
        // The loan's status follows its newest payment.
        setLoan(await apiRequest<LoanDetails>(`/loans/${loan.id}`));
      } catch {
        setError("Payment was recorded, but the payment list could not be refreshed. Reload the page to see it.");
      }
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Unable to record payment.");
    } finally {
      setPaymentsSubmitting(false);
    }
  }

  // Escape closes the payment summary and the loan details window (the forms are native dialogs).
  useEscapeToClose(Boolean(summaryPayment), () => setSummaryPayment(null));
  useEscapeToClose(detailsExpanded, () => setDetailsExpanded(false));

  if (loading) {
    return (
      <main className="page-shell">
        <section className="panel p-5 text-sm text-slate-700">Loading loan details...</section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      {loan && summaryPayment && createPortal(
        <section className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="payment-summary-title"
          onMouseDown={event => { if (event.target === event.currentTarget) setSummaryPayment(null); }}>
          <div className="modal-card max-w-3xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="payment-summary-title" className="text-xl font-semibold">Payment Summary</h2>
              <button type="button" autoFocus className="btn-muted" onClick={() => setSummaryPayment(null)}>Close</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Detail label="Amount" value={formatCurrency(summaryPayment.amount)} />
              <Detail label="Payment ID" value={summaryPayment.paymentId} />
              <Detail label="OR No" value={summaryPayment.orNo || "-"} />
              <Detail label="Collected By" value={summaryPayment.collectedBy || "System"} />
              <Detail label="Collected At" value={formatDateTime(summaryPayment.collectedAt)} />
              <Detail label="Member Name" value={loan.memberName} />
              <Detail label="CIF Key" value={loan.cifKey} />
              <Detail label="Loan Account No" value={loan.loanAccountNo} />
              <Detail label="Loan Type" value={loan.loanType} />
            </div>
          </div>
        </section>, document.body
      )}
      {loan && summaryRemark && <RemarkSummaryModal
        open
        remark={summaryRemark.remark}
        category={summaryRemark.remarkCategory}
        createdAt={summaryRemark.createdAt}
        createdBy={summaryRemark.createdBy}
        member={{ name: loan.memberName, cifKey: loan.cifKey, contact: loan.contactInfo, address: loan.address }}
        loan={{ accountNo: loan.loanAccountNo, type: loan.loanType, status: loan.status, maturityDate: formatDate(loan.maturityDate) }}
        attachmentName={summaryRemark.attachmentName}
        photo={summaryRemark.photo}
        photoPath={`/loans/${loan.id}/remarks/${summaryRemark.id}/photo`}
        onDownload={summaryRemark.attachmentName ? () => void apiDownload(
          `/loans/${loan.id}/remarks/${summaryRemark.id}/attachment`, summaryRemark.attachmentName || "attachment"
        ).catch(e => setError(e instanceof Error ? e.message : "Unable to download attachment")) : undefined}
        onClose={() => setSummaryRemark(null)}
      />}
      {paymentModalOpen && createPortal(
        <dialog ref={paymentDialogRef} aria-labelledby="payment-modal-title"
          className="modal-card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto backdrop:bg-slate-900/50 backdrop:backdrop-blur-[3px]"
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
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Payment Type
                  <select className="field" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)} required>
                    <option value="" disabled>Choose payment type...</option>
                    {PAYMENT_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Payment Date/Time
                  <input
                    className="field"
                    type="datetime-local"
                    value={paymentDateTime}
                    onChange={(event) => setPaymentDateTime(event.target.value)}
                    required
                  />
                </label>
                <div className="sm:col-span-2">
                  <PaymentProofField proof={paymentProof} onChange={setPaymentProof} hasExisting={Boolean(editingPaymentId) && editingPaymentHasProof} disabled={paymentsSubmitting} />
                </div>
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
          className="modal-card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto backdrop:bg-slate-900/50 backdrop:backdrop-blur-[3px]"
          onCancel={event => { event.preventDefault(); if (!remarksSubmitting) { setRemarkModalOpen(false); setEditingRemarkId(null); } }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="remark-modal-title" className="text-lg font-semibold">{editingRemarkId ? "Edit Action Taken" : "Add Action Taken"}</h2>
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
                    placeholder="Describe the action taken..."
                    required
                  />
                </label>
                <RemarkEvidenceField proof={remarkProof} onChange={setRemarkProof} hasExisting={Boolean(editingRemarkId) && editingHasEvidence} disabled={remarksSubmitting} />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {editingRemarkId && (confirmingRemarkDelete ? (
                    <div className="flex flex-wrap items-center gap-2 sm:mr-auto" role="group" aria-label="Confirm action taken deletion">
                      <span className="text-sm text-red-700">Delete this action taken?</span>
                      <button type="button" className="btn-danger h-9 px-3" disabled={remarksSubmitting} onClick={() => void handleDeleteRemark()}>Yes, delete</button>
                      <button type="button" className="btn-muted h-9 px-3" disabled={remarksSubmitting} onClick={() => setConfirmingRemarkDelete(false)}>Keep</button>
                    </div>
                  ) : (
                    <button type="button" className="btn-muted w-full text-red-700 sm:mr-auto sm:w-auto" disabled={remarksSubmitting} onClick={() => setConfirmingRemarkDelete(true)}>Delete Action Taken</button>
                  ))}
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled={remarksSubmitting}>
                    {remarksSubmitting ? "Saving..." : editingRemarkId ? "Update Action Taken" : "Save Action Taken"}
                  </button>
                </div>
              </form>

              {remarkError && <p role="alert" className="mt-3 text-sm text-red-700">{remarkError}</p>}

        </dialog>, document.body
      )}
      <PageHeader
        title="Loan Details"
        eyebrow="Collections"
        actionsTopRight
        actions={<PageMetaStamp />}
        footer={
          <Link to={backLink.to} className="btn-muted w-full sm:w-auto">
            {backLink.label}
          </Link>
        }
      />

      {error ? <ToastNotification message={error} tone="error" onClose={() => setError("")} />
        : message ? <ToastNotification message={message} tone="success" onClose={() => setMessage("")} /> : null}

      {loan && (
        <>
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="panel cursor-pointer p-4 text-sm transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            role="button" tabIndex={0} aria-haspopup="dialog"
            aria-label={`View loan details for ${loan.memberName}`}
            onClick={() => setDetailsExpanded(true)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setDetailsExpanded(true);
              }
            }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-brand-700 underline decoration-brand-200 underline-offset-4">{loan.memberName}</h2>
                <p className="text-xs text-slate-600">
                  {loan.cifKey} | {loan.loanType}
                </p>
                <p className="mt-1 text-xs text-slate-500">Tap to view loan details</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`${loan.status === "overdue" ? "status-danger" : loan.status === "closed" ? "status-warning" : "status-success"}`}>
                  {loan.status}
                </span>
                {loan.actionStatus && <span className={actionStatusClass(loan.actionStatus)} title="Latest payment">{paymentStatusLabel(loan.actionStatus)}</span>}
              </div>
            </div>
          </motion.section>

          {/* Loan details live in a window opened from the member's name, keeping the page short on phones. */}
          {detailsExpanded && createPortal(
            <div className="modal-sheet-shell" role="presentation" onMouseDown={() => setDetailsExpanded(false)}>
              <section className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-2xl sm:p-6"
                role="dialog" aria-modal="true" aria-labelledby="loan-details-title" onMouseDown={event => event.stopPropagation()}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loan details</p>
                    <h2 id="loan-details-title" className="mt-1 break-words text-xl font-bold text-slate-900">{loan.memberName}</h2>
                    <p className="text-xs text-slate-600">{loan.cifKey} | {loan.loanType}</p>
                  </div>
                  <button type="button" className="btn-muted shrink-0" autoFocus onClick={() => setDetailsExpanded(false)}>Close</button>
                </div>
                <DuesCard principal={loan.principalDue} interest={loan.interest} penalty={loan.penaltyDue} />
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              </section>
            </div>,
            document.body
          )}

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
                Actions Taken
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
                  <p className="mt-1 text-sm text-slate-600">
                    Status:{" "}
                    {loan.actionStatus
                      ? <><span className={actionStatusClass(loan.actionStatus)}>{paymentStatusLabel(loan.actionStatus)}</span>
                        <span className="ml-2 text-xs text-slate-500">{loan.actionStatusAt ? formatDateTime(loan.actionStatusAt) : ""}{loan.actionStatusBy ? ` · ${loan.actionStatusBy}` : ""}</span></>
                      : <span className="text-slate-500">No payment yet</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {hasPermission(user, "add_payments") && <button type="button" className="btn-primary" onClick={() => {
                    setPaymentError("");
                    setEditingPaymentId(null);
                    setPaymentAmount("");
                    setPaymentOrNo("");
                    setPaymentStatus("");
                    setPaymentProof(null);
                    setEditingPaymentHasProof(false);
                    setPaymentDateTime(getLocalDateTimeInputValue());
                    paymentRequestId.current = newRequestId();
                    setPaymentModalOpen(true);
                  }}>Add Payment</button>}
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
                            <p className="text-sm font-semibold text-slate-900">
                              {formatCurrency(item.amount)}
                              {item.paymentStatus && <span className={`ml-2 align-middle ${actionStatusClass(item.paymentStatus)}`}>{paymentStatusLabel(item.paymentStatus)}</span>}
                            </p>
                            <p className="text-xs text-black/60">OR No: {item.orNo || "-"}</p>
                            <p className="text-xs text-black/60">Collected By: {item.collectedBy || "System"}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-black/60">{item.paymentId}</span>
                            {item.canEdit !== false && <button type="button" className="btn-muted h-8 px-3 text-xs" onClick={() => {
                              setEditingPaymentId(item.id);
                              setPaymentAmount(String(item.amount));
                              setPaymentOrNo(item.orNo || "");
                              setPaymentStatus(item.paymentStatus === "settled" || item.paymentStatus === "partial" ? item.paymentStatus : "");
                              setPaymentProof(null);
                              setEditingPaymentHasProof(Boolean(item.proof));
                              setPaymentDateTime(toLocalDateTimeInputValue(item.collectedAt));
                              setPaymentError("");
                              paymentRequestId.current = newRequestId();
                              setPaymentModalOpen(true);
                            }}>Edit</button>}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-black/60">{formatDateTime(item.collectedAt)}</p>
                        {item.proof && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => void openPaymentProof(item.id, item.proof!)}>
                            {item.proof.kind === "photo" ? "View photo" : `Open ${item.proof.fileName}`}
                          </button>
                          <MapLink point={item.proof} />
                        </div>}
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
                  <h2 className="text-lg font-semibold text-slate-900">Loan Actions Taken</h2>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {hasPermission(user, "add_remarks") && <button type="button" className="btn-primary" onClick={() => {
                    setRemarkError("");
                    setEditingRemarkId(null);
                    setEditingHasEvidence(false);
                    setRemarkInput("");
                    setRemarkCategory(DEFAULT_REMARK_CATEGORY);
                    setRemarkProof(null);
                    setRemarkModalOpen(true);
                  }}>Add Action Taken</button>}
                </div>
              </div>

              {remarksLoading && <p className="mt-3 text-sm text-slate-600">Loading actions taken...</p>}

              <div className="surface-soft mt-3 max-h-[28rem] overflow-y-auto">
                {remarks.length === 0 && !remarksLoading ? (
                  <p className="p-3 text-sm text-slate-600">No actions taken yet.</p>
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
                          {item.location && <span className="mt-1 block"><MapLink point={item.location} /></span>}
                          {item.photo && <span className="ml-2 inline-flex items-center gap-1 text-slate-500"><Camera size={12} aria-hidden="true" />Photo{item.photo.latitude != null ? " · geotagged" : ""}</span>}
                        </p>
                        {item.canEdit !== false && <button type="button" className="btn-muted absolute right-3 top-3 h-8 px-3 text-xs" onClick={event => {
                          event.stopPropagation();
                          setEditingRemarkId(item.id);
                          setEditingHasEvidence(Boolean(item.attachmentName || item.photo));
                          setConfirmingRemarkDelete(false);
                          setRemarkInput(item.remark);
                          setRemarkCategory(item.remarkCategory as RemarkCategory);
                          setRemarkError("");
                          setRemarkProof(null);
                          setRemarkModalOpen(true);
                        }}>Edit</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <HistoryPagination label="Actions Taken" page={currentRemarkPage} pages={remarkPages} onChange={setRemarkPage} disabled={remarksLoading} />
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
