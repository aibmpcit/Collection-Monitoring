import { motion } from "framer-motion";
import { Activity, AlertTriangle, BarChart3, ChevronRight, Search, TrendingUp, Users, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { PaginationControls } from "../components/PaginationControls";
import { ToastNotification } from "../components/ToastNotification";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";
import type { DashboardMetrics, OverdueAccount, Paged } from "../types/models";

interface AnalyticsOverview {
  overdueRate: number;
  collectionEfficiency: number | null;
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
  icon,
  onViewMore,
  mobileLayout = "standard"
}: {
  label: string;
  value: string;
  icon: JSX.Element;
  onViewMore?: () => void;
  mobileLayout?: "standard" | "wide" | "compact";
}) {
  const isCompact = mobileLayout === "compact";
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`panel relative overflow-hidden ${mobileLayout === "wide" ? "col-span-2 md:col-span-1" : ""} ${isCompact ? "p-3 md:p-4" : "p-4"}`}
    >
      <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-c2/15 blur-2xl" />
      <div className={`relative grid items-start ${isCompact ? "grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:gap-3" : "grid-cols-[minmax(0,1fr)_auto] gap-3"}`}>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
          <h2 className="mt-2 break-words text-[clamp(1.1rem,1.8vw,1.45rem)] font-bold leading-tight text-slate-900">{value}</h2>
        </div>
        <span className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/70 text-c2 ${isCompact ? "row-start-1 h-8 w-8 md:col-start-2 md:h-10 md:w-10" : "h-10 w-10"}`}>
          {icon}
        </span>
      </div>
      {onViewMore && (
        <button type="button" className="relative mt-3 text-xs font-semibold text-c2 transition hover:text-c2/80" onClick={onViewMore}>
          View More
        </button>
      )}
    </motion.article>
  );
}

/** One tappable account on the collector's phone dashboard. */
function CollectorRow({ to, name, detail, badge, amount }: {
  to: string;
  name: string;
  detail: string;
  badge: JSX.Element;
  amount: string;
}) {
  return (
    <li>
      <Link to={to} className="collector-loan-list-item bg-white">
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold text-slate-900">{name}</span>
          <span className="mt-0.5 block break-all text-xs text-slate-600">{detail}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {badge}
          <span className="text-sm font-semibold text-slate-900">{amount}</span>
        </span>
      </Link>
    </li>
  );
}

function CollectorSection({ title, action, children }: { title: string; action?: JSX.Element; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const COLLECTOR_LIST_SIZE = 5;
const collectorEmpty = "rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600";
const collectorLink = "inline-flex min-h-[2.75rem] items-center text-sm font-semibold text-brand-700";

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isCollector = user?.role === "staff";
  const canViewAnalytics = user?.role === "super_admin" || user?.role === "branch_admin";

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [overdueRows, setOverdueRows] = useState<OverdueAccount[]>([]);
  const [payments, setPayments] = useState<DashboardPayment[]>([]);
  const [dueSoon, setDueSoon] = useState<Paged<DueSoonLoan> | null>(null);
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

      const [metricsResult, analyticsResult, overdueResult, paymentsResult] = await Promise.allSettled([
        apiRequest<DashboardMetrics>("/dashboard/metrics"),
        analyticsRequest,
        apiRequest<OverdueAccount[]>("/reports/overdue"),
        apiRequest<Paged<DashboardPayment>>("/payments?page=1&pageSize=7&sort=recent&openLoansOnly=true")
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
      setPayments(paymentsResult.status === "fulfilled" ? paymentsResult.value.items : []);
      setLoading(false);
    }

    void loadDashboardData();

    return () => {
      active = false;
    };
  }, [canViewAnalytics]);

  // Counts come from the server so the dashboard never downloads every loan.
  const statusCounts = {
    active: metrics?.activeLoans ?? 0,
    overdue: metrics?.overdueLoans ?? 0,
    total: (metrics?.activeLoans ?? 0) + (metrics?.overdueLoans ?? 0)
  };

  useEffect(() => {
    let active = true;
    apiRequest<Paged<DueSoonLoan>>(`/loans/due-soon?page=${dueSoonPage}&pageSize=${DASHBOARD_TABLE_PAGE_SIZE}`)
      .then(result => {
        if (!active) return;
        setDueSoon(result);
        if (result.page !== dueSoonPage) setDueSoonPage(result.page);
      })
      .catch(() => { if (active) setDueSoon(null); });
    return () => { active = false; };
  }, [dueSoonPage]);

  const dueSoonTotal = dueSoon?.total ?? 0;

  const overdueTableRows = useMemo(
    () =>
      [...overdueRows]
        .sort((a, b) => a.daysOverdue - b.daysOverdue || b.totalOutstanding - a.totalOutstanding),
    [overdueRows]
  );

  // The server already returns the latest 7 payments on open loans.
  const recentCollections = payments;

  const openLoans = analytics?.activeLoans ?? statusCounts.active + statusCounts.overdue;
  const overdueRate =
    analytics?.overdueRate ??
    (openLoans > 0 ? (statusCounts.overdue / openLoans) * 100 : 0);
  const averageOverdue =
    metrics && overdueRows.length > 0 ? metrics.totalOverdue / overdueRows.length : 0;
  const highestOverdue = overdueTableRows.reduce((max, row) => Math.max(max, row.totalOutstanding), 0);

  const totalDueSoonPages = Math.max(1, Math.ceil(dueSoonTotal / DASHBOARD_TABLE_PAGE_SIZE));
  const totalOverduePages = Math.max(1, Math.ceil(overdueTableRows.length / DASHBOARD_TABLE_PAGE_SIZE));

  useEffect(() => {
    setOverduePage((current) => Math.min(current, totalOverduePages));
  }, [totalOverduePages]);

  const paginatedDueSoonRows = dueSoon?.items ?? [];

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

  // Collectors work from a phone: today's figure, a way into the loan list, then who to visit.
  if (isCollector) {
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const count = (value: number) => (loading ? "…" : value.toLocaleString());
    return (
      <main className="page-shell">
        <header>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-600">{today}</p>
        </header>

        {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}

        <section className="rounded-3xl bg-brand-600 p-4 text-white" aria-label="Collections today">
          <p className="text-sm font-semibold text-brand-100">Collections today</p>
          <p className="mt-1 break-words text-[2rem] font-bold leading-tight tracking-tight">
            {metrics ? formatCurrency(metrics.collectionsToday) : loading ? "Loading..." : "-"}
          </p>
          <p className="mt-1 text-xs text-brand-100">Branch total</p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Link to="/loans" className="panel block min-w-0 p-3">
            <span className="block text-sm font-semibold text-slate-600">Open loans</span>
            <span className="mt-1 block text-2xl font-bold text-slate-900">{count(openLoans)}</span>
          </Link>
          <Link to="/reports/overdue?section=overdue" className="panel block min-w-0 p-3">
            <span className="block text-sm font-semibold text-slate-600">Overdue loans</span>
            <span className="mt-1 block text-2xl font-bold text-red-700">{count(statusCounts.overdue)}</span>
          </Link>
        </div>

        <Link to="/loans" className="btn-primary h-12 justify-between px-4">
          <span className="inline-flex items-center gap-2"><Search size={18} aria-hidden="true" />Find a loan to collect</span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>

        <CollectorSection title="Overdue accounts"
          action={<Link to="/reports/overdue?section=overdue" className={collectorLink}>View all</Link>}>
          {overdueTableRows.length > 0 ? (
            <ul className="grid gap-2">
              {overdueTableRows.slice(0, COLLECTOR_LIST_SIZE).map(row => (
                <CollectorRow key={row.loanId} to={`/loan-details/${row.loanId}`} name={row.name} detail={row.loanAccountNo}
                  badge={<span className="status-danger">{overdueLabel(row.daysOverdue)}</span>} amount={formatCurrency(row.totalOutstanding)} />
              ))}
            </ul>
          ) : <p className={collectorEmpty}>{loading ? "Loading overdue accounts..." : "No overdue accounts found."}</p>}
        </CollectorSection>

        <CollectorSection title="Due soon"
          action={<Link to="/reports/overdue?section=upcoming" className={collectorLink}>View all ({dueSoonTotal})</Link>}>
          {paginatedDueSoonRows.length > 0 ? (
            <ul className="grid gap-2">
              {paginatedDueSoonRows.slice(0, COLLECTOR_LIST_SIZE).map(loan => (
                <CollectorRow key={loan.id} to={`/loan-details/${loan.id}`} name={loan.memberName} detail={loan.loanAccountNo}
                  badge={<span className={dueTone(loan.daysUntilDue)}>{dueLabel(loan.daysUntilDue)}</span>} amount={formatCurrency(loan.outstanding)} />
              ))}
            </ul>
          ) : <p className={collectorEmpty}>{loading ? "Loading upcoming due dates..." : "No upcoming due dates to show."}</p>}
        </CollectorSection>

        <CollectorSection title="Recent collections"
          action={<Link to="/collector-history" className={collectorLink}>See history</Link>}>
          {recentCollections.length > 0 ? (
            <ul className="grid gap-2">
              {recentCollections.slice(0, COLLECTOR_LIST_SIZE).map(payment => (
                <li key={payment.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{payment.memberName}</p>
                    <p className="mt-0.5 break-all text-xs text-slate-600">{payment.loanAccountNo}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-emerald-700">{formatCurrency(payment.amount)}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{formatDate(payment.collectedAt, true)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className={collectorEmpty}>{loading ? "Loading recent collections..." : "No payments posted yet."}</p>}
        </CollectorSection>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <PageHeader
        title="Borrower & Loan Dashboard"
        eyebrow="Portfolio Intelligence"
        actions={<PageMetaStamp />}
      />

      {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}

      <section className={`metric-grid dashboard-metric-grid grid-cols-2 ${isCollector ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
        {!isCollector && <>
          <KpiCard
            label="Total Portfolio"
            value={metrics ? formatCurrency(metrics.totalPortfolio) : loading ? "Loading..." : "-"}
            icon={<WalletCards size={18} />}
            onViewMore={() => handleViewMore("portfolio")}
            mobileLayout="wide"
          />
          <KpiCard
            label="Total Overdue"
            value={metrics ? formatCurrency(metrics.totalOverdue) : loading ? "Loading..." : "-"}
            icon={<AlertTriangle size={18} />}
            onViewMore={() => handleViewMore("overdue")}
            mobileLayout="wide"
          />
        </>}
        <KpiCard
          label="Collections Today"
          value={metrics ? formatCurrency(metrics.collectionsToday) : loading ? "Loading..." : "-"}
          icon={<TrendingUp size={18} />}
          onViewMore={() => handleViewMore("collections")}
          mobileLayout="compact"
        />
        <KpiCard
          label="Open Loans"
          value={loading ? "Loading..." : openLoans.toLocaleString()}
          icon={<Users size={18} />}
          onViewMore={() => handleViewMore("open-loans")}
          mobileLayout="compact"
        />
        {!isCollector && (
          <KpiCard
            label="Overdue Rate"
            value={loading ? "Loading..." : formatPercent(overdueRate)}
            icon={<BarChart3 size={18} />}
            onViewMore={() => handleViewMore("overdue-rate")}
            mobileLayout="compact"
          />
        )}
        {!isCollector && (
          <KpiCard
            label="Collection Efficiency"
            value={loading ? "Loading..." : analytics ? formatPercent(analytics.collectionEfficiency) : "--"}
            icon={<Activity size={18} />}
            onViewMore={() => handleViewMore("efficiency")}
            mobileLayout="compact"
          />
        )}
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
          className="panel order-2 p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Upcoming Due Watchlist</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-pill hover:border-c2/30 hover:text-c2" onClick={() => handleViewMore("upcoming-due")}>
                View More
              </button>
              <span className="glass-pill">{dueSoonTotal} upcoming account(s)</span>
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
            {!loading && dueSoonTotal === 0 && (
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
                {dueSoonTotal === 0 && (
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
            totalItems={dueSoonTotal}
            pageSize={DASHBOARD_TABLE_PAGE_SIZE}
            onPageChange={setDueSoonPage}
          />
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.13 }}
          className="panel order-1 p-4"
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
