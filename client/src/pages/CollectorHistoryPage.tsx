import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { getRemarkCategoryLabel } from "../constants/remarkCategories";
import { apiRequest } from "../services/api";

interface Activity {
  id: number; kind: string; occurred_at: string; amount: number;
  or_no: string | null; remark: string | null; category: string | null;
  loan_id: number | null; loan_account_no: string | null; member_name: string;
  cif_key: string | null; collector_name: string | null; branch_name: string | null;
}
interface History {
  items: Activity[];
  summary: { total: number; amount: number; payments: number; members: number };
  total: number; page: number; pageSize: number;
}
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

function localDateValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function initialExportDates() {
  const today = new Date();
  return { from: localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)), to: localDateValue(today) };
}

interface Collector { id: number; username: string; role: string; branchName: string | null }

export function CollectorHistoryPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const collectorId = params.get("collectorId");

  useEffect(() => {
    if (user?.role === "staff") {
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<Collector[]>("/staff").then(rows => { if (active) setCollectors(rows); })
      .catch(() => { if (active) setError("Unable to load collectors. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, user?.username, user?.role, user?.branchName, refresh]);

  if (user?.role === "staff") {
    return <CollectorHistoryDetails key={user.id} />;
  }

  if (collectorId) {
    const collector = collectors.find(row => String(row.id) === collectorId);
    return <CollectorHistoryDetails key={collectorId} collectorName={collector?.username} />;
  }

  const visible = collectors.filter(row => row.role === "staff" &&
    `${row.username} ${row.branchName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <main className="page-shell">
    <PageHeader title="Collector History" eyebrow="Collection Activity"
      actions={<button className="btn-muted" onClick={() => setRefresh(value => value + 1)}>Refresh</button>} />
    <section className="panel p-4">
      <label className="grid max-w-md gap-1 text-sm">Search collectors
        <input className="field" placeholder="Collector name or branch" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {loading ? <p className="py-6" role="status">Loading collectors...</p>
        : error ? <p className="py-6 text-red-700" role="alert">{error} <button className="btn-muted" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>
        : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(collector => <Link key={collector.id} to={`/collector-history?collectorId=${collector.id}`}
            aria-label={`View collection history for ${collector.username}`}
            className="group flex min-w-0 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-reduce:transition-none">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold text-slate-900">{collector.username}</h2>
              <p className="mt-1 break-words text-sm text-slate-500">{collector.branchName || (user?.role === "staff" ? "My collector account" : "No branch assigned")}</p>
            </div>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-slate-400 group-hover:text-brand-700" />
          </Link>)}
          {visible.length === 0 && <p className="py-6 text-slate-500">{search.trim() ? "No collectors match your search." : "No collectors available."}</p>}
        </div>}
    </section>
  </main>;
}

function CollectorHistoryDetails({ collectorName }: { collectorName?: string }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const initialDates = initialExportDates();
  const [exportFrom, setExportFrom] = useState(initialDates.from);
  const [exportTo, setExportTo] = useState(initialDates.to);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const activeTab = params.get("type") === "remarks" ? "remarks" : "payments";
  const requestParams = new URLSearchParams(params);
  requestParams.delete("from");
  requestParams.delete("to");
  if (user?.role === "staff") requestParams.set("collectorId", String(user.id));
  requestParams.set("type", activeTab);
  const query = requestParams.toString();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<History>(`/collection-history?${query}`).then(result => {
      if (active) setData(result);
    }).catch(e => {
      if (active) { setError(e instanceof Error ? e.message : "Unable to load history"); setData(null); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, refresh]);

  useEffect(() => { setSearch(params.get("search") ?? ""); }, [query]);

  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }

  async function exportPaymentReport() {
    if (exporting) return;
    if (!exportFrom || !exportTo || exportFrom > exportTo) {
      setExportError("Select a valid export date range.");
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const exportParams = new URLSearchParams({ from: exportFrom, to: exportTo, type: "payments", export: "true" });
      const selectedCollectorId = user?.role === "staff" ? String(user.id) : params.get("collectorId");
      if (selectedCollectorId) exportParams.set("collectorId", selectedCollectorId);
      const report = await apiRequest<History>(`/collection-history?${exportParams.toString()}`);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const collector = collectorName ?? user?.username ?? "Collector";
      const columns = [
        { label: "Date", width: 35 }, { label: "Collector", width: 30 }, { label: "Branch", width: 30 },
        { label: "Member", width: 42 }, { label: "CIF Key", width: 28 }, { label: "Loan Account", width: 32 },
        { label: "Receipt", width: 28 }, { label: "Amount", width: 30 }
      ];
      const fit = (value: unknown, width: number) => {
        const text = String(value ?? "");
        if (pdf.getTextWidth(text) <= width - 4) return text;
        let shortened = text;
        while (shortened.length > 1 && pdf.getTextWidth(`${shortened}...`) > width - 4) shortened = shortened.slice(0, -1);
        return `${shortened}...`;
      };
      const drawHeader = () => {
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text("Payment Collection Report", 10, 12);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Collector: ${collector}`, 10, 18);
        pdf.text(`Period: ${exportFrom} to ${exportTo}`, 10, 23);
        pdf.text(`Payments: ${report.total}    Total collected: ${money(Number(report.summary.amount))}`, 10, 28);
        pdf.setFillColor(0, 61, 150);
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        let x = 10;
        columns.forEach(column => { pdf.rect(x, 33, column.width, 8, "F"); pdf.text(column.label, x + 2, 38); x += column.width; });
        pdf.setTextColor(20, 30, 45);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
      };
      drawHeader();
      let y = 47;
      report.items.forEach((item, index) => {
        if (y > 195) { pdf.addPage(); drawHeader(); y = 47; }
        if (index % 2 === 0) { pdf.setFillColor(245, 248, 252); pdf.rect(10, y - 5, 255, 7, "F"); }
        const values = [
          item.occurred_at.replace("T", " ").replace(/\.\d+Z?$/, ""), item.collector_name ?? "Unattributed",
          item.branch_name ?? "", item.member_name, item.cif_key ?? "", item.loan_account_no ?? "",
          item.or_no ?? "", `PHP ${Number(item.amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ];
        let x = 10;
        values.forEach((value, columnIndex) => {
          const column = columns[columnIndex];
          pdf.text(fit(value, column.width), columnIndex === values.length - 1 ? x + column.width - 2 : x + 2, y, columnIndex === values.length - 1 ? { align: "right" } : undefined);
          x += column.width;
        });
        y += 7;
      });
      if (report.items.length === 0) pdf.text("No payments found for the selected date range.", 10, 49);
      const safeName = (collectorName ?? user?.username ?? "collector").replace(/[^a-z0-9_-]+/gi, "-");
      pdf.save(`${safeName}-payments-${exportFrom}-to-${exportTo}.pdf`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Unable to export payment report.");
    } finally {
      setExporting(false);
    }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return <main className="page-shell">
    {user?.role !== "staff" && <Link to="/collector-history" className="text-sm font-semibold text-brand-700">← Back to collectors</Link>}
    <PageHeader title={collectorName ? `${collectorName}'s History` : user?.role === "staff" ? "My Collection History" : "Collector History"}
      eyebrow="Collection Activity"
      actions={<button className="btn-muted max-md:absolute max-md:right-4 max-md:top-4" onClick={() => setRefresh(value => value + 1)}>Refresh</button>} />
    {!loading && data && (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[["Total collected", money(Number(data.summary.amount))], ["Payments", data.summary.payments],
          ["Members reached", data.summary.members], ["Follow-up notes", data.summary.total - data.summary.payments]].map(([label, value]) =>
          <section className="panel p-4" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></section>)}
      </div>
    )}
    <section className="panel p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <form onSubmit={event => { event.preventDefault(); change("search", search.trim()); }} className="grid min-w-0 flex-1 gap-1 text-sm">
          <label htmlFor="history-search">Search activity</label>
          <div className="flex gap-2"><input id="history-search" className="field min-w-0" value={search} maxLength={120}
            placeholder="Member, collector, loan, receipt, note" onChange={event => setSearch(event.target.value)} />
            <button className="btn-muted" type="submit">Search</button></div>
        </form>
        <div className="flex flex-wrap items-end gap-3 lg:shrink-0 lg:flex-nowrap">
          <label className="grid min-w-40 flex-1 gap-1 text-sm sm:flex-none">Export from
            <input type="date" className="field" value={exportFrom} max={exportTo || undefined} onChange={event => setExportFrom(event.target.value)} />
          </label>
          <label className="grid min-w-40 flex-1 gap-1 text-sm sm:flex-none">Export to
            <input type="date" className="field" value={exportTo} min={exportFrom || undefined} onChange={event => setExportTo(event.target.value)} />
          </label>
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={exporting} onClick={() => void exportPaymentReport()}>
            {exporting ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </div>
      {exportError && <p className="mt-2 text-sm text-red-700" role="alert">{exportError}</p>}
    </section>
    <div className="flex gap-2" role="tablist" aria-label="History type">
      {(["payments", "remarks"] as const).map(tab => <button key={tab} type="button" role="tab"
        id={`history-tab-${tab}`} aria-selected={activeTab === tab} aria-controls="history-panel"
        tabIndex={activeTab === tab ? 0 : -1}
        className={activeTab === tab ? "btn-primary" : "btn-muted"}
        onClick={() => change("type", tab)}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "payments" : event.key === "End" ? "remarks" : activeTab === "payments" ? "remarks" : "payments";
          change("type", next);
          document.getElementById(`history-tab-${next}`)?.focus();
        }}>{tab === "payments" ? "Payments" : "Remarks"}</button>)}
    </div>
    <div id="history-panel" role="tabpanel" aria-labelledby={`history-tab-${activeTab}`} aria-busy={loading} className="grid gap-4">
    {error && <p className="panel p-4 text-red-700" role="alert">{error} <button className="btn-muted" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {loading ? <p className="panel p-4" role="status">Loading collection history...</p> : data && <>
      <section className="panel p-4">
        <p className="mb-3 text-sm text-slate-600">{data.total} {activeTab} matching your filters. Latest first.</p>
        <div className="grid gap-3">
          {data.items.map(item => <article key={`${item.kind}-${item.id}`} className="rounded-xl border border-slate-200 bg-white/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="font-semibold">{item.member_name}</h2><p className="text-xs text-slate-500">CIF: {item.cif_key || "—"} · {item.branch_name || "No branch"}</p></div>
              <div className="sm:text-right"><p className="font-semibold">{item.kind === "payment" ? money(Number(item.amount)) : getRemarkCategoryLabel(item.category)}</p>
                <p className="text-xs text-slate-500">{item.occurred_at.replace("T", " ").replace(/\.\d+Z?$/, "")}</p></div>
            </div>
            <p className="mt-2 text-sm">Recorded by <strong>{item.collector_name || "Deleted account / unattributed"}</strong>
              {item.loan_id && <> · <Link className="font-medium text-brand-700 underline" to={`/loan-details/${item.loan_id}`}>{item.loan_account_no || `Loan #${item.loan_id}`}</Link></>}</p>
            {item.kind === "payment" ? <p className="mt-1 text-sm text-slate-600">Payment PAY-{String(item.id).padStart(6, "0")} · Receipt: {item.or_no || "Not provided"}</p>
              : <><p className="mt-1 text-xs text-slate-500">{item.kind === "member_remark" ? "Member note" : "Loan note"}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.remark}</p></>}
          </article>)}
          {data.items.length === 0 && <p className="py-8 text-center text-slate-500">No {activeTab} found for these filters.</p>}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button className="btn-muted" disabled={data.page <= 1} onClick={() => change("page", String(data.page - 1))}>Previous</button>
          <span className="text-sm">Page {data.page} of {pages}</span>
          <button className="btn-muted" disabled={data.page >= pages} onClick={() => change("page", String(data.page + 1))}>Next</button>
        </div>
      </section>
    </>}
    </div>
  </main>;
}
