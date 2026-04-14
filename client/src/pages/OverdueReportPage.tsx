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
        title="Overdue Accounts Report"
        subtitle="Focus on high-risk borrowers and prioritize follow-up actions."
        eyebrow="Collections Risk Desk"
        actions={<PageMetaStamp />}
      />

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="metric-grid">
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Overdue Accounts</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{totals.count.toLocaleString()}</h3>
        </article>
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Outstanding</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{pesoFormatter.format(totals.totalOutstanding)}</h3>
        </article>
        <article className="panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Largest Exposure</p>
          <h3 className="mt-2 text-2xl font-bold text-slate-900">{pesoFormatter.format(totals.highest)}</h3>
        </article>
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Overdue Borrowers</h2>
            <p className="text-xs text-slate-600">Sorted from API feed for immediate collection follow-up.</p>
          </div>
        </div>

        <div className="mobile-record-list md:hidden">
          {rows.map((row) => (
            <article key={row.loanId} className="mobile-record-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">{row.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.phone || "-"}</p>
                </div>
                <span className="status-danger gap-1">
                  <AlertOctagon size={12} />
                  High
                </span>
              </div>

              <div className="mobile-record-grid">
                <OverdueField label="Due Date" value={new Date(row.dueDate).toLocaleDateString()} />
                <OverdueField label="Days Overdue" value={String(row.daysOverdue)} />
                <OverdueField label="Outstanding" value={pesoFormatter.format(row.totalOutstanding)} />
              </div>
            </article>
          ))}
          {rows.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No overdue accounts found.</p>}
        </div>

        <div className="table-shell hidden md:block">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Phone</th>
                <th>Due Date</th>
                <th>Days Overdue</th>
                <th>Total Outstanding</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.loanId}>
                  <td>{row.name}</td>
                  <td>{row.phone}</td>
                  <td>{new Date(row.dueDate).toLocaleDateString()}</td>
                  <td>{row.daysOverdue}</td>
                  <td>{pesoFormatter.format(row.totalOutstanding)}</td>
                  <td>
                    <span className="status-danger gap-1">
                      <AlertOctagon size={12} />
                      High
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-3 text-sm text-slate-600">No overdue accounts found.</p>}
        </div>
      </section>
    </main>
  );
}
