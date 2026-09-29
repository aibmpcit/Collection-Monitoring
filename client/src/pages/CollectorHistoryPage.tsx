import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ToastNotification } from "../components/ToastNotification";
import { useAuth } from "../context/AuthContext";
import { getRemarkCategoryLabel } from "../constants/remarkCategories";
import { apiDownload, apiRequest } from "../services/api";

interface Activity {
  id: number; kind: string; occurred_at: string; amount: number;
  or_no: string | null; remark: string | null; category: string | null;
  loan_id: number | null; loan_account_no: string | null; member_id: number;
  member_name: string;
  cif_key: string | null; collector_name: string | null; branch_name: string | null;
  attachment_name?: string | null;
  loan_type?: string | null; maturity_date?: string | null; loan_status?: string | null;
  contact_info?: string | null; address?: string | null; collector_role?: string | null;
}
interface History {
  items: Activity[];
  summary: { total: number; amount: number; payments: number; members: number; attachments?: number };
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

interface Branch { id: number; name: string; code: string }
interface Account { id: number; username: string; role: string; branchName: string | null }

export function CollectorHistoryPage() {
  return <CollectorHistoryDetails />;
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
  const [exportFrom, setExportFrom] = useState(params.get("from") ?? initialDates.from);
  const [exportTo, setExportTo] = useState(params.get("to") ?? initialDates.to);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const activeTab = params.get("type") ?? "all";
  const requestParams = new URLSearchParams(params);
  requestParams.delete("type");
  if (user?.role !== "staff") requestParams.delete("collectorId");
  if (user?.role === "staff") requestParams.set("collectorId", String(user.id));
  if (activeTab !== "all") requestParams.set("type", activeTab);
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

  useEffect(() => {
    if (user?.role !== "super_admin" && user?.role !== "branch_admin") return;
    Promise.all([apiRequest<Branch[]>("/branches"), apiRequest<Account[]>("/staff")])
      .then(([loadedBranches, loadedAccounts]) => { setBranches(loadedBranches); setAccounts(loadedAccounts); })
      .catch(() => undefined);
  }, [user?.role, refresh]);

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
      const exportParams = new URLSearchParams({ from: exportFrom, to: exportTo, export: "true" });
      if (activeTab !== "all") exportParams.set("type", activeTab);
      const selectedCollectorId = user?.role === "staff" ? String(user.id) : params.get("collectorId");
      if (selectedCollectorId) exportParams.set("collectorId", selectedCollectorId);
      if (params.get("userId")) exportParams.set("userId", params.get("userId")!);
      if (params.get("branchId")) exportParams.set("branchId", params.get("branchId")!);
      const report = await apiRequest<History>(`/collection-history?${exportParams.toString()}`);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const collector = collectorName ?? user?.username ?? "Collector";
      const columns = [
        { label: "Date", width: 35 }, { label: "Collector", width: 30 }, { label: "Branch", width: 30 },
        { label: "Member", width: 38 }, { label: "Loan Account", width: 30 }, { label: "Type", width: 22 },
        { label: "Remarks / Receipt", width: 55 }, { label: "Amount", width: 30 }
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
        pdf.text("Collection History Report", 10, 12);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Collector: ${collector}`, 10, 18);
        pdf.text(`Period: ${exportFrom} to ${exportTo}`, 10, 23);
        pdf.text(`Activities: ${report.total}    Total collected: ${money(Number(report.summary.amount))}`, 10, 28);
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
          item.branch_name ?? "", item.member_name, item.loan_account_no ?? "", item.kind === "payment" ? "Payment" : "Remark",
          item.kind === "payment" ? `Receipt: ${item.or_no ?? "Not provided"}` : (item.remark ?? getRemarkCategoryLabel(item.category)),
          item.kind === "payment" ? `PHP ${Number(item.amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""
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
    <PageHeader title={collectorName ? `${collectorName}'s History` : user?.role === "staff" ? "My Collection History" : "Collection History"}
      eyebrow="Collection Activity"
      actions={<button className="btn-muted max-md:absolute max-md:right-4 max-md:top-4" onClick={() => setRefresh(value => value + 1)}>Refresh</button>} />
    {!loading && data && (
      <div className={`${user?.role === "staff" ? "hidden lg:grid" : "grid"} grid-cols-2 gap-3 xl:grid-cols-4`}>
        {[["Total collected", money(Number(data.summary.amount))], ["Payments", data.summary.payments],
          ["Members reached", data.summary.members], ["Follow-up notes", data.summary.total - data.summary.payments]].map(([label, value]) =>
          <section className="panel p-4" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></section>)}
      </div>
    )}
    <section className="panel p-4 lg:flex lg:flex-wrap lg:items-end lg:gap-3">
      <div className="flex flex-col gap-4 lg:contents">
        <form onSubmit={event => { event.preventDefault(); change("search", search.trim()); }} className="grid min-w-0 flex-1 gap-1 text-sm">
          <label htmlFor="history-search">Search activity</label>
          <div className="flex gap-2"><input id="history-search" className="field min-w-0" value={search} maxLength={120}
            placeholder="Member, collector, loan, receipt, note" onChange={event => setSearch(event.target.value)} />
            <button className="btn-muted" type="submit">Search</button></div>
        </form>
        <div className="grid min-w-0 grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap lg:shrink-0 lg:flex-nowrap">
          <label className="grid min-w-0 gap-1 text-sm sm:min-w-40 sm:flex-none lg:min-w-32">From
            <input type="date" className="field min-w-0 w-full" value={exportFrom} max={exportTo || undefined} onChange={event => { setExportFrom(event.target.value); change("from", event.target.value); }} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm sm:min-w-40 sm:flex-none lg:min-w-32">To
            <input type="date" className="field min-w-0 w-full" value={exportTo} min={exportFrom || undefined} onChange={event => { setExportTo(event.target.value); change("to", event.target.value); }} />
          </label>
          <button type="button" className="btn-primary col-span-2 w-full sm:w-auto lg:hidden" disabled={exporting} onClick={() => void exportPaymentReport()}>
            {exporting ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </div>
      {(user?.role === "super_admin" || user?.role === "branch_admin") && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:mt-0 lg:contents">
        {user?.role === "super_admin" && <label className="grid gap-1 text-sm">Branch
          <select className="field" value={params.get("branchId") ?? ""} onChange={event => change("branchId", event.target.value)}>
            <option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
          </select>
        </label>}
        <label className="grid min-w-0 gap-1 text-sm">User account
          <select className="field" value={params.get("userId") ?? ""} onChange={event => change("userId", event.target.value)}>
            <option value="">All users</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.username} ({account.role})</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">Activity
          <select className="field" value={activeTab} onChange={event => change("type", event.target.value === "all" ? "" : event.target.value)}>
            <option value="all">All activity</option><option value="payments">Payments</option><option value="remarks">Remarks</option>
          </select>
        </label>
      </div>}
      <button type="button" className="btn-primary mt-3 hidden w-full lg:mt-0 lg:ml-auto lg:block lg:w-auto" disabled={exporting} onClick={() => void exportPaymentReport()}>
        {exporting ? "Exporting..." : "Export PDF"}
      </button>
      {exportError && <p className="mt-2 text-sm text-red-700" role="alert">{exportError}</p>}
    </section>
    <div id="history-panel" aria-busy={loading} className="grid gap-4">
    {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}
    {loading ? <p className="panel p-4" role="status">Loading collection history...</p> : data && <>
      <section className="panel p-4">
        {activeTab === "remarks" && <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="surface-soft p-3"><p className="text-xs text-slate-600">Remarks</p><p className="mt-1 text-xl font-bold">{data.total}</p></div>
          <div className="surface-soft p-3"><p className="text-xs text-slate-600">Members</p><p className="mt-1 text-xl font-bold">{data.summary.members}</p></div>
          <div className="surface-soft p-3"><p className="text-xs text-slate-600">Attachments</p><p className="mt-1 text-xl font-bold">{Number(data.summary.attachments ?? 0)}</p></div>
        </div>}
        <p className="mb-3 text-sm text-slate-600">{data.total} activities matching your filters. Latest first.</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <div className="grid min-w-[760px] grid-cols-[1.2fr_1.3fr_1fr_1.5fr_1fr] gap-3 bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600"><span>Member</span><span>Loan account</span><span>Type</span><span>Remarks / receipt</span><span>Date</span></div>
          <div className="grid min-w-[760px] gap-0">
          {data.items.map(item => <article key={`${item.kind}-${item.id}`} tabIndex={0} role="button"
            onClick={() => setSelectedActivity(item)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedActivity(item); } }}
            className="cursor-pointer border-b border-slate-200 bg-white px-4 py-3 text-sm transition hover:bg-brand-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [&>div:not(:first-child)]:hidden [&>p]:hidden">
            <div className="grid grid-cols-[1.2fr_1.3fr_1fr_1.5fr_1fr] items-center gap-3">
              <span className="font-semibold text-slate-900">{item.member_name}<small className="block font-normal text-slate-500">{item.branch_name || "No branch"}</small></span>
              <span className="text-brand-700">{item.loan_account_no || "-"}</span>
              <span>{item.kind === "payment" ? "Payment" : "Remark"}</span>
              <span className="truncate">{item.kind === "payment" ? `Receipt: ${item.or_no || "Not provided"}` : (item.remark || getRemarkCategoryLabel(item.category))}</span>
              <span className="text-slate-500">{item.occurred_at.replace("T", " ").replace(/\.\d+Z?$/, "")}</span>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="font-semibold">{item.member_name}</h2><p className="text-xs text-slate-500">CIF: {item.cif_key || "—"} · {item.branch_name || "No branch"}</p></div>
              <div className="sm:text-right"><p className="font-semibold">{item.kind === "payment" ? money(Number(item.amount)) : getRemarkCategoryLabel(item.category)}</p>
                <p className="text-xs text-slate-500">{item.occurred_at.replace("T", " ").replace(/\.\d+Z?$/, "")}</p></div>
            </div>
            <p className="mt-2 text-sm">Recorded by <strong>{item.collector_name || "Deleted account / unattributed"}</strong>
              {item.loan_id && <> · <Link className="font-medium text-brand-700 underline" to={`/loan-details/${item.loan_id}`}>{item.loan_account_no || `Loan #${item.loan_id}`}</Link></>}</p>
            {item.kind === "payment" ? <p className="mt-1 text-sm text-slate-600">Payment PAY-{String(item.id).padStart(6, "0")} · Receipt: {item.or_no || "Not provided"}</p>
              : <>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{item.kind === "member_remark" ? "Member note" : "Loan note"}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.remark}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="surface-soft p-3"><p className="text-xs text-slate-500">Member details</p><p className="mt-1 text-sm font-semibold">{item.member_name}</p><p className="text-xs text-slate-600">CIF: {item.cif_key || "-"}</p><p className="text-xs text-slate-600">Contact: {item.contact_info || "-"}</p></div>
                  <div className="surface-soft p-3"><p className="text-xs text-slate-500">Address and branch</p><p className="mt-1 text-sm">{item.address || "-"}</p><p className="text-xs text-slate-600">{item.branch_name || "No branch"}</p></div>
                  {item.loan_id && <div className="surface-soft p-3"><p className="text-xs text-slate-500">Loan details</p><Link className="mt-1 block text-sm font-semibold text-brand-700 underline" to={`/loan-details/${item.loan_id}`}>{item.loan_account_no || `Loan #${item.loan_id}`}</Link><p className="text-xs text-slate-600">{item.loan_type || "Loan"} / {item.loan_status || "-"}</p><p className="text-xs text-slate-600">Maturity: {item.maturity_date ? item.maturity_date.slice(0, 10) : "-"}</p></div>}
                </div>
              </>}
            {item.attachment_name && <button type="button" className="btn-muted mt-2 h-8 px-3 text-xs" onClick={() => {
              const path = item.kind === "member_remark"
                ? `/borrowers/${item.member_id}/remarks/${item.id}/attachment`
                : `/loans/${item.loan_id}/remarks/${item.id}/attachment`;
              void apiDownload(path, item.attachment_name || "attachment").catch(e => setError(e instanceof Error ? e.message : "Unable to download attachment"));
            }}>Download {item.attachment_name}</button>}
          </article>)}
          {data.items.length === 0 && <p className="py-8 text-center text-slate-500">No collection activity found for these filters.</p>}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button className="btn-muted" disabled={data.page <= 1} onClick={() => change("page", String(data.page - 1))}>Previous</button>
          <span className="text-sm">Page {data.page} of {pages}</span>
          <button className="btn-muted" disabled={data.page >= pages} onClick={() => change("page", String(data.page + 1))}>Next</button>
        </div>
      </section>
    </>}
    </div>
    {selectedActivity && <div className="fixed left-0 top-0 z-[200] flex h-[100dvh] w-screen items-center justify-center overflow-y-auto bg-slate-950/45 p-4" role="presentation" onMouseDown={() => setSelectedActivity(null)}>
      <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedActivity.kind === "payment" ? "Payment" : "Remark"}</p><h2 id="activity-detail-title" className="mt-1 text-xl font-bold">{selectedActivity.member_name}</h2></div><button className="btn-muted" type="button" onClick={() => setSelectedActivity(null)}>Close</button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Date</p><p>{selectedActivity.occurred_at.replace("T", " ").replace(/\.\d+Z?$/, "")}</p></div><div><p className="text-xs text-slate-500">Recorded by</p><p>{selectedActivity.collector_name || "Deleted account / unattributed"}</p></div><div><p className="text-xs text-slate-500">Branch</p><p>{selectedActivity.branch_name || "No branch"}</p></div><div><p className="text-xs text-slate-500">Loan account</p><p>{selectedActivity.loan_account_no || "No loan account"}</p></div><div><p className="text-xs text-slate-500">Loan type</p><p>{selectedActivity.loan_type || "-"}</p></div></div>
        {selectedActivity.kind === "payment" ? <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Amount</p><p className="text-lg font-semibold">{money(Number(selectedActivity.amount))}</p></div><div><p className="text-xs text-slate-500">Receipt</p><p>{selectedActivity.or_no || "Not provided"}</p></div></div> : <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{getRemarkCategoryLabel(selectedActivity.category)}</p><p className="mt-2 whitespace-pre-wrap break-words">{selectedActivity.remark || "No description"}</p></div>}
      </section>
    </div>}
  </main>;
}
