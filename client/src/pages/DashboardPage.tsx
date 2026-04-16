import { motion } from "framer-motion";
import { Activity, AlertTriangle, BarChart3, TrendingUp, Users, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";
import type { DashboardMetrics, OverdueAccount } from "../types/models";

interface AnalyticsOverview {
  overdueRate: number;
  collectionEfficiency: number;
  activeLoans: number;
}

interface DashboardPayment {
  id: number;
  paymentId: string;
  loanId: number;
  loanAccountNo: string;
  memberName: string;
  amount: number;
  collectedAt: string;
}

type LoanStatus = "active" | "overdue" | "closed";

interface DashboardLoan {
  id: number;
  loanAccountNo: string;
  memberName: string;
  loanType: string;
  maturityDate: string;
  principalDue: number;
  penaltyDue: number;
  interest: number;
  otherCharges: number;
  status: LoanStatus;
}

interface DueSoonLoan extends DashboardLoan {
  daysUntilDue: number;
  outstanding: number;
}

const DASHBOARD_TABLE_PAGE_SIZE = 8;

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return pesoFormatter.format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(1)}%`;
}

function formatDate(value: string, includeTime = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return includeTime ? parsed.toLocaleString() : parsed.toLocaleDateString();
}

function loanOutstanding(loan: DashboardLoan): number {
  return (
    (loan.principalDue ?? 0) +
    (loan.interest ?? 0) +
    (loan.penaltyDue ?? 0) +
    (loan.otherCharges ?? 0)
  );
}

function daysUntil(dateText: string): number | null {
  const due = new Date(dateText);
  if (Number.isNaN(due.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) {
    return `${Math.abs(daysUntilDue)} day(s) overdue`;
  }
  if (daysUntilDue === 0) {
    return "Due today";
  }
  return `Due in ${daysUntilDue} day(s)`;
}

function dueTone(daysUntilDue: number): string {
  if (daysUntilDue < 0) {
    return "status-danger";
  }
  if (daysUntilDue === 0) {
    return "status-warning";
  }
  if (daysUntilDue <= 7) {
    return "status-warning";
  }
  return "status-success";
}

function overdueLabel(daysOverdue: number): string {
  if (daysOverdue >= 365) {
    const years = Math.floor(daysOverdue / 365);
    const remainingDays = daysOverdue % 365;
    if (remainingDays >= 30) {
      const months = Math.floor(remainingDays / 30);
      return `${years} yr ${months} mo overdue`;
    }
    return `${years} yr overdue`;
  }

  if (daysOverdue >= 30) {
    const months = Math.floor(daysOverdue / 30);
    const remainingDays = daysOverdue % 30;
    if (remainingDays > 0) {
      return `${months} mo ${remainingDays} d overdue`;
    }
    return `${months} mo overdue`;
  }

  return `${daysOverdue} day(s) overdue`;
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  onViewMore
}: {
  label: string;
  value: string;
  hint?: string;
  icon: JSX.Element;
  onViewMore?: () => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="panel relative overflow-hidden p-4"
    >
      <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-c2/15 blur-2xl" />
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
          <h2 className="mt-2 break-words text-[clamp(1.1rem,1.8vw,1.45rem)] font-bold leading-tight text-slate-900">{value}</h2>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/70 text-c2">
          {icon}
        </span>
      </div>
      {hint && <p className="relative mt-2 text-xs leading-snug text-slate-600">{hint}</p>}
      {onViewMore && (
        <button type="button" className="relative mt-3 text-xs font-semibold text-c2 transition hover:text-c2/80" onClick={onViewMore}>
          View More
        </button>
      )}
    </motion.article>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems === 0) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, currentPage * pageSize);

  return (
    <div className="pagination-bar">
      <p className="text-xs text-slate-600">
        Showing {startItem}-{endItem} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-muted btn-page"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <p className="text-xs font-semibold text-slate-700">
          Page {currentPage} of {totalPages}
        </p>
        <button
          type="button"
          className="btn-muted btn-page"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canViewAnalytics = user?.role === "super_admin" || user?.role === "branch_admin";

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [overdueRows, setOverdueRows] = useState<OverdueAccount[]>([]);
  const [payments, setPayments] = useState<DashboardPayment[]>([]);
  const [loans, setLoans] = useState<DashboardLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dueSoonPage, setDueSoonPage] = useState(1);
  const [overduePage, setOverduePage] = useState(1);

  useEffect(() => {
    let active = true;

    async function loadDashboardData() {
      setLoading(true);
      setError("");

      const analyticsRequest: Promise<AnalyticsOverview | null> = canViewAnalytics
        ? apiRequest<AnalyticsOverview>("/analytics/overview")
        : Promise.resolve(null);

      const [metricsResult, analyticsResult, overdueResult, paymentsResult, loansResult] = await Promise.allSettled([
        apiRequest<DashboardMetrics>("/dashboard/metrics"),
        analyticsRequest,
        apiRequest<OverdueAccount[]>("/reports/overdue"),
        apiRequest<DashboardPayment[]>("/payments"),
        apiRequest<DashboardLoan[]>("/loans")
      ]);

      if (!active) return;

      if (metricsResult.status === "fulfilled") {
        setMetrics(metricsResult.value);
      } else {
        setMetrics(null);
        setError(metricsResult.reason instanceof Error ? metricsResult.reason.message : "Unable to load dashboard metrics.");
      }

      setAnalytics(analyticsResult.status === "fulfilled" ? analyticsResult.value : null);
      setOverdueRows(overdueResult.status === "fulfilled" ? overdueResult.value : []);
      setPayments(paymentsResult.status === "fulfilled" ? paymentsResult.value : []);
      setLoans(loansResult.status === "fulfilled" ? loansResult.value : []);
      setLoading(false);
    }

    void loadDashboardData();

    return () => {
      active = false;
    };
  }, [canViewAnalytics]);

  const statusCounts = useMemo(
    () =>
      loans.reduce(
        (totals, loan) => {
          if (loan.status === "active") totals.active += 1;
          if (loan.status === "overdue") totals.overdue += 1;
          if (loan.status !== "closed") totals.total += 1;
          return totals;
        },
        { active: 0, overdue: 0, total: 0 }
      ),
    [loans]
  );

  const dueSoonRows = useMemo<DueSoonLoan[]>(
    () =>
      loans
        .filter((loan) => loan.status !== "closed")
        .map((loan) => {
          const daysUntilDue = daysUntil(loan.maturityDate);
          return {
            ...loan,
            daysUntilDue: daysUntilDue ?? Number.MAX_SAFE_INTEGER,
            outstanding: loanOutstanding(loan)
          };
        })
        .filter((loan) => loan.daysUntilDue !== Number.MAX_SAFE_INTEGER && loan.daysUntilDue >= 0)
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    [loans]
  );

  const overdueTableRows = useMemo(
    () =>
      [...overdueRows]
        .sort((a, b) => a.daysOverdue - b.daysOverdue || b.totalOutstanding - a.totalOutstanding),
    [overdueRows]
  );

  const recentCollections = useMemo(() => {
    const openLoanIds = new Set(loans.filter((loan) => loan.status !== "closed").map((loan) => loan.id));
    return payments.filter((payment) => openLoanIds.has(payment.loanId)).slice(0, 7);
  }, [loans, payments]);

  const openLoans = analytics?.activeLoans ?? statusCounts.active + statusCounts.overdue;
  const overdueRate =
    analytics?.overdueRate ??
    (openLoans > 0 ? (statusCounts.overdue / openLoans) * 100 : 0);
  const overdueShare =
    metrics && metrics.totalPortfolio > 0 ? (metrics.totalOverdue / metrics.totalPortfolio) * 100 : 0;
  const averageOverdue =
    metrics && overdueRows.length > 0 ? metrics.totalOverdue / overdueRows.length : 0;
  const highestOverdue = overdueTableRows.reduce((max, row) => Math.max(max, row.totalOutstanding), 0);

  const totalDueSoonPages = Math.max(1, Math.ceil(dueSoonRows.length / DASHBOARD_TABLE_PAGE_SIZE));
  const totalOverduePages = Math.max(1, Math.ceil(overdueTableRows.length / DASHBOARD_TABLE_PAGE_SIZE));

  useEffect(() => {
    setDueSoonPage((current) => Math.min(current, totalDueSoonPages));
  }, [totalDueSoonPages]);

  useEffect(() => {
    setOverduePage((current) => Math.min(current, totalOverduePages));
  }, [totalOverduePages]);

  const paginatedDueSoonRows = useMemo(() => {
    const start = (dueSoonPage - 1) * DASHBOARD_TABLE_PAGE_SIZE;
    return dueSoonRows.slice(start, start + DASHBOARD_TABLE_PAGE_SIZE);
  }, [dueSoonPage, dueSoonRows]);

  const paginatedOverdueRows = useMemo(() => {
    const start = (overduePage - 1) * DASHBOARD_TABLE_PAGE_SIZE;
    return overdueTableRows.slice(start, start + DASHBOARD_TABLE_PAGE_SIZE);
  }, [overduePage, overdueTableRows]);

  const statusRows = [
    { label: "Active", value: statusCounts.active, bar: "bg-emerald-500" },
    { label: "Overdue", value: statusCounts.overdue, bar: "bg-red-500" }
  ];

  function handleViewMore(target:
    | "portfolio"
    | "overdue"
    | "collections"
    | "open-loans"
    | "overdue-rate"
    | "efficiency"
    | "status-mix"
    | "recent-collections"
    | "upcoming-due"
    | "overdue-accounts") {
    if (target === "portfolio" || target === "open-loans") {
      navigate("/loans?tab=loans");
      return;
    }

    if (target === "collections" || target === "recent-collections") {
      navigate("/loans?tab=payments");
      return;
    }

    if (target === "upcoming-due") {
      navigate("/reports/overdue?section=upcoming");
      return;
    }

    if (target === "overdue" || target === "overdue-accounts") {
      navigate("/reports/overdue?section=overdue");
      return;
    }

    navigate("/analytics");
  }

  return (
    <main className="page-shell">
      <PageHeader
        title="Borrower & Loan Dashboard"
        subtitle="Track balances, risk concentration, and collection movements from a single snapshot."
        eyebrow="Portfolio Intelligence"
        actions={<PageMetaStamp />}
      />

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="metric-grid md:grid-cols-3">
        <KpiCard
          label="Total Portfolio"
          value={metrics ? formatCurrency(metrics.totalPortfolio) : loading ? "Loading..." : "-"}
          hint="Outstanding balance across non-closed loans"
          icon={<WalletCards size={18} />}
          onViewMore={() => handleViewMore("portfolio")}
        />
        <KpiCard
          label="Total Overdue"
          value={metrics ? formatCurrency(metrics.totalOverdue) : loading ? "Loading..." : "-"}
          hint={metrics ? `${formatPercent(overdueShare)} of portfolio` : "Delinquent exposure"}
          icon={<AlertTriangle size={18} />}
          onViewMore={() => handleViewMore("overdue")}
        />
        <KpiCard
          label="Collections Today"
          value={metrics ? formatCurrency(metrics.collectionsToday) : loading ? "Loading..." : "-"}
          hint="Amounts collected in current day"
          icon={<TrendingUp size={18} />}
          onViewMore={() => handleViewMore("collections")}
        />
        <KpiCard
          label="Open Loans"
          value={loading ? "Loading..." : openLoans.toLocaleString()}
          hint="Active + overdue accounts"
          icon={<Users size={18} />}
          onViewMore={() => handleViewMore("open-loans")}
        />
        <KpiCard
          label="Overdue Rate"
          value={loading ? "Loading..." : formatPercent(overdueRate)}
          hint="Overdue accounts vs open accounts"
          icon={<BarChart3 size={18} />}
          onViewMore={() => handleViewMore("overdue-rate")}
        />
        <KpiCard
          label="Collection Efficiency"
          value={loading ? "Loading..." : analytics ? formatPercent(analytics.collectionEfficiency) : "N/A"}
          hint={analytics ? "Collected today vs due today" : "Visible for admin roles"}
          icon={<Activity size={18} />}
          onViewMore={() => handleViewMore("efficiency")}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr,1fr]">
        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.03 }}
          className="panel p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Portfolio Status Mix</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-pill hover:border-c2/30 hover:text-c2" onClick={() => handleViewMore("status-mix")}>
                View More
              </button>
              <span className="glass-pill">{statusCounts.total} total account(s)</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {statusRows.map((row) => {
              const percentage = statusCounts.total > 0 ? (row.value / statusCounts.total) * 100 : 0;
              return (
                <div key={row.label} className="surface-soft p-3">
                  <div className="mb-2 flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                    <p className="text-sm font-semibold text-slate-700">
                      {row.value.toLocaleString()} ({formatPercent(percentage)})
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/80">
                    <div
                      className={`h-2 rounded-full ${row.bar}`}
                      style={{ width: `${Math.min(100, percentage)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Average Overdue Exposure</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{formatCurrency(averageOverdue)}</p>
            </div>
            <div className="surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Largest Overdue Account</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{formatCurrency(highestOverdue)}</p>
            </div>
          </div>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.07 }}
          className="panel p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Recent Collections</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-pill hover:border-c2/30 hover:text-c2" onClick={() => handleViewMore("recent-collections")}>
                View More
              </button>
              <span className="glass-pill">Latest 7 payments</span>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {recentCollections.map((payment) => (
              <div key={payment.id} className="surface-soft flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{payment.memberName}</p>
                  <p className="text-xs text-slate-600">
                    {payment.paymentId} | {payment.loanAccountNo}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold text-emerald-700">{formatCurrency(payment.amount)}</p>
                  <p className="text-xs text-slate-600">{formatDate(payment.collectedAt, true)}</p>
                </div>
              </div>
            ))}

            {!loading && recentCollections.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white/60 p-3 text-sm text-slate-600">
                No payments posted yet.
              </p>
            )}
          </div>
        </motion.article>
      </section>

      <section className="grid gap-4">
        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          className="panel p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Upcoming Due Watchlist</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-pill hover:border-c2/30 hover:text-c2" onClick={() => handleViewMore("upcoming-due")}>
                View More
              </button>
              <span className="glass-pill">{dueSoonRows.length} upcoming account(s)</span>
            </div>
          </div>

          <div className="mobile-record-list mt-3 md:hidden">
            {paginatedDueSoonRows.map((loan) => (
              <article key={loan.id} className="mobile-record-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{loan.memberName}</p>
                    <p className="mt-1 text-xs text-slate-500">{loan.loanAccountNo}</p>
                  </div>
                  <span className={dueTone(loan.daysUntilDue)}>{dueLabel(loan.daysUntilDue)}</span>
                </div>

                <div className="mobile-record-grid">
                  <div className="mobile-record-field">
                    <p className="mobile-record-label">Due Date</p>
                    <p className="mobile-record-value">{formatDate(loan.maturityDate)}</p>
                  </div>
                  <div className="mobile-record-field">
                    <p className="mobile-record-label">Outstanding</p>
                    <p className="mobile-record-value">{formatCurrency(loan.outstanding)}</p>
                  </div>
                </div>
              </article>
            ))}
            {!loading && dueSoonRows.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white/60 p-3 text-sm text-slate-600">
                No upcoming due dates to show.
              </p>
            )}
          </div>

          <div className="table-shell mt-3 hidden md:block">
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Loan Account</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDueSoonRows.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.memberName}</td>
                    <td>{loan.loanAccountNo}</td>
                    <td>{formatDate(loan.maturityDate)}</td>
                    <td>
                      <span className={dueTone(loan.daysUntilDue)}>{dueLabel(loan.daysUntilDue)}</span>
                    </td>
                    <td>{formatCurrency(loan.outstanding)}</td>
                  </tr>
                ))}
                {dueSoonRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-sm text-slate-600">
                      No upcoming due dates to show.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            currentPage={dueSoonPage}
            totalPages={totalDueSoonPages}
            totalItems={dueSoonRows.length}
            pageSize={DASHBOARD_TABLE_PAGE_SIZE}
            onPageChange={setDueSoonPage}
          />
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.13 }}
          className="panel p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Overdue Accounts Table</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-pill hover:border-c2/30 hover:text-c2" onClick={() => handleViewMore("overdue-accounts")}>
                View More
              </button>
              <Link className="glass-pill hover:border-c2/30 hover:text-c2" to="/reports/overdue">
                View full report
              </Link>
            </div>
          </div>

          <div className="mobile-record-list mt-3 md:hidden">
            {paginatedOverdueRows.map((row) => (
              <article key={row.loanId} className="mobile-record-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{row.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.loanAccountNo}</p>
                  </div>
                  <span className="status-danger">{overdueLabel(row.daysOverdue)}</span>
                </div>

                <div className="mobile-record-grid">
                  <div className="mobile-record-field">
                    <p className="mobile-record-label">Due Date</p>
                    <p className="mobile-record-value">{formatDate(row.dueDate)}</p>
                  </div>
                  <div className="mobile-record-field">
                    <p className="mobile-record-label">Outstanding</p>
                    <p className="mobile-record-value">{formatCurrency(row.totalOutstanding)}</p>
                  </div>
                </div>
              </article>
            ))}
            {!loading && overdueTableRows.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white/60 p-3 text-sm text-slate-600">
                No overdue accounts found.
              </p>
            )}
          </div>

          <div className="table-shell mt-3 hidden md:block">
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Loan Account</th>
                  <th>Due Date</th>
                  <th>Past Due</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOverdueRows.map((row) => (
                  <tr key={row.loanId}>
                    <td>{row.name}</td>
                    <td>{row.loanAccountNo}</td>
                    <td>{formatDate(row.dueDate)}</td>
                    <td>
                      <span className="status-danger">{overdueLabel(row.daysOverdue)}</span>
                    </td>
                    <td>{formatCurrency(row.totalOutstanding)}</td>
                  </tr>
                ))}
                {overdueTableRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-sm text-slate-600">
                      No overdue accounts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            currentPage={overduePage}
            totalPages={totalOverduePages}
            totalItems={overdueTableRows.length}
            pageSize={DASHBOARD_TABLE_PAGE_SIZE}
            onPageChange={setOverduePage}
          />
        </motion.article>
      </section>
    </main>
  );
}
