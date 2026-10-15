import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PaginationControls } from "../../components/PaginationControls";
import { ToastNotification } from "../../components/ToastNotification";
import { actionStatusClass, getRemarkCategoryLabel } from "../../constants/remarkCategories";
import { useAuth } from "../../context/AuthContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { apiRequest } from "../../services/api";
import type { Branch } from "../../types/models";
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
  const ownBranchFilter = isSuperAdmin && fixedBranchId === undefined;
  const [query, setQuery] = useState("");
  const [ownBranchId, setBranchId] = useState(0);
  const branchId = fixedBranchId ?? ownBranchId;
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

  useEffect(() => { setPage(1); }, [search, branchId]);

  useEffect(() => {
    const request = ++requestRef.current;
    const params = new URLSearchParams({ settled: "true", page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set("search", search);
    if (isSuperAdmin && branchId > 0) params.set("branchId", String(branchId));
    setLoading(true);
    apiRequest<LoanListPage>(`/loans?${params}`)
      .then(result => {
        if (request !== requestRef.current) return;
        setData({ items: result.items, total: result.total });
        if (result.page !== page) setPage(result.page);
      })
      .catch(e => { if (request === requestRef.current) setError(e instanceof Error ? e.message : "Unable to load settled accounts"); })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
  }, [page, search, branchId, isSuperAdmin]);

  const total = data?.total ?? 0;
  const open = (loan: LoanRow) => navigate(`/loan-details/${loan.id}?from=settled`);
  const fieldStatus = (loan: LoanRow) => loan.actionStatus
    ? <span className={actionStatusClass(loan.actionStatus)}>{getRemarkCategoryLabel(loan.actionStatus)}</span>
    : <span className="text-xs text-slate-400">No action</span>;

  return (
    <>
      {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}
      <div className="grid gap-3">
        <p className="text-sm text-slate-600">
          Loans that were not in their branch's latest uploaded list. They keep their payments and remarks, and move back to Collections if they appear in a later upload.
        </p>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="field pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search member, code or loan account" aria-label="Search settled accounts" />
          </div>
          {ownBranchFilter && <select className="field sm:w-56" value={branchId} onChange={event => setBranchId(Number(event.target.value))} aria-label="Filter by branch">
            <option value={0}>All branches</option>
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
          </select>}
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
                <th>Field Status</th>
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
