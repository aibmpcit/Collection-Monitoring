import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExportButton } from "../../components/ExportButton";
import { applyFilters, FilterButton, type FilterValues } from "../../components/FilterButton";
import { describeFilters, fetchAllPages, type TableExport } from "../../services/tableExport";
import { SETTLED_EXPORT_COLUMNS } from "./exportColumns";
import { PaginationControls } from "../../components/PaginationControls";
import { ToastNotification } from "../../components/ToastNotification";
import { actionStatusClass, paymentStatusLabel } from "../../constants/remarkCategories";
import { useAuth } from "../../context/AuthContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { apiRequest } from "../../services/api";
import type { Branch } from "../../types/models";
import { settledFilterFields } from "./filterFields";
import { formatCurrency, formatDateTime } from "./format";
import type { LoanListPage, LoanRow } from "./types";

const PAGE_SIZE = 15;

/**
 * Loans that dropped off their branch's uploaded list: the loan system no longer reports them as
 * overdue, so they are treated as settled. A loan that appears in a later upload reopens and
 * leaves this list.
 */
export function SettledAccountsPanel({ branchId: fixedBranchId }: {
  /** Branch chosen by the surrounding page (0 = all); when omitted, super admins get their own branch filter. */
  branchId?: number;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === "super_admin";
  // Collectors and LAS work from search alone; filters are for admins.
  const isFieldUser = user?.role === "staff" || user?.role === "las";
  const canExport = user?.role === "super_admin" || user?.role === "branch_admin";
  const ownBranchFilter = isSuperAdmin && fixedBranchId === undefined;
  const [query, setQuery] = useState("");
  // Filters from the Filters modal; branchId is among them only when this panel has its own branch filter.
  const [filters, setFilters] = useState<FilterValues>({});
  const [loanTypes, setLoanTypes] = useState<string[]>([]);
  const branchId = fixedBranchId ?? Number(filters.branchId || 0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: LoanRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const search = useDebouncedValue(query.trim(), 300);

  useEffect(() => {
    if (!ownBranchFilter) return;
    apiRequest<Branch[]>("/branches").then(setBranches).catch(() => undefined);
  }, [ownBranchFilter]);

  useEffect(() => { setPage(1); }, [search, branchId, filters]);

  function listParams() {
    const params = new URLSearchParams({ settled: "true" });
    if (search) params.set("search", search);
    applyFilters(params, { ...filters, branchId: "" });
    if (isSuperAdmin && branchId > 0) params.set("branchId", String(branchId));
    return params;
  }

  const filterFields = settledFilterFields(loanTypes, ownBranchFilter ? branches.map(branch => [String(branch.id), `${branch.code} - ${branch.name}`] as const) : null);

  async function prepareExport(): Promise<TableExport<LoanRow>> {
    const base = listParams();
    const rows = await fetchAllPages(path => apiRequest<LoanListPage>(path), (exportPage, pageSize) => {
      const params = new URLSearchParams(base);
      params.set("page", String(exportPage));
      params.set("pageSize", String(pageSize));
      return `/loans?${params}`;
    });
    return {
      title: "Settled Accounts", fileBase: "settled-accounts", columns: SETTLED_EXPORT_COLUMNS, rows,
      details: [`Filters: ${describeFilters(filterFields, filters, search)}`, `Settled accounts: ${rows.length}`]
    };
  }

  useEffect(() => {
    const request = ++requestRef.current;
    const params = listParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    setLoading(true);
    apiRequest<LoanListPage>(`/loans?${params}`)
      .then(result => {
        if (request !== requestRef.current) return;
        setData({ items: result.items, total: result.total });
        setLoanTypes(result.loanTypes ?? []);
        if (result.page !== page) setPage(result.page);
      })
      .catch(e => { if (request === requestRef.current) setError(e instanceof Error ? e.message : "Unable to load settled accounts"); })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
  }, [page, search, branchId, filters, isSuperAdmin]);

  const total = data?.total ?? 0;
  const open = (loan: LoanRow) => navigate(`/loan-details/${loan.id}?from=settled`);
  const fieldStatus = (loan: LoanRow) => loan.actionStatus
    ? <span className={actionStatusClass(loan.actionStatus)}>{paymentStatusLabel(loan.actionStatus)}</span>
    : <span className="text-xs text-slate-400">No payment</span>;

  return (
    <>
      {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}
      <div className="grid gap-3">
        <div className="flex w-full max-w-md items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="field pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search member, code or loan account" aria-label="Search settled accounts" />
          </div>
          {!isFieldUser && <FilterButton
            fields={filterFields}
            values={filters}
            onChange={change => setFilters(current => ({ ...current, ...change }))}
          />}
          {canExport && <ExportButton label="settled accounts" prepare={prepareExport} />}
        </div>
        <p className="text-sm text-slate-600" aria-live="polite">{loading ? "Loading..." : `${total} settled account(s)`}</p>

        <ul className="grid gap-2 lg:hidden" aria-label="Settled accounts">
          {(data?.items ?? []).map(loan => <li key={loan.id}>
            <button type="button" onClick={() => open(loan)} className="surface-soft block w-full p-3 text-left transition active:bg-white">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{loan.memberName}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{loan.loanAccountNo} · {loan.loanType}</span>
                </span>
                {fieldStatus(loan)}
              </span>
              <span className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                <span>Last balance {formatCurrency(loan.loanBalance)}</span>
                <span>Settled {loan.closedAt ? formatDateTime(loan.closedAt) : "-"}</span>
              </span>
            </button>
          </li>)}
          {!loading && total === 0 && <li className="py-8 text-center text-sm text-slate-500">No settled accounts yet.</li>}
        </ul>

        <div className="table-shell hidden w-full overflow-x-auto lg:block">
          <table className="table-clean w-full text-sm">
            <thead className="bg-c1">
              <tr>
                <th>Member</th>
                <th>Loan Account</th>
                <th>Loan Product</th>
                <th>Last Balance</th>
                <th>Last Total Due</th>
                <th>PAR Age</th>
                <th>Last Payment</th>
                <th>Settled On</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map(loan => <tr key={loan.id} className="cursor-pointer hover:bg-slate-50" tabIndex={0}
                onClick={() => open(loan)}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(loan); } }}>
                <td><span className="font-semibold text-slate-900">{loan.memberName}</span><small className="block text-slate-500">{loan.cifKey}</small></td>
                <td>{loan.loanAccountNo}</td>
                <td>{loan.loanType || "-"}</td>
                <td>{formatCurrency(loan.loanBalance)}</td>
                <td>{formatCurrency(loan.total)}</td>
                <td>{loan.parAge}</td>
                <td>{fieldStatus(loan)}</td>
                <td>{loan.closedAt ? formatDateTime(loan.closedAt) : "-"}</td>
              </tr>)}
            </tbody>
          </table>
          {!loading && total === 0 && <p className="p-3 text-sm text-slate-500">No settled accounts yet.</p>}
        </div>

        <PaginationControls currentPage={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </>
  );
}
