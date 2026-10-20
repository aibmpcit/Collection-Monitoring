import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { createPortal } from "react-dom";
import { Camera, Paperclip } from "lucide-react";
import { RemarkPhotoView } from "../components/RemarkPhoto";
import { MapLink } from "../components/FieldEvidence";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExportChoiceDialog } from "../components/ExportChoiceDialog";
import { PageHeader } from "../components/PageHeader";
import { ToastNotification } from "../components/ToastNotification";
import { useAuth } from "../context/AuthContext";
import { getRemarkCategoryLabel, paymentStatusLabel } from "../constants/remarkCategories";
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
  payment_status?: string | null;
  photo_id?: number | null; photo_latitude?: number | string | null; photo_longitude?: number | string | null;
  photo_accuracy?: number | string | null; photo_captured_at?: string | null;
  geo_latitude?: number | string | null; geo_longitude?: number | string | null; geo_accuracy?: number | string | null;
  proof_kind?: string | null; proof_name?: string | null; geo_place?: string | null;
}

const remarkPath = (item: Activity) => item.kind === "member_remark"
  ? `/borrowers/${item.member_id}/remarks/${item.id}`
  : `/loans/${item.loan_id}/remarks/${item.id}`;

const toNumberOrNull = (value: unknown) => value === null || value === undefined || value === "" ? null : Number(value);
interface History {
  items: Activity[];
  summary: { total: number; amount: number; payments: number; members: number; attachments?: number };
  total: number; page: number; pageSize: number;
}
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

const plainDateTime = (value: string) => value.replace("T", " ").replace(/\.\d+Z?$/, "");

