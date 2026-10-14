import { useEffect, useState } from "react";
import { ExportChoiceDialog } from "../components/ExportChoiceDialog";
import { PageHeader } from "../components/PageHeader";
import { ToastNotification } from "../components/ToastNotification";
import { getRemarkCategoryLabel } from "../constants/remarkCategories";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";

interface ReportSummary {
  from: string;
  to: string;
  branchId: number | null;
  collectorId: number | null;
  summary: {
    collected: number; payments: number; membersPaid: number; loansPaid: number;
    remarks: number; membersFollowedUp: number;
    activeLoans: number; activeBalance: number; overdueLoans: number; overdueBalance: number;
  };
  byBranch: { branchId: number | null; branchName: string; amount: number; payments: number; members: number }[];
  byCollector: { userId: number | null; username: string; role: string; amount: number; payments: number; members: number }[];
  byDay: { day: string; amount: number; payments: number }[];
  byCategory: { category: string; remarks: number; members: number }[];
  byParAge: { bucket: string; label: string; membersCollected: number; payments: number; amount: number; openMembers: number; openLoans: number }[];
}
interface Branch { id: number; name: string; code: string }
interface Account { id: number; username: string; role: string; branchId: number | null }
interface UserActivity {
  id: number; username: string; role: string; branchName: string;
  logins: number; visits: number; screenSeconds: number; lastSeenAt: string | null;
  payments: number; remarks: number; actions: number; collected: number;
}
interface UserActivityReport {
  totals: { users: number; byRole: Record<string, number>; activeUsers: number; logins: number; visits: number; screenSeconds: number };
  users: UserActivity[];
}
type RankBy = "actions" | "collected" | "screenSeconds" | "logins" | "visits";

const RANK_OPTIONS: { value: RankBy; label: string }[] = [
  { value: "actions", label: "Actions recorded" },
  { value: "collected", label: "Amount collected" },
  { value: "screenSeconds", label: "Screen time" },
  { value: "logins", label: "Logins" },
  { value: "visits", label: "Visits" }
];
const ROLE_LABELS: Record<string, string> = { super_admin: "Super admin", branch_admin: "Branch admin", staff: "Collector", las: "LAS" };
const TOP_USERS_LIMIT = 10;

const coverage = (collected: number, open: number) => open > 0 ? `${((collected / open) * 100).toFixed(1)}%` : "-";

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function rankUsers(users: UserActivity[], rankBy: RankBy) {
  return [...users].sort((a, b) => b[rankBy] - a[rankBy] || b.actions - a.actions || a.username.localeCompare(b.username));
}

const lastSeen = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "Never";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

function localDateValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function ReportTable({ title, headers, rows, empty }: { title: string; headers: string[]; rows: (string | number)[][]; empty: string }) {
  return <section className="panel p-4">
    <h2 className="mb-3 text-base font-bold text-slate-900">{title}</h2>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>{headers.map((header, index) => <th key={header} className={`px-4 py-3 ${index === 0 ? "text-left" : "text-right"}`}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-slate-200 bg-white">
            {row.map((cell, index) => <td key={index} className={`px-4 py-2.5 ${index === 0 ? "font-semibold text-slate-900" : "text-right"}`}>{cell}</td>)}
          </tr>)}
          {rows.length === 0 && <tr><td colSpan={headers.length} className="py-6 text-center text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

export function ReportsPage() {
  const { user } = useAuth();
  const today = new Date();
  const [from, setFrom] = useState(localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(localDateValue(today));
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [collectorId, setCollectorId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false);
  const [userReport, setUserReport] = useState<UserActivityReport | null>(null);
  const [rankBy, setRankBy] = useState<RankBy>("actions");
  const [showAllUsers, setShowAllUsers] = useState(false);
  const isSuperAdmin = user?.role === "super_admin";

  useEffect(() => {
    if (!isSuperAdmin) return;
    apiRequest<Branch[]>("/branches").then(setBranches).catch(() => undefined);
  }, [isSuperAdmin]);

  useEffect(() => {
    apiRequest<Account[]>("/staff").then(setAccounts).catch(() => undefined);
  }, []);

  const collectorOptions = accounts.filter(account => !isSuperAdmin || !branchId || String(account.branchId) === branchId);
  const collectorLabel = accounts.find(account => String(account.id) === collectorId)?.username ?? "All collectors";

  useEffect(() => {
    // Drop a collector selection that no longer belongs to the chosen branch.
    if (collectorId && accounts.length && !collectorOptions.some(account => String(account.id) === collectorId)) setCollectorId("");
  }, [branchId, accounts]);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ from, to });
    if (isSuperAdmin && branchId) params.set("branchId", branchId);
    if (collectorId) params.set("collectorId", collectorId);
    apiRequest<ReportSummary>(`/reports/summary?${params}`)
      .then(result => { if (active) setData(result); })
      .catch(e => { if (active) { setError(e instanceof Error ? e.message : "Unable to load reports"); setData(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, branchId, collectorId, isSuperAdmin, refresh]);

  useEffect(() => {
    if (!isSuperAdmin || !from || !to || from > to) return;
    let active = true;
    const params = new URLSearchParams({ from, to });
    if (branchId) params.set("branchId", branchId);
    apiRequest<UserActivityReport>(`/reports/users?${params}`)
      .then(result => { if (active) setUserReport(result); })
      .catch(e => { if (active) { setError(e instanceof Error ? e.message : "Unable to load user activity"); setUserReport(null); } });
    return () => { active = false; };
  }, [from, to, branchId, isSuperAdmin, refresh]);

  const rankedUsers = userReport ? rankUsers(userReport.users, rankBy) : [];

  async function exportExcel() {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const s = data.summary;
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
        { Metric: "Period", Value: `${data.from} to ${data.to}` },
        { Metric: "Collector", Value: collectorLabel },
        { Metric: "Total collected", Value: s.collected },
        { Metric: "Payments", Value: s.payments },
        { Metric: "Members paid", Value: s.membersPaid },
        { Metric: "Loans paid", Value: s.loansPaid },
        { Metric: "Follow-up remarks", Value: s.remarks },
        { Metric: "Members followed up", Value: s.membersFollowedUp },
        { Metric: "Active loans (current)", Value: s.activeLoans },
        { Metric: "Active balance (current)", Value: s.activeBalance },
        { Metric: "Overdue loans (current)", Value: s.overdueLoans },
        { Metric: "Overdue balance (current)", Value: s.overdueBalance }
      ]), "Summary");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byParAge.map(row => ({
        "PAR age": row.label, "Members collected": row.membersCollected, "Members with open loans": row.openMembers,
        Coverage: coverage(row.membersCollected, row.openMembers), Payments: row.payments, Collected: row.amount
      }))), "By PAR Age");
      if (isSuperAdmin) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byBranch.map(row => ({
          Branch: row.branchName, Collected: row.amount, Payments: row.payments, Members: row.members
        }))), "By Branch");
      }
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byCollector.map(row => ({
        Account: row.username, Role: row.role, Collected: row.amount, Payments: row.payments, Members: row.members
      }))), "By Collector");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byDay.map(row => ({
        Date: row.day, Collected: row.amount, Payments: row.payments
      }))), "Daily Collections");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byCategory.map(row => ({
        Category: getRemarkCategoryLabel(row.category), Remarks: row.remarks, Members: row.members
      }))), "Remarks by Category");
      if (isSuperAdmin && userReport) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rankedUsers.map((row, index) => ({
          Rank: index + 1, Account: row.username, Role: ROLE_LABELS[row.role] ?? row.role, Branch: row.branchName,
          Actions: row.actions, Payments: row.payments, Remarks: row.remarks, Collected: row.collected,
          Logins: row.logins, Visits: row.visits, "Screen time (minutes)": Math.floor(row.screenSeconds / 60),
          "Last seen": lastSeen(row.lastSeenAt)
        }))), "User Activity");
      }
      XLSX.writeFile(workbook, `collection-report-${data.from}-to-${data.to}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to export report.");
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = 210;
      const left = 12;
      const usable = pageWidth - left * 2;
      const pdfMoney = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const branchLabel = isSuperAdmin
        ? (branches.find(branch => String(branch.id) === branchId)?.name ?? "All branches")
        : "My branch";
      let y = 14;
      const ensureSpace = (height: number) => {
        if (y + height > 285) { pdf.addPage(); y = 14; }
      };
      const fit = (value: string, width: number) => {
        if (pdf.getTextWidth(value) <= width - 4) return value;
        let shortened = value;
        while (shortened.length > 1 && pdf.getTextWidth(`${shortened}...`) > width - 4) shortened = shortened.slice(0, -1);
        return `${shortened}...`;
      };
      const table = (title: string, headers: string[], rows: string[][], widths: number[]) => {
        const columnWidths = widths.map(width => (width / widths.reduce((sum, value) => sum + value, 0)) * usable);
        const drawHead = () => {
          pdf.setFillColor(0, 61, 150);
          pdf.setTextColor(255, 255, 255);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8.5);
          pdf.rect(left, y, usable, 7, "F");
          let x = left;
          headers.forEach((header, index) => {
            if (index === 0) pdf.text(header, x + 2, y + 4.8);
            else pdf.text(header, x + columnWidths[index] - 2, y + 4.8, { align: "right" });
            x += columnWidths[index];
          });
          pdf.setTextColor(20, 30, 45);
          pdf.setFont("helvetica", "normal");
          y += 7;
        };
        ensureSpace(22);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.setTextColor(20, 30, 45);
        pdf.text(title, left, y + 4);
        y += 7;
        drawHead();
        if (rows.length === 0) {
          pdf.setFontSize(8.5);
          pdf.text("No records for this period.", left + 2, y + 4.8);
          y += 7;
        }
        rows.forEach((row, rowIndex) => {
          if (y + 6.5 > 285) { pdf.addPage(); y = 14; drawHead(); }
          if (rowIndex % 2 === 0) { pdf.setFillColor(245, 248, 252); pdf.rect(left, y, usable, 6.5, "F"); }
          pdf.setFontSize(8.5);
          let x = left;
          row.forEach((cell, index) => {
            const text = fit(cell, columnWidths[index]);
            if (index === 0) pdf.text(text, x + 2, y + 4.5);
            else pdf.text(text, x + columnWidths[index] - 2, y + 4.5, { align: "right" });
            x += columnWidths[index];
          });
          y += 6.5;
        });
        y += 6;
      };

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Collection Report", left, y);
      y += 6;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(`Period: ${data.from} to ${data.to}    Branch: ${branchLabel}    Collector: ${collectorLabel}`, left, y);
      y += 4.5;
      pdf.text(`Generated: ${new Date().toLocaleString("en-PH")} by ${user?.username ?? ""}`, left, y);
      y += 7;

      const s = data.summary;
      table("Summary", ["Metric", "Value"], [
        ["Total collected", pdfMoney(s.collected)],
        ["Payments", String(s.payments)],
        ["Members paid", String(s.membersPaid)],
        ["Loans paid", String(s.loansPaid)],
        ["Follow-up remarks", String(s.remarks)],
        ["Members followed up", String(s.membersFollowedUp)],
        ["Active loans (current)", `${s.activeLoans} / ${pdfMoney(s.activeBalance)}`],
        ["Overdue loans (current)", `${s.overdueLoans} / ${pdfMoney(s.overdueBalance)}`]
      ], [3, 2]);
      table("Members collected by PAR age", ["PAR age", "Collected", "Open", "Coverage", "Payments", "Amount"],
        data.byParAge.map(row => [row.label, String(row.membersCollected), String(row.openMembers),
          coverage(row.membersCollected, row.openMembers), String(row.payments), pdfMoney(row.amount)]), [2, 1.2, 1, 1.2, 1.2, 2]);
      if (isSuperAdmin) {
        table("Collections by branch", ["Branch", "Collected", "Payments", "Members"],
          data.byBranch.map(row => [row.branchName, pdfMoney(row.amount), String(row.payments), String(row.members)]), [3, 2, 1, 1]);
      }
      table("Collections by account", ["Account", "Role", "Collected", "Payments", "Members"],
        data.byCollector.map(row => [row.username, row.role, pdfMoney(row.amount), String(row.payments), String(row.members)]), [3, 1.5, 2, 1, 1]);
      table("Remarks by category", ["Category", "Remarks", "Members"],
        data.byCategory.map(row => [getRemarkCategoryLabel(row.category), String(row.remarks), String(row.members)]), [4, 1, 1]);
      table("Daily collections", ["Date", "Collected", "Payments"],
        data.byDay.map(row => [row.day, pdfMoney(row.amount), String(row.payments)]), [2, 2, 1]);

      if (isSuperAdmin && userReport) {
        const t = userReport.totals;
        table("User activity", ["Metric", "Value"], [
          ["Total users", String(t.users)],
          ...Object.entries(t.byRole).map(([role, count]) => [`  ${ROLE_LABELS[role] ?? role}`, String(count)]),
          ["Active users in period", String(t.activeUsers)],
          ["Logins", String(t.logins)],
          ["Visits", String(t.visits)],
          ["Screen time", duration(t.screenSeconds)]
        ], [3, 2]);
        table(`Top users by ${RANK_OPTIONS.find(option => option.value === rankBy)?.label.toLowerCase()}`,
          ["#  Account", "Branch", "Actions", "Collected", "Logins", "Visits", "Screen"],
          rankedUsers.map((row, index) => [`${index + 1}. ${row.username}`, row.branchName, String(row.actions), pdfMoney(row.collected),
            String(row.logins), String(row.visits), duration(row.screenSeconds)]), [2.4, 2, 1, 1.8, 0.9, 0.9, 1]);
      }

      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.setTextColor(110, 120, 135);
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth - left, 292, { align: "right" });
      }
      pdf.save(`collection-report-${data.from}-to-${data.to}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to export report.");
    } finally {
      setExporting(false);
    }
  }

  const s = data?.summary;
  const cards: [string, string | number, string?][] = s ? [
    ["Total collected", money(s.collected), `${s.payments} payments`],
    ["Members paid", s.membersPaid, `${s.loansPaid} loans`],
    ["Follow-up remarks", s.remarks, `${s.membersFollowedUp} members`],
    ["Overdue loans", s.overdueLoans, `${money(s.overdueBalance)} balance`]
  ] : [];

  return <main className="page-shell">
    <PageHeader title="Reports" eyebrow="Collection Performance"
      actions={<button className="btn-muted" onClick={() => setRefresh(value => value + 1)}>Refresh</button>} />

    <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
      <label className="grid min-w-0 gap-1 text-sm lg:min-w-40">From
        <input type="date" className="field min-w-0 w-full" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} />
      </label>
      <label className="grid min-w-0 gap-1 text-sm lg:min-w-40">To
        <input type="date" className="field min-w-0 w-full" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} />
      </label>
      {isSuperAdmin && <label className="grid min-w-0 gap-1 text-sm lg:min-w-56">Branch
        <select className="field" value={branchId} onChange={event => setBranchId(event.target.value)}>
          <option value="">All branches</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
        </select>
      </label>}
      <label className="grid min-w-0 gap-1 text-sm lg:min-w-56">Collector
        <select className="field" value={collectorId} onChange={event => setCollectorId(event.target.value)}>
          <option value="">All collectors</option>
          {collectorOptions.map(account => <option key={account.id} value={account.id}>{account.username} ({ROLE_LABELS[account.role] ?? account.role})</option>)}
        </select>
      </label>
      <button type="button" className="btn-primary w-full sm:col-span-2 lg:ml-auto lg:w-auto" disabled={!data || exporting} onClick={() => setExportChoiceOpen(true)}>
        {exporting ? "Exporting..." : "Export"}
      </button>
      {from > to && <p className="text-sm text-red-700 sm:col-span-2" role="alert">Select a valid date range.</p>}
    </section>

    <ExportChoiceDialog open={exportChoiceOpen} title="Export report"
      description={`${from} to ${to} · uses your current filters`}
      onExcel={() => void exportExcel()} onPdf={() => void exportPdf()} onClose={() => setExportChoiceOpen(false)} />

    {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}

    <div aria-busy={loading} className="grid gap-4">
      {loading && !data ? <p className="panel p-4" role="status">Loading reports...</p> : data && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {cards.map(([label, value, note]) => <section className="panel p-4" key={label}>
            <p className="text-sm text-slate-600">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
          </section>)}
        </div>

        <ReportTable title="Members collected by PAR age"
          headers={["PAR age", "Members collected", "Members with open loans", "Coverage", "Payments", "Collected"]}
          rows={data.byParAge.map(row => [row.label, row.membersCollected, row.openMembers,
            coverage(row.membersCollected, row.openMembers), row.payments, money(row.amount)])}
          empty="No loans to group." />

        <div className="grid gap-4 xl:grid-cols-2">
          {isSuperAdmin && <ReportTable title="Collections by branch" headers={["Branch", "Collected", "Payments", "Members"]}
            rows={data.byBranch.map(row => [row.branchName, money(row.amount), row.payments, row.members])}
            empty="No collections in this period." />}
          <ReportTable title="Collections by account" headers={["Account", "Collected", "Payments", "Members"]}
            rows={data.byCollector.map(row => [row.role ? `${row.username} (${row.role})` : row.username, money(row.amount), row.payments, row.members])}
            empty="No collections in this period." />
          <ReportTable title="Remarks by category" headers={["Category", "Remarks", "Members"]}
            rows={data.byCategory.map(row => [getRemarkCategoryLabel(row.category), row.remarks, row.members])}
            empty="No remarks in this period." />
          <ReportTable title="Daily collections" headers={["Date", "Collected", "Payments"]}
            rows={data.byDay.map(row => [row.day, money(row.amount), row.payments])}
            empty="No collections in this period." />
        </div>
        {isSuperAdmin && userReport && <section className="panel p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">User activity</h2>
              <p className="text-xs text-slate-500">Visible to super admins only. Logins, visits and screen time are counted from when tracking was enabled.</p>
            </div>
            <label className="grid gap-1 text-sm">Rank top users by
              <select className="field" value={rankBy} onChange={event => setRankBy(event.target.value as RankBy)}>
                {RANK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {([
              ["Total users", userReport.totals.users, Object.entries(userReport.totals.byRole).map(([role, count]) => `${count} ${ROLE_LABELS[role] ?? role}`).join(" · ")],
              ["Active users", userReport.totals.activeUsers, "in this period"],
              ["Logins", userReport.totals.logins, ""],
              ["Visits", userReport.totals.visits, "pages opened"],
              ["Screen time", duration(userReport.totals.screenSeconds), "all users"]
            ] as [string, string | number, string][]).map(([label, value, note]) => <div className="surface-soft p-3" key={label}>
              <p className="text-xs text-slate-600">{label}</p>
              <p className="mt-1 text-xl font-bold">{value}</p>
              {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
            </div>)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-left">#</th>
                  <th className="px-3 py-3 text-left">Account</th>
                  <th className="px-3 py-3 text-left">Branch</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                  <th className="px-3 py-3 text-right">Collected</th>
                  <th className="px-3 py-3 text-right">Logins</th>
                  <th className="px-3 py-3 text-right">Visits</th>
                  <th className="px-3 py-3 text-right">Screen time</th>
                  <th className="px-3 py-3 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(showAllUsers ? rankedUsers : rankedUsers.slice(0, TOP_USERS_LIMIT)).map((row, index) => <tr key={row.id} className="border-t border-slate-200 bg-white">
                  <td className="px-3 py-2.5 font-semibold text-slate-500">{index + 1}</td>
                  <td className="px-3 py-2.5"><span className="font-semibold text-slate-900">{row.username}</span><small className="block text-slate-500">{ROLE_LABELS[row.role] ?? row.role}</small></td>
                  <td className="px-3 py-2.5">{row.branchName}</td>
                  <td className="px-3 py-2.5 text-right" title={`${row.payments} payments, ${row.remarks} remarks`}>{row.actions}</td>
                  <td className="px-3 py-2.5 text-right">{money(row.collected)}</td>
                  <td className="px-3 py-2.5 text-right">{row.logins}</td>
                  <td className="px-3 py-2.5 text-right">{row.visits}</td>
                  <td className="px-3 py-2.5 text-right">{duration(row.screenSeconds)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{lastSeen(row.lastSeenAt)}</td>
                </tr>)}
                {rankedUsers.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-slate-500">No users in this branch.</td></tr>}
              </tbody>
            </table>
          </div>
          {rankedUsers.length > TOP_USERS_LIMIT && <button type="button" className="btn-muted mt-3" onClick={() => setShowAllUsers(value => !value)}>
            {showAllUsers ? `Show top ${TOP_USERS_LIMIT} only` : `Show all ${rankedUsers.length} users`}
          </button>}
        </section>}

        <p className="text-xs text-slate-500">Overdue figures, PAR age groups and open loans reflect current loan data; collections and remarks cover {data.from} to {data.to}. A member with loans in more than one PAR age group is counted in each.</p>
      </>}
    </div>
  </main>;
}
