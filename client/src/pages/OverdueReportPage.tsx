import { AlertOctagon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../services/api";
import type { OverdueAccount } from "../types/models";

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
  const [rows, setRows] = useState<OverdueAccount[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await apiRequest<OverdueAccount[]>("/reports/overdue");
        if (!active) return;
        setRows(data);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Unable to load overdue report.");
      }
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

  return (
    <main className="page-shell">
      <PageHeader
        title="Past-Due Accounts Report"
        subtitle="Review overdue accounts in clearer collection terms so follow-up can be prioritized faster."
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
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{pesoFormatter.format(totals.totalOutstanding)}</h3>
        </article>
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Largest Past-Due Balance</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{pesoFormatter.format(totals.highest)}</h3>
        </article>
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Past-Due Accounts</h2>
            <p className="text-xs text-slate-600">Oldest due dates appear first so the collection team can work the most delayed accounts first.</p>
          </div>
        </div>

        <div className="mobile-record-list md:hidden">
          {rows.map((row) => {
            const risk = riskBadge(row.daysOverdue);
            return (
            <article key={row.loanId} className="mobile-record-card">
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
                <OverdueField label="Outstanding Balance" value={pesoFormatter.format(row.totalOutstanding)} />
              </div>
            </article>
          )})}
          {rows.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No overdue accounts found.</p>}
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
              {rows.map((row) => {
                const risk = riskBadge(row.daysOverdue);
                return (
                <tr key={row.loanId}>
                  <td>{row.name}</td>
                  <td>{row.loanAccountNo || "-"}</td>
                  <td>{row.phone}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td>{formatPastDueAge(row.daysOverdue)}</td>
                  <td>{pesoFormatter.format(row.totalOutstanding)}</td>
                  <td>
                    <span className={`${risk.className} gap-1`}>
                      <AlertOctagon size={12} />
                      {risk.label}
                    </span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-3 text-sm text-slate-600">No overdue accounts found.</p>}
        </div>
      </section>
    </main>
  );
}
