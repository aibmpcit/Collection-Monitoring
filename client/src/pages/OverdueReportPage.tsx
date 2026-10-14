import { AlertOctagon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { PaginationControls } from "../components/PaginationControls";
import { ToastNotification } from "../components/ToastNotification";
import { apiRequest } from "../services/api";
import type { OverdueAccount, Paged } from "../types/models";

interface DashboardLoan {
  id: number;
  loanAccountNo: string;
  memberName: string;
  maturityDate: string;
  principalDue: number;
  penaltyDue: number;
  interest: number;
  otherCharges: number;
  status: "active" | "overdue" | "closed";
}

interface DueSoonLoan extends DashboardLoan {
  daysUntilDue: number;
  outstanding: number;
}

const TABLE_PAGE_SIZE = 8;

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString();
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return pesoFormatter.format(value);
}

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue === 0) {
    return "Due today";
  }

  return `Due in ${daysUntilDue} day(s)`;
}

function dueTone(daysUntilDue: number): string {
  if (daysUntilDue === 0) {
    return "status-warning";
  }
  if (daysUntilDue <= 7) {
    return "status-warning";
  }
  return "status-success";
}

function formatPastDueAge(daysOverdue: number): string {
  if (daysOverdue >= 365) {
    const years = Math.floor(daysOverdue / 365);
    const remainingDays = daysOverdue % 365;
    const months = Math.floor(remainingDays / 30);
    return months > 0 ? `${years} yr ${months} mo` : `${years} yr`;
  }

  if (daysOverdue >= 30) {
    const months = Math.floor(daysOverdue / 30);
    const remainingDays = daysOverdue % 30;
    return remainingDays > 0 ? `${months} mo ${remainingDays} d` : `${months} mo`;
  }

  return `${daysOverdue} day(s)`;
}

function riskBadge(daysOverdue: number): { label: string; className: string } {
  if (daysOverdue >= 180) {
    return { label: "Critical", className: "status-danger" };
  }
  if (daysOverdue >= 90) {
    return { label: "High", className: "status-danger" };
  }
  if (daysOverdue >= 30) {
    return { label: "Medium", className: "status-warning" };
  }
  return { label: "New", className: "status-success" };
}

function OverdueField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <p className="mobile-record-value">{value}</p>
    </div>
  );
}