/** Short date and time for phone cards, e.g. "Oct 15, 7:30 AM". */
function shortDateTime(value: string) {
  const parsed = new Date(plainDateTime(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return plainDateTime(value);
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const ACTIVITY_TABS = [["all", "All"], ["payments", "Payments"], ["remarks", "Actions Taken"]] as const;

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
  // Collectors and LAS see only their own activity, as "My Collection History".
  const isFieldUser = user?.role === "staff" || user?.role === "las";
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
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  useEscapeToClose(Boolean(selectedActivity), () => setSelectedActivity(null));
  const activeTab = params.get("type") ?? "all";
  const requestParams = new URLSearchParams(params);
  requestParams.delete("type");
  if (!isFieldUser) requestParams.delete("collectorId");
  if (isFieldUser) requestParams.set("collectorId", String(user.id));
  if (activeTab !== "all") requestParams.set("type", activeTab);
  // The date inputs default to this month before the URL has dates, so totals must follow the inputs.
  if (exportFrom) requestParams.set("from", exportFrom); else requestParams.delete("from");
  if (exportTo) requestParams.set("to", exportTo); else requestParams.delete("to");
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

  async function exportExcelReport() {
    if (exporting) return;
    if (!exportFrom || !exportTo || exportFrom > exportTo) { setExportError("Select a valid export date range."); return; }
    setExporting(true); setExportError("");
    try {
      const exportParams = new URLSearchParams({ from: exportFrom, to: exportTo, export: "true" });
      if (activeTab !== "all") exportParams.set("type", activeTab);
      if (params.get("userId")) exportParams.set("userId", params.get("userId")!);
      if (params.get("branchId")) exportParams.set("branchId", params.get("branchId")!);
      const report = await apiRequest<History>(`/collection-history?${exportParams}`);
      const XLSX = await import("xlsx");
      const rows = report.items.map(item => ({
        Date: item.occurred_at.replace("T", " ").replace(/\.\d+Z?$/, ""),
        Member: item.member_name, "Loan Account": item.loan_account_no ?? "", "Loan Type": item.loan_type ?? "",
        Type: item.kind === "payment" ? "Payment" : "Action Taken", "Collected By": item.collector_name ?? "Unattributed",
        Amount: item.kind === "payment" ? Number(item.amount) : "", "Actions Taken / Receipt": item.kind === "payment" ? (item.or_no ?? "") : (item.remark ?? getRemarkCategoryLabel(item.category)), Branch: item.branch_name ?? ""
      }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Collection History");
      XLSX.writeFile(workbook, `collection-history-${exportFrom}-to-${exportTo}.xlsx`);
    } catch (e) { setExportError(e instanceof Error ? e.message : "Unable to export collection history."); }
    finally { setExporting(false); }
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
      const selectedCollectorId = isFieldUser ? String(user.id) : params.get("collectorId");
      if (selectedCollectorId) exportParams.set("collectorId", selectedCollectorId);
      if (params.get("userId")) exportParams.set("userId", params.get("userId")!);
      if (params.get("branchId")) exportParams.set("branchId", params.get("branchId")!);
      const report = await apiRequest<History>(`/collection-history?${exportParams.toString()}`);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const selectedAccount = accounts.find(account => String(account.id) === params.get("userId"))?.username;
      const collector = isFieldUser ? (user.username ?? "Collector") : (collectorName ?? selectedAccount ?? "All users");
      const columns = [
        { label: "Date", width: 35 }, { label: "Collector", width: 30 }, { label: "Branch", width: 30 },
        { label: "Member", width: 38 }, { label: "Loan Account", width: 30 }, { label: "Type", width: 22 },
        { label: "Actions Taken / Receipt", width: 55 }, { label: "Amount", width: 30 }
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
        pdf.text(`Account: ${collector}`, 10, 18);
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
          item.branch_name ?? "", item.member_name, item.loan_account_no ?? "", item.kind === "payment" ? "Payment" : "Action Taken",
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
      if (report.items.length === 0) pdf.text("No activity found for the selected date range.", 10, 49);
      const safeName = collector.replace(/[^a-z0-9_-]+/gi, "-");
      pdf.save(`collection-history-${safeName}-${exportFrom}-to-${exportTo}.pdf`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Unable to export payment report.");
    } finally {
      setExporting(false);
    }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return <main className="page-shell">
    {!isFieldUser && <Link to="/collector-history" className="text-sm font-semibold text-brand-700">← Back to collectors</Link>}
    <PageHeader title={collectorName ? `${collectorName}'s History` : isFieldUser ? "My Collection History" : "Collection History"}
      eyebrow="Collection Activity"
      actions={<button className="btn-muted" onClick={() => setRefresh(value => value + 1)}>Refresh</button>} />
    {!loading && data && (
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {[["Total collected", money(Number(data.summary.amount))], ["Payments", data.summary.payments],
          ["Members reached", data.summary.members], ["Follow-up notes", data.summary.total - data.summary.payments]].map(([label, value]) =>
          <section className="panel min-w-0 p-3 sm:p-4" key={label}>
            <p className="text-xs text-slate-600 sm:text-sm">{label}</p>
            <p className="mt-1 truncate text-lg font-bold sm:text-2xl">{value}</p>
          </section>)}
      </div>
    )}
    <section className="panel p-4 lg:flex lg:flex-wrap lg:items-end lg:gap-3">
      {isFieldUser && <div role="tablist" aria-label="Activity type" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 lg:mb-0 lg:w-full lg:max-w-sm">
        {ACTIVITY_TABS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeTab === value}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${activeTab === value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`}
          onClick={() => change("type", value === "all" ? "" : value)}>{label}</button>)}
      </div>}
      <div className="flex flex-col gap-4 lg:contents">
        <form onSubmit={event => { event.preventDefault(); change("search", search.trim()); }} className="grid min-w-0 flex-1 gap-1 text-sm">
          <label htmlFor="history-search">Search activity</label>
          <div className="flex gap-2"><input id="history-search" className="field min-w-0" value={search} maxLength={120}
            placeholder={isFieldUser ? "Member, loan, receipt, note" : "Member, collector, loan, receipt, note"} onChange={event => setSearch(event.target.value)} />
            <button className="btn-muted" type="submit">Search</button></div>
        </form>
        <div className="grid min-w-0 grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap lg:shrink-0 lg:flex-nowrap">
          <label className="grid min-w-0 gap-1 text-sm sm:min-w-40 sm:flex-none lg:min-w-32">From
            <input type="date" className="field min-w-0 w-full" value={exportFrom} max={exportTo || undefined} onChange={event => { setExportFrom(event.target.value); change("from", event.target.value); }} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm sm:min-w-40 sm:flex-none lg:min-w-32">To
            <input type="date" className="field min-w-0 w-full" value={exportTo} min={exportFrom || undefined} onChange={event => { setExportTo(event.target.value); change("to", event.target.value); }} />
          </label>
          <button type="button" className="btn-primary col-span-2 w-full sm:w-auto lg:hidden" disabled={exporting} onClick={() => setExportChoiceOpen(true)}>
            {exporting ? "Exporting..." : "Export"}
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
            <option value="all">All activity</option><option value="payments">Payments</option><option value="remarks">Actions Taken</option>
          </select>
        </label>
      </div>}
      <button type="button" className="btn-primary mt-3 hidden w-full lg:mt-0 lg:ml-auto lg:block lg:w-auto" disabled={exporting} onClick={() => setExportChoiceOpen(true)}>
        {exporting ? "Exporting..." : "Export"}
      </button>
      {exportError && <p className="mt-2 text-sm text-red-700" role="alert">{exportError}</p>}
    </section>
    <div id="history-panel" aria-busy={loading} className="grid gap-4">
    {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}
    {loading ? <p className="panel p-4" role="status">Loading collection history...</p> : data && <>
      <section className="panel p-4">
        {activeTab === "remarks" && <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="surface-soft p-3"><p className="text-xs text-slate-600">Actions Taken</p><p className="mt-1 text-xl font-bold">{data.total}</p></div>
          <div className="surface-soft p-3"><p className="text-xs text-slate-600">Members</p><p className="mt-1 text-xl font-bold">{data.summary.members}</p></div>
          <div className="surface-soft p-3"><p className="text-xs text-slate-600">Attachments</p><p className="mt-1 text-xl font-bold">{Number(data.summary.attachments ?? 0)}</p></div>
        </div>}
        <p className="mb-3 text-sm text-slate-600">{data.total} activities matching your filters. Latest first.</p>
        <ul className="grid gap-2 lg:hidden" aria-label="Collection activity">
          {data.items.map(item => <li key={`${item.kind}-${item.id}`}>
            <button type="button" onClick={() => setSelectedActivity(item)}
              className="surface-soft block w-full p-3 text-left transition active:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{item.member_name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {item.loan_account_no || (item.kind === "member_remark" ? "Member note" : "No loan account")}
                    {!isFieldUser && item.branch_name ? ` · ${item.branch_name}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {item.kind === "payment"
                    ? <span className="block font-semibold text-emerald-700">{money(Number(item.amount))}</span>
                    : <span className="inline-block max-w-[9rem] truncate rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{getRemarkCategoryLabel(item.category)}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-500">{shortDateTime(item.occurred_at)}</span>
                </span>
              </span>
              {item.kind === "payment"
                ? <span className="mt-2 block text-xs text-slate-600">Receipt: {item.or_no || "Not provided"}{item.payment_status ? ` · ${paymentStatusLabel(item.payment_status)}` : ""}</span>
                : item.remark && <span className="mt-2 block line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-700">{item.remark}</span>}
              {(!isFieldUser || item.attachment_name || item.photo_id) && <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {!isFieldUser && <span>By {item.collector_name || "Unattributed"}</span>}
                {item.photo_id && <span className="inline-flex items-center gap-1"><Camera size={12} aria-hidden="true" />Photo</span>}
                {item.attachment_name && <span className="inline-flex items-center gap-1"><Paperclip size={12} aria-hidden="true" />Attachment</span>}
              </span>}
            </button>
          </li>)}
          {data.items.length === 0 && <li className="py-8 text-center text-slate-500">No collection activity found for these filters.</li>}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 lg:block">
          <div className="grid min-w-[1200px] grid-cols-[1.2fr_1.3fr_1.1fr_1fr_0.8fr_1fr_1.5fr_1fr] gap-3 bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600"><span>Member</span><span>Loan account</span><span>Loan type</span><span>Added by</span><span>Type</span><span>Amount</span><span>Actions Taken / receipt</span><span>Date</span></div>
          <div className="grid min-w-[1200px] gap-0">
          {data.items.map(item => <article key={`${item.kind}-${item.id}`} tabIndex={0} role="button"
            onClick={() => setSelectedActivity(item)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedActivity(item); } }}
            className="grid cursor-pointer grid-cols-[1.2fr_1.3fr_1.1fr_1fr_0.8fr_1fr_1.5fr_1fr] items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 text-sm transition hover:bg-brand-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
            <span className="font-semibold text-slate-900">{item.member_name}<small className="block font-normal text-slate-500">{item.branch_name || "No branch"}</small></span>
            <span className="text-brand-700">{item.loan_account_no || "-"}</span>
            <span>{item.loan_type || "-"}</span>
            <span>{item.collector_name || "Unattributed"}</span>
            <span>{item.kind === "payment" ? "Payment" : "Action Taken"}</span>
            <span>{item.kind === "payment" ? money(Number(item.amount)) : "-"}</span>
            <span className="flex min-w-0 items-center gap-1">
              {item.attachment_name && <Paperclip size={12} className="shrink-0 text-slate-400" aria-label="Has attachment" />}
              <span className="truncate">{item.kind === "payment" ? `Receipt: ${item.or_no || "Not provided"}` : (item.remark || getRemarkCategoryLabel(item.category))}</span>
            </span>
            <span className="text-slate-500">{plainDateTime(item.occurred_at)}</span>
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
    <ExportChoiceDialog open={exportChoiceOpen} title="Export collection history"
      description={`${exportFrom} to ${exportTo} · uses your current filters`}
      onExcel={() => void exportExcelReport()} onPdf={() => void exportPaymentReport()} onClose={() => setExportChoiceOpen(false)} />
    {selectedActivity && typeof document !== "undefined" && createPortal(<div className="modal-sheet-shell" role="presentation" onMouseDown={() => setSelectedActivity(null)}>
      <section className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedActivity.kind === "payment" ? "Payment" : selectedActivity.kind === "member_remark" ? "Member note" : "Loan note"}</p>
            <h2 id="activity-detail-title" className="mt-1 break-words text-xl font-bold">{selectedActivity.member_name}</h2>
          </div>
          <button className="btn-muted shrink-0" type="button" onClick={() => setSelectedActivity(null)}>Close</button>
        </div>
        {selectedActivity.kind === "payment"
          ? <div className="mt-4 grid grid-cols-2 gap-4"><div><p className="text-xs text-slate-500">Amount</p><p className="text-lg font-semibold">{money(Number(selectedActivity.amount))}</p></div><div><p className="text-xs text-slate-500">Receipt</p><p>{selectedActivity.or_no || "Not provided"}</p></div></div>
          : <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{getRemarkCategoryLabel(selectedActivity.category)}</p><p className="mt-2 whitespace-pre-wrap break-words">{selectedActivity.remark || "No description"}</p></div>}
        {selectedActivity.geo_latitude != null && selectedActivity.geo_longitude != null && <div className="mt-3">
          <MapLink point={{ latitude: Number(selectedActivity.geo_latitude), longitude: Number(selectedActivity.geo_longitude), accuracy: toNumberOrNull(selectedActivity.geo_accuracy), placeName: selectedActivity.geo_place ?? null }}
            label={selectedActivity.kind === "payment" ? "Where it was collected" : "View on map"} />
        </div>}
        {selectedActivity.kind === "payment" && selectedActivity.proof_kind && <div className="mt-3">
          {selectedActivity.proof_kind === "photo"
            ? <RemarkPhotoView path={`/loans/${selectedActivity.loan_id}/payments/${selectedActivity.id}/proof`} photo={{
                latitude: toNumberOrNull(selectedActivity.geo_latitude), longitude: toNumberOrNull(selectedActivity.geo_longitude),
                accuracy: toNumberOrNull(selectedActivity.geo_accuracy), placeName: selectedActivity.geo_place ?? null, capturedAt: plainDateTime(selectedActivity.occurred_at)
              }} />
            : <button type="button" className="btn-muted" onClick={() => {
                const item = selectedActivity;
                void apiDownload(`/loans/${item.loan_id}/payments/${item.id}/proof`, item.proof_name || "payment-proof")
                  .catch(e => setError(e instanceof Error ? e.message : "Unable to download proof"));
              }}><Paperclip size={14} aria-hidden="true" /><span className="truncate">Proof: {selectedActivity.proof_name}</span></button>}
        </div>}
        {selectedActivity.kind !== "payment" && selectedActivity.photo_id && <div className="mt-4">
          <RemarkPhotoView path={`${remarkPath(selectedActivity)}/photo`} photo={{
            latitude: toNumberOrNull(selectedActivity.photo_latitude),
            longitude: toNumberOrNull(selectedActivity.photo_longitude),
            accuracy: toNumberOrNull(selectedActivity.photo_accuracy),
            capturedAt: selectedActivity.photo_captured_at ?? ""
          }} />
        </div>}
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-slate-500">Date</p><p>{plainDateTime(selectedActivity.occurred_at)}</p></div>
          <div><p className="text-xs text-slate-500">Recorded by</p><p className="break-words">{selectedActivity.collector_name || "Deleted account / unattributed"}</p></div>
          <div><p className="text-xs text-slate-500">Loan account</p><p className="break-words">{selectedActivity.loan_account_no || "No loan account"}</p></div>
          <div><p className="text-xs text-slate-500">Loan type</p><p className="break-words">{selectedActivity.loan_type || "-"}</p></div>
          <div><p className="text-xs text-slate-500">Branch</p><p className="break-words">{selectedActivity.branch_name || "No branch"}</p></div>
          <div><p className="text-xs text-slate-500">Contact</p><p className="break-words">{selectedActivity.contact_info || "-"}</p></div>
        </div>
        {(selectedActivity.loan_id || selectedActivity.attachment_name) && <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
          {selectedActivity.loan_id && <Link className="btn-primary justify-center" to={`/loan-details/${selectedActivity.loan_id}`}>Open loan</Link>}
          {selectedActivity.attachment_name && <button type="button" className="btn-muted justify-center" onClick={() => {
            const item = selectedActivity;
            void apiDownload(`${remarkPath(item)}/attachment`, item.attachment_name || "attachment").catch(e => setError(e instanceof Error ? e.message : "Unable to download attachment"));
          }}><Paperclip size={14} aria-hidden="true" /><span className="truncate">Download {selectedActivity.attachment_name}</span></button>}
        </div>}
      </section>
    </div>, document.body)}
  </main>;
}
