import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, useSearchParams, useParams } from "react-router-dom";
import { DuesCard } from "../components/DuesCard";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { DEFAULT_REMARK_CATEGORY, getRemarkCategoryLabel, REMARK_CATEGORIES, type RemarkCategory } from "../constants/remarkCategories";
import { apiRequest } from "../services/api";
import type { Loan, LoanPayment, LoanRemark } from "../types/models";

interface LoanDetails extends Loan {
  cifKey: string;
  memberName: string;
  contactInfo: string;
  address: string;
}

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

export function LoanDetailsPage() {
  const { loanId = "0" } = useParams();
  const [searchParams] = useSearchParams();
  const numericLoanId = Number(loanId);
  const [loan, setLoan] = useState<LoanDetails | null>(null);
  const [remarks, setRemarks] = useState<LoanRemark[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
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
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentOrNo, setPaymentOrNo] = useState("");
  const [paymentDateTime, setPaymentDateTime] = useState(getLocalDateTimeInputValue());
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
    if (!loan) return;

    const remark = remarkInput.trim();
    if (!remark) {
      setRemarkError("Enter a remark.");
      return;
    }

    setRemarksSubmitting(true);
    setRemarkError("");
    setMessage("");
    try {
      await apiRequest(`/loans/${loan.id}/remarks`, "POST", { remark, remarkCategory });
      setRemarkInput("");
      await loadRemarks(loan.id);
      setMessage("Remark added.");
    } catch (e) {
      setRemarkError(e instanceof Error ? e.message : "Unable to add remark.");
    } finally {
      setRemarksSubmitting(false);
    }
  }

  async function handleAddPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!loan) return;

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
      await apiRequest(`/loans/${loan.id}/payments`, "POST", {
        amount,
        orNo,
        collectedAt: paymentDateTime
      });
      setPaymentAmount("");
      setPaymentOrNo("");
      setPaymentDateTime(getLocalDateTimeInputValue());
      await loadPayments(loan.id);
      setMessage("Payment recorded.");
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
      <PageHeader
        title="Loan Details"
        subtitle={loan ? `${loan.loanAccountNo} | ${loan.memberName}` : "Loan account view"}
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
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-4 text-sm">
            <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{loan.memberName}</h2>
                <p className="text-xs text-slate-600">
                  {loan.cifKey} | {loan.loanType}
                </p>
              </div>
              <span className={`${loan.status === "overdue" ? "status-danger" : loan.status === "closed" ? "status-warning" : "status-success"}`}>
                {loan.status}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Detail label="Loan Account No" value={loan.loanAccountNo} />
              <Detail label="CIF Key" value={loan.cifKey} />
              <Detail label="Contact Info" value={loan.contactInfo || "-"} />
              <Detail label="Address" value={loan.address || "-"} />
              <Detail label="Date Release" value={formatDate(loan.dateRelease)} />
              <Detail label="Maturity Date" value={formatDate(loan.maturityDate)} />
              <Detail label="Loan Amount" value={formatCurrency(loan.loanAmount)} />
              <Detail label="Other Charges" value={formatCurrency(loan.otherCharges)} />
              <Detail label="PAR Age" value={String(loan.parAge)} />
              <Detail label="Due Date" value={formatDate(loan.dueDate)} />
              <Detail label="Notes" value={loan.notes?.trim() ? loan.notes : "-"} />
            </div>
          </motion.section>

          <DuesCard principal={loan.principalDue} interest={loan.interest} penalty={loan.penaltyDue} />

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="panel p-4">
              <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">Add Payments</h2>
                  <p className="text-xs text-slate-600">Payments recorded here are for tracking only. Loan balances do not change automatically.</p>
                </div>
                <span className="glass-pill">{payments.length} payment(s)</span>
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
                    {paymentsSubmitting ? "Saving..." : "Save Payment"}
                  </button>
                </div>
              </form>

              {paymentError && <p className="mt-3 text-sm text-red-700">{paymentError}</p>}
              {paymentsLoading && <p className="mt-3 text-sm text-slate-600">Loading payments...</p>}

              <div className="surface-soft mt-3 max-h-[28rem] overflow-y-auto">
                {payments.length === 0 && !paymentsLoading ? (
                  <p className="p-3 text-sm text-slate-600">No payments yet.</p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {payments.map((item) => (
                      <li key={item.id} className="p-3">
                        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-start">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{formatCurrency(item.amount)}</p>
                            <p className="text-xs text-black/60">OR No: {item.orNo || "-"}</p>
                            <p className="text-xs text-black/60">Collected By: {item.collectedBy || "System"}</p>
                          </div>
                          <span className="text-xs text-black/60">{item.paymentId}</span>
                        </div>
                        <p className="mt-1 text-xs text-black/60">{formatDateTime(item.collectedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="panel p-4">
              <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">Loan Remarks</h2>
                  <p className="text-xs text-slate-600">Track collection updates and follow-up notes on this loan.</p>
                </div>
                <span className="glass-pill">{remarks.length} remark(s)</span>
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
                <div className="flex justify-stretch sm:justify-end">
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled={remarksSubmitting}>
                    {remarksSubmitting ? "Saving..." : "Add Remark"}
                  </button>
                </div>
              </form>

              {remarkError && <p className="mt-3 text-sm text-red-700">{remarkError}</p>}
              {remarksLoading && <p className="mt-3 text-sm text-slate-600">Loading remarks...</p>}

              <div className="surface-soft mt-3 max-h-[28rem] overflow-y-auto">
                {remarks.length === 0 && !remarksLoading ? (
                  <p className="p-3 text-sm text-slate-600">No remarks yet.</p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {remarks.map((item) => (
                      <li key={item.id} className="p-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {getRemarkCategoryLabel(item.remarkCategory)}
                        </p>
                        <p className="text-sm text-slate-900">{item.remark}</p>
                        <p className="mt-1 text-xs text-black/60">
                          {formatDateTime(item.createdAt)} | By: {item.createdBy}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
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