export function OverdueReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<OverdueAccount[]>([]);
  const [dueSoon, setDueSoon] = useState<Paged<DueSoonLoan> | null>(null);
  const [error, setError] = useState("");
  const [dueSoonPage, setDueSoonPage] = useState(1);
  const [overduePage, setOverduePage] = useState(1);
  const upcomingSectionRef = useRef<HTMLElement | null>(null);
  const overdueSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const [overdueResult] = await Promise.allSettled([
        apiRequest<OverdueAccount[]>("/reports/overdue")
      ]);

      if (!active) return;

      if (overdueResult.status === "fulfilled") {
        setRows(overdueResult.value);
      } else {
        setRows([]);
      }

      if (overdueResult.status === "rejected") {
        setError(overdueResult.reason instanceof Error ? overdueResult.reason.message : "Unable to load overdue report.");
        return;
      }

      setError("");
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const totals = useMemo(() => {
    const count = rows.length;
    const totalOutstanding = rows.reduce((sum, row) => sum + row.totalOutstanding, 0);
    const highest = rows.reduce((max, row) => (row.totalOutstanding > max ? row.totalOutstanding : max), 0);
    return { count, totalOutstanding, highest };
  }, [rows]);

  // Upcoming accounts are paged by the server, soonest first.
  useEffect(() => {
    let active = true;
    apiRequest<Paged<DueSoonLoan>>(`/loans/due-soon?page=${dueSoonPage}&pageSize=${TABLE_PAGE_SIZE}`)
      .then(result => {
        if (!active) return;
        setDueSoon(result);
        if (result.page !== dueSoonPage) setDueSoonPage(result.page);
      })
      .catch(e => {
        if (!active) return;
        setDueSoon(null);
        setError(e instanceof Error ? e.message : "Unable to load upcoming due accounts.");
      });
    return () => { active = false; };
  }, [dueSoonPage]);

  const dueSoonTotal = dueSoon?.total ?? 0;

  const overdueRows = useMemo(
    () => [...rows].sort((a, b) => b.daysOverdue - a.daysOverdue || b.totalOutstanding - a.totalOutstanding),
    [rows]
  );

  const totalDueSoonPages = Math.max(1, Math.ceil(dueSoonTotal / TABLE_PAGE_SIZE));
  const totalOverduePages = Math.max(1, Math.ceil(overdueRows.length / TABLE_PAGE_SIZE));

  useEffect(() => {
    setOverduePage((current) => Math.min(current, totalOverduePages));
  }, [totalOverduePages]);

  const paginatedDueSoonRows = dueSoon?.items ?? [];

  const paginatedOverdueRows = useMemo(() => {
    const start = (overduePage - 1) * TABLE_PAGE_SIZE;
    return overdueRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [overduePage, overdueRows]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "upcoming") {
      upcomingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (section === "overdue") {
      overdueSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [searchParams]);

  function openLoanDetails(targetLoanId: number) {
    navigate(`/loan-details/${targetLoanId}?from=due-monitoring`);
  }

  return (
    <main className="page-shell">
      <PageHeader
        title="Due Monitoring Report"
        eyebrow="Collections Risk Desk"
        actions={<PageMetaStamp />}
      />

      {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}

      <section className="metric-grid md:grid-cols-3">
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Past-Due Accounts</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{totals.count.toLocaleString()}</h3>
        </article>
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Past-Due Balance</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totals.totalOutstanding)}</h3>
        </article>
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Largest Past-Due Balance</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totals.highest)}</h3>
        </article>
      </section>

      <section ref={overdueSectionRef} className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Past-Due Accounts</h2>
          </div>
          <span className="glass-pill">{overdueRows.length} past-due account(s)</span>
        </div>

        <div className="mobile-record-list md:hidden">
          {paginatedOverdueRows.map((row) => {
            const risk = riskBadge(row.daysOverdue);
            return (
            <article
              key={row.loanId}
              className="mobile-record-card cursor-pointer transition hover:bg-white"
              tabIndex={0}
              onClick={() => openLoanDetails(row.loanId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openLoanDetails(row.loanId);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">{row.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.loanAccountNo || "-"} | {row.phone || "-"}</p>
                </div>
                <span className={`${risk.className} gap-1`}>
                  <AlertOctagon size={12} />
                  {risk.label}
                </span>
              </div>

              <div className="mobile-record-grid">
                <OverdueField label="Past Due Since" value={formatDate(row.dueDate)} />
                <OverdueField label="Past Due For" value={formatPastDueAge(row.daysOverdue)} />
                <OverdueField label="Outstanding Balance" value={formatCurrency(row.totalOutstanding)} />
              </div>
            </article>
          )})}
          {overdueRows.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No overdue accounts found.</p>}
        </div>

        <div className="table-shell hidden md:block">
            <table className="table-clean">
              <thead>
                <tr>
                <th>Member</th>
                <th>Loan Account</th>
                <th>Phone</th>
                <th>Past Due Since</th>
                <th>Past Due For</th>
                <th>Outstanding Balance</th>
                <th>Priority</th>
              </tr>
              </thead>
              <tbody>
              {paginatedOverdueRows.map((row) => {
                const risk = riskBadge(row.daysOverdue);
                return (
                <tr
                  key={row.loanId}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => openLoanDetails(row.loanId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openLoanDetails(row.loanId);
                    }
                  }}
                >
                  <td>{row.name}</td>
                  <td>{row.loanAccountNo || "-"}</td>
                  <td>{row.phone}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td>{formatPastDueAge(row.daysOverdue)}</td>
                  <td>{formatCurrency(row.totalOutstanding)}</td>
                  <td>
                    <span className={`${risk.className} gap-1`}>
                      <AlertOctagon size={12} />
                      {risk.label}
                    </span>
                  </td>
                </tr>
              )})}
              {overdueRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-sm text-slate-600">
                    No overdue accounts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          className="pagination-bar mt-3"
          currentPage={overduePage}
          totalPages={totalOverduePages}
          totalItems={overdueRows.length}
          pageSize={TABLE_PAGE_SIZE}
          onPageChange={setOverduePage}
        />
      </section>

      <section ref={upcomingSectionRef} className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Upcoming Due Accounts</h2>
          </div>
          <span className="glass-pill">{dueSoonTotal} upcoming account(s)</span>
        </div>

        <div className="mobile-record-list md:hidden">
          {paginatedDueSoonRows.map((loan) => (
            <article
              key={loan.id}
              className="mobile-record-card cursor-pointer transition hover:bg-white"
              tabIndex={0}
              onClick={() => openLoanDetails(loan.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openLoanDetails(loan.id);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">{loan.memberName}</p>
                  <p className="mt-1 text-xs text-slate-500">{loan.loanAccountNo}</p>
                </div>
                <span className={dueTone(loan.daysUntilDue)}>{dueLabel(loan.daysUntilDue)}</span>
              </div>

              <div className="mobile-record-grid">
                <OverdueField label="Due Date" value={formatDate(loan.maturityDate)} />
                <OverdueField label="Outstanding Balance" value={formatCurrency(loan.outstanding)} />
              </div>
            </article>
          ))}
          {dueSoonTotal === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No upcoming due accounts found.</p>}
        </div>

        <div className="table-shell hidden md:block">
            <table className="table-clean">
              <thead>
                <tr>
                <th>Member</th>
                <th>Loan Account</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Outstanding Balance</th>
              </tr>
              </thead>
              <tbody>
                {paginatedDueSoonRows.map((loan) => (
                <tr
                  key={loan.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => openLoanDetails(loan.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openLoanDetails(loan.id);
                    }
                  }}
                >
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
                    No upcoming due accounts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          className="pagination-bar mt-3"
          currentPage={dueSoonPage}
          totalPages={totalDueSoonPages}
          totalItems={dueSoonTotal}
          pageSize={TABLE_PAGE_SIZE}
          onPageChange={setDueSoonPage}
        />
      </section>
    </main>
  );
}
