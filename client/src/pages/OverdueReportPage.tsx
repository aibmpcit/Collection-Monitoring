import { AlertOctagon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../services/api";
import type { OverdueAccount } from "../types/models";

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
    <div className="pagination-bar mt-3">
      <p className="text-xs text-slate-600">
        Showing {startItem}-{endItem} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-muted btn-page" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>
          Previous
        </button>
        <p className="text-xs font-semibold text-slate-700">
          Page {currentPage} of {totalPages}
        </p>
        <button type="button" className="btn-muted btn-page" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}

export function OverdueReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<OverdueAccount[]>([]);
  const [loans, setLoans] = useState<DashboardLoan[]>([]);
  const [error, setError] = useState("");
  const [dueSoonPage, setDueSoonPage] = useState(1);
  const [overduePage, setOverduePage] = useState(1);
  const upcomingSectionRef = useRef<HTMLElement | null>(null);
  const overdueSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const [overdueResult, loansResult] = await Promise.allSettled([
        apiRequest<OverdueAccount[]>("/reports/overdue"),
        apiRequest<DashboardLoan[]>("/loans")
      ]);

      if (!active) return;

      if (overdueResult.status === "fulfilled") {
        setRows(overdueResult.value);
      } else {
        setRows([]);
      }

      if (loansResult.status === "fulfilled") {
        setLoans(loansResult.value);
      } else {
        setLoans([]);
      }

      if (overdueResult.status === "rejected") {
        setError(overdueResult.reason instanceof Error ? overdueResult.reason.message : "Unable to load overdue report.");
        return;
      }

      if (loansResult.status === "rejected") {
        setError(loansResult.reason instanceof Error ? loansResult.reason.message : "Unable to load upcoming due accounts.");
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
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue || b.outstanding - a.outstanding),
    [loans]
  );

  const overdueRows = useMemo(
    () => [...rows].sort((a, b) => b.daysOverdue - a.daysOverdue || b.totalOutstanding - a.totalOutstanding),
    [rows]
  );

  const totalDueSoonPages = Math.max(1, Math.ceil(dueSoonRows.length / TABLE_PAGE_SIZE));
  const totalOverduePages = Math.max(1, Math.ceil(overdueRows.length / TABLE_PAGE_SIZE));

  useEffect(() => {
    setDueSoonPage((current) => Math.min(current, totalDueSoonPages));
  }, [totalDueSoonPages]);

  useEffect(() => {
    setOverduePage((current) => Math.min(current, totalOverduePages));
  }, [totalOverduePages]);

  const paginatedDueSoonRows = useMemo(() => {
    const start = (dueSoonPage - 1) * TABLE_PAGE_SIZE;
    return dueSoonRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [dueSoonPage, dueSoonRows]);

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
        subtitle="Review upcoming and overdue accounts in one place so follow-up can be prioritized before and after due dates."
        eyebrow="Collections Risk Desk"
        actions={<PageMetaStamp />}
      />

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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

      <section ref={upcomingSectionRef} className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Upcoming Due Accounts</h2>
            <p className="text-xs text-slate-600">Soonest due dates appear first so the team can act before accounts become overdue.</p>
          </div>
          <span className="glass-pill">{dueSoonRows.length} upcoming account(s)</span>
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
          {dueSoonRows.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No upcoming due accounts found.</p>}
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
              {dueSoonRows.length === 0 && (
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
          currentPage={dueSoonPage}
          totalPages={totalDueSoonPages}
          totalItems={dueSoonRows.length}
          pageSize={TABLE_PAGE_SIZE}
          onPageChange={setDueSoonPage}
        />
      </section>

      <section ref={overdueSectionRef} className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Past-Due Accounts</h2>
            <p className="text-xs text-slate-600">Oldest due dates appear first so the collection team can work the most delayed accounts first.</p>
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
          currentPage={overduePage}
          totalPages={totalOverduePages}
          totalItems={overdueRows.length}
          pageSize={TABLE_PAGE_SIZE}
          onPageChange={setOverduePage}
        />
      </section>
    </main>
  );
}
