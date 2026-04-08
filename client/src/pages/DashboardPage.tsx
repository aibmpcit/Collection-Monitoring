import { motion } from "framer-motion";
import { Activity, AlertTriangle, BarChart3, TrendingUp, Users, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { Link } from "react-router-dom";
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

function KpiCard({
  label,
  value,
  hint,
  icon
}: {
  label: string;
  value: string;
  hint?: string;
  icon: JSX.Element;
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
    </motion.article>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const canViewAnalytics = user?.role === "super_admin" || user?.role === "branch_admin";

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [overdueRows, setOverdueRows] = useState<OverdueAccount[]>([]);
  const [payments, setPayments] = useState<DashboardPayment[]>([]);
  const [loans, setLoans] = useState<DashboardLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          if (loan.status === "closed") totals.closed += 1;
          totals.total += 1;
          return totals;
        },
        { active: 0, overdue: 0, closed: 0, total: 0 }
      ),
    [loans]
  );

  const dueSoon = useMemo<DueSoonLoan[]>(
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
        .filter((loan) => loan.daysUntilDue !== Number.MAX_SAFE_INTEGER)
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
        .slice(0, 6),
    [loans]
  );

  const topOverdue = useMemo(
    () =>
      [...overdueRows]
        .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
        .slice(0, 6),
    [overdueRows]
  );

  const recentCollections = useMemo(() => payments.slice(0, 7), [payments]);

  const openLoans = analytics?.activeLoans ?? statusCounts.active + statusCounts.overdue;
  const overdueRate =
    analytics?.overdueRate ??
    (openLoans > 0 ? (statusCounts.overdue / openLoans) * 100 : 0);
  const overdueShare =
    metrics && metrics.totalPortfolio > 0 ? (metrics.totalOverdue / metrics.totalPortfolio) * 100 : 0;
  const averageOverdue =
    metrics && overdueRows.length > 0 ? metrics.totalOverdue / overdueRows.length : 0;
  const highestOverdue = topOverdue[0]?.totalOutstanding ?? 0;

  const statusRows = [
    { label: "Active", value: statusCounts.active, bar: "bg-emerald-500" },
    { label: "Overdue", value: statusCounts.overdue, bar: "bg-red-500" },
    { label: "Closed", value: statusCounts.closed, bar: "bg-slate-500" }
  ];

  return (
    <main className="page-shell">
      <PageHeader
        title="Borrower & Loan Dashboard"
        subtitle="Track balances, risk concentration, and collection movements from a single snapshot."
        eyebrow="Portfolio Intelligence"
        actions={<PageMetaStamp />}
      />

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="metric-grid">
        <KpiCard
          label="Total Portfolio"
          value={metrics ? formatCurrency(metrics.totalPortfolio) : loading ? "Loading..." : "-"}
          hint="Outstanding balance across non-closed loans"
          icon={<WalletCards size={18} />}
        />
        <KpiCard
          label="Total Overdue"
          value={metrics ? formatCurrency(metrics.totalOverdue) : loading ? "Loading..." : "-"}
          hint={metrics ? `${formatPercent(overdueShare)} of portfolio` : "Delinquent exposure"}
          icon={<AlertTriangle size={18} />}
        />
        <KpiCard
          label="Collections Today"
          value={metrics ? formatCurrency(metrics.collectionsToday) : loading ? "Loading..." : "-"}
          hint="Amounts collected in current day"
          icon={<TrendingUp size={18} />}
        />
        <KpiCard
          label="Open Loans"
          value={loading ? "Loading..." : openLoans.toLocaleString()}
          hint="Active + overdue accounts"
          icon={<Users size={18} />}
        />
        <KpiCard
          label="Overdue Rate"
          value={loading ? "Loading..." : formatPercent(overdueRate)}
          hint="Overdue accounts vs open accounts"
          icon={<BarChart3 size={18} />}
        />
        <KpiCard
          label="Collection Efficiency"
          value={loading ? "Loading..." : analytics ? formatPercent(analytics.collectionEfficiency) : "N/A"}
          hint={analytics ? "Collected today vs due today" : "Visible for admin roles"}
          icon={<Activity size={18} />}
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
            <span className="glass-pill">{statusCounts.total} total account(s)</span>
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
            <h2 className="text-lg font-semibold text-slate-900">High-Risk Accounts</h2>
            <Link className="glass-pill hover:border-c2/30 hover:text-c2" to="/reports/overdue">
              View report
            </Link>
          </div>

          <div className="mt-3 grid gap-2">
            {topOverdue.map((row) => (
              <div key={row.loanId} className="surface-soft flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                  <p className="text-xs text-slate-600">
                    {row.daysOverdue} day(s) overdue | Due {formatDate(row.dueDate)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-red-700 sm:text-right">{formatCurrency(row.totalOutstanding)}</p>
              </div>
            ))}

            {!loading && topOverdue.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white/60 p-3 text-sm text-slate-600">
                No overdue accounts found.
              </p>
            )}
          </div>
        </motion.article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          className="panel p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Due-Soon Watchlist</h2>
            <span className="glass-pill">Next 6 nearest due dates</span>
          </div>

          <div className="mt-3 grid gap-2">
            {dueSoon.map((loan) => (
              <div key={loan.id} className="surface-soft flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{loan.memberName}</p>
                  <p className="text-xs text-slate-600">
                    {loan.loanAccountNo} | Due {formatDate(loan.maturityDate)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(loan.outstanding)}</p>
                  <span className={dueTone(loan.daysUntilDue)}>{dueLabel(loan.daysUntilDue)}</span>
                </div>
              </div>
            ))}

            {!loading && dueSoon.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white/60 p-3 text-sm text-slate-600">
                No active due dates to show.
              </p>
            )}
          </div>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.13 }}
          className="panel p-4"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-lg font-semibold text-slate-900">Recent Collections</h2>
            <span className="glass-pill">Latest 7 payments</span>
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
    </main>
  );
}
