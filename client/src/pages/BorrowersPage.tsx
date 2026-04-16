import { Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BorrowerList } from "../components/BorrowerList";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DEFAULT_REMARK_CATEGORY, getRemarkCategoryLabel, REMARK_CATEGORIES, type RemarkCategory } from "../constants/remarkCategories";
import { PageHeader } from "../components/PageHeader";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";
import type { Borrower, BorrowerPayload, Branch } from "../types/models";

const EMPTY_FORM: BorrowerPayload = {
  cifKey: "",
  memberName: "",
  contactInfo: "",
  address: ""
};

interface MemberLoanHistoryRow {
  id: number;
  borrowerId: number;
  loanAccountNo: string;
  loanType: string;
  dateRelease: string;
  maturityDate: string;
  loanAmount: number;
  principalDue: number;
  penaltyDue: number;
  interest: number;
  otherCharges: number;
  status: "active" | "closed" | "overdue";
  notes?: string;
}

interface MemberPaymentHistoryRow {
  id: number;
  paymentId: string;
  loanId: number;
  loanAccountNo: string;
  amount: number;
  collectedBy: string;
  collectedAt: string;
}

interface MemberRemarkRow {
  id: number;
  borrowerId: number;
  remark: string;
  remarkCategory: string;
  createdAt: string;
  createdBy: string;
}

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let xlsxLoader: Promise<typeof import("xlsx")> | null = null;

function loadXlsx() {
  xlsxLoader ??= import("xlsx");
  return xlsxLoader;
}

function formatCurrency(value: number): string {
  return pesoFormatter.format(value || 0);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString();
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function MemberHistoryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <p className="mobile-record-value">{value}</p>
    </div>
  );
}

export function BorrowersPage() {
  const { user } = useAuth();
  const canManageMembers = user?.role === "super_admin" || user?.role === "branch_admin";
  const canImportMembers = canManageMembers;
  const canViewMemberHistory = true;
  const canViewMemberActions = canManageMembers;
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<BorrowerPayload>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [borrowerPendingDelete, setBorrowerPendingDelete] = useState<Borrower | null>(null);
  const [borrowersPendingBulkDelete, setBorrowersPendingBulkDelete] = useState<Borrower[]>([]);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [isBulkDeletePending, setIsBulkDeletePending] = useState(false);
  const [historyBorrower, setHistoryBorrower] = useState<Borrower | null>(null);
  const [historyLoans, setHistoryLoans] = useState<MemberLoanHistoryRow[]>([]);
  const [historyPayments, setHistoryPayments] = useState<MemberPaymentHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [remarksBorrower, setRemarksBorrower] = useState<Borrower | null>(null);
  const [memberRemarks, setMemberRemarks] = useState<MemberRemarkRow[]>([]);
  const [remarkInput, setRemarkInput] = useState("");
  const [remarkCategory, setRemarkCategory] = useState<RemarkCategory>(DEFAULT_REMARK_CATEGORY);
  const [remarksLoading, setRemarksLoading] = useState(false);
  const [remarksSubmitting, setRemarksSubmitting] = useState(false);
  const [remarksError, setRemarksError] = useState("");
  const [importBranchId, setImportBranchId] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState(0);

  async function loadBorrowers() {
    const data = await apiRequest<Borrower[]>("/borrowers");
    setBorrowers(data);
  }

  async function loadBranches() {
    const data = await apiRequest<Branch[]>("/branches");
    setBranches(data);
  }

  useEffect(() => {
    void loadBorrowers();
    if (canManageMembers) {
      void loadBranches();
    } else {
      setBranches([]);
    }
  }, [canManageMembers]);

  useEffect(() => {
    if (user?.role === "super_admin" && importBranchId === 0 && branches.length > 0) {
      setImportBranchId(branches[0].id);
    }
  }, [user?.role, branches, importBranchId]);

  const filteredBorrowers = useMemo(() => {
    if (user?.role !== "super_admin" || selectedBranchId <= 0) {
      return borrowers;
    }

    return borrowers.filter((borrower) => Number(borrower.branchId ?? 0) === selectedBranchId);
  }, [borrowers, selectedBranchId, user?.role]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");

    try {
      if (!canManageMembers) {
        setError("Only admins can manage members.");
        return;
      }

      if (editingId) {
        await apiRequest(`/borrowers/${editingId}`, "PATCH", form);
        setMessage("Member updated.");
      } else {
        await apiRequest("/borrowers", "POST", form);
        setMessage("Member added.");
      }

      setForm(EMPTY_FORM);
      setEditingId(null);
      setIsFormOpen(false);
      await loadBorrowers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save borrower");
    }
  }

  function handleDelete(borrower: Borrower) {
    setBorrowerPendingDelete(borrower);
  }

  async function handleConfirmDelete() {
    if (!borrowerPendingDelete) return;
    const borrower = borrowerPendingDelete;
    setMessage("");
    setError("");
    setIsDeletePending(true);
    try {
      await apiRequest(`/borrowers/${borrower.id}`, "DELETE");
      setMessage("Member deleted.");
      if (editingId === borrower.id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      await loadBorrowers();
      setBorrowerPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete borrower");
    } finally {
      setIsDeletePending(false);
    }
  }

  function handleDeleteSelectedBorrowers(selectedBorrowers: Borrower[]) {
    if (!canManageMembers || selectedBorrowers.length === 0) return;
    setBorrowersPendingBulkDelete(selectedBorrowers);
  }

  function formatBulkDeleteReason(reason: string): string {
    if (reason === "has_loan_history") return "has loan history, including closed loans hidden from the main loan list";
    if (reason === "forbidden") return "outside your branch";
    if (reason === "not_found") return "not found";
    return "delete failed";
  }

  async function handleConfirmBulkDelete() {
    if (borrowersPendingBulkDelete.length === 0) return;
    setMessage("");
    setError("");
    setIsBulkDeletePending(true);
    const ids = borrowersPendingBulkDelete.map((borrower) => borrower.id);
    const borrowerNameById = new Map(borrowersPendingBulkDelete.map((borrower) => [borrower.id, borrower.memberName]));

    try {
      const result = await apiRequest<{ deleted: number; skipped: Array<{ id: number; reason: string }> }>(
        "/borrowers/bulk",
        "DELETE",
        { ids }
      );
      if (editingId && ids.includes(editingId)) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      await loadBorrowers();
      setBorrowersPendingBulkDelete([]);
      setMessage(`Deleted ${result.deleted} member(s).`);

      if (result.skipped.length > 0) {
        const summary = result.skipped
          .slice(0, 3)
          .map((item) => `${borrowerNameById.get(item.id) ?? `#${item.id}`} (${formatBulkDeleteReason(item.reason)})`)
          .join(", ");
        const hidden = result.skipped.length > 3 ? ` and ${result.skipped.length - 3} more` : "";
        setError(`${result.skipped.length} member(s) were not deleted: ${summary}${hidden}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete selected members");
    } finally {
      setIsBulkDeletePending(false);
    }
  }

  function startEdit(borrower: Borrower) {
    if (!canManageMembers) {
      setError("Only admins can edit members.");
      return;
    }
    setEditingId(borrower.id);
    setForm({
      cifKey: borrower.cifKey,
      memberName: borrower.memberName,
      contactInfo: borrower.contactInfo,
      address: borrower.address
    });
    setIsFormOpen(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsFormOpen(false);
  }

  function openCreateForm() {
    if (!canManageMembers) return;
    const defaultBranchId = user?.role === "super_admin" && branches.length > 0 ? branches[0].id : 0;
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      ...(user?.role === "super_admin" && defaultBranchId > 0 ? { branchId: defaultBranchId } : {})
    });
    setIsFormOpen(true);
  }

  function openImportModal() {
    if (!canImportMembers) return;
    setMessage("");
    setError("");
    void loadXlsx();
    if (user?.role === "super_admin" && importBranchId === 0 && branches.length > 0) {
      setImportBranchId(branches[0].id);
    }
    setIsImportOpen(true);
  }

  function closeImportModal() {
    setIsImportOpen(false);
  }

  async function handleViewHistory(borrower: Borrower) {
    setHistoryBorrower(borrower);
    setHistoryLoans([]);
    setHistoryPayments([]);
    setHistoryError("");
    setHistoryLoading(true);

    try {
      const [allLoans, allPayments] = await Promise.all([
        apiRequest<MemberLoanHistoryRow[]>("/loans"),
        apiRequest<MemberPaymentHistoryRow[]>("/payments")
      ]);

      const memberLoans = allLoans
        .filter((loan) => loan.borrowerId === borrower.id)
        .sort((a, b) => new Date(b.dateRelease).getTime() - new Date(a.dateRelease).getTime());
      const loanIds = new Set(memberLoans.map((loan) => loan.id));
      const memberPayments = allPayments
        .filter((payment) => loanIds.has(payment.loanId))
        .sort((a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime());

      setHistoryLoans(memberLoans);
      setHistoryPayments(memberPayments);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Unable to load member history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistoryModal() {
    setHistoryBorrower(null);
    setHistoryLoans([]);
    setHistoryPayments([]);
    setHistoryError("");
    setHistoryLoading(false);
  }

  async function loadMemberRemarks(borrowerId: number) {
    setRemarksLoading(true);
    setRemarksError("");
    try {
      const data = await apiRequest<MemberRemarkRow[]>(`/borrowers/${borrowerId}/remarks`);
      setMemberRemarks(data);
    } catch (e) {
      setRemarksError(e instanceof Error ? e.message : "Unable to load member remarks");
    } finally {
      setRemarksLoading(false);
    }
  }

  async function handleOpenRemarks(borrower: Borrower) {
    setRemarksBorrower(borrower);
    setRemarkInput("");
    setRemarkCategory(DEFAULT_REMARK_CATEGORY);
    setMemberRemarks([]);
    setRemarksError("");
    await loadMemberRemarks(borrower.id);
  }

  function closeRemarksModal() {
    setRemarksBorrower(null);
    setRemarkInput("");
    setRemarkCategory(DEFAULT_REMARK_CATEGORY);
    setMemberRemarks([]);
    setRemarksError("");
    setRemarksLoading(false);
    setRemarksSubmitting(false);
  }

  async function handleAddRemark(event: React.FormEvent) {
    event.preventDefault();
    if (!remarksBorrower) return;
    const remark = remarkInput.trim();
    if (!remark) return;

    setRemarksSubmitting(true);
    setRemarksError("");
    try {
      await apiRequest(`/borrowers/${remarksBorrower.id}/remarks`, "POST", { remark, remarkCategory });
      setRemarkInput("");
      await loadMemberRemarks(remarksBorrower.id);
    } catch (e) {
      setRemarksError(e instanceof Error ? e.message : "Unable to add member remark");
    } finally {
      setRemarksSubmitting(false);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage("");
    setError("");
    setImportMessage("");

    try {
      if (user?.role === "super_admin" && importBranchId <= 0) {
        throw new Error("Select a branch for member import.");
      }

      const buffer = await file.arrayBuffer();
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const mappedRows: BorrowerPayload[] = rows
        .map((row) => {
          const normalized = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), String(value).trim()])
          );

          return {
            cifKey: normalized["cif key"] || normalized["cifkey"] || "",
            memberName: normalized["member name"] || normalized["membername"] || "",
            contactInfo: normalized["contact info"] || normalized["contactinfo"] || "",
            address: normalized["address"] || "",
            ...(user?.role === "super_admin" ? { branchId: importBranchId } : {})
          };
        })
        .filter((row) => row.cifKey && row.memberName && row.contactInfo && row.address && (user?.role !== "super_admin" || (row.branchId ?? 0) > 0));

      if (mappedRows.length === 0) {
        throw new Error("No valid member rows found in file");
      }

      const result = await apiRequest<{ inserted: number; updated: number }>("/borrowers/bulk", "POST", {
        rows: mappedRows
      });

      setImportMessage(`Imported members: ${result.inserted} new, ${result.updated} updated.`);
      setIsImportOpen(false);
      void loadBorrowers().catch((refreshError) => {
        setError(refreshError instanceof Error ? refreshError.message : "Import finished but member list refresh failed");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to import file");
    } finally {
      event.target.value = "";
    }
  }

  const totalPaid = historyPayments.reduce((sum, row) => sum + row.amount, 0);
  const totalOutstanding = historyLoans.reduce(
    (sum, row) => sum + row.principalDue + row.interest + row.penaltyDue + row.otherCharges,
    0
  );

  const memberFormModal = isFormOpen && canManageMembers
    ? createPortal(
        <section className="modal-shell">
          <div className="modal-card max-w-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">{editingId ? "Edit Member" : "Add Member"}</h3>
              <button type="button" className="btn-muted" onClick={closeForm}>
                Close
              </button>
            </div>

            <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
              <label className="grid gap-1 text-sm font-medium text-black/80">
                CIF Key
                <input className="field" value={form.cifKey} onChange={(event) => setForm((c) => ({ ...c, cifKey: event.target.value }))} placeholder="CIF Key" required minLength={2} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-black/80">
                Member Name
                <input className="field" value={form.memberName} onChange={(event) => setForm((c) => ({ ...c, memberName: event.target.value }))} placeholder="Member Name" required minLength={2} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-black/80">
                Contact Info
                <input className="field" value={form.contactInfo} onChange={(event) => setForm((c) => ({ ...c, contactInfo: event.target.value }))} placeholder="Contact Info" required minLength={7} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-black/80">
                Address
                <input className="field" value={form.address} onChange={(event) => setForm((c) => ({ ...c, address: event.target.value }))} placeholder="Address" required minLength={5} />
              </label>
              {user?.role === "super_admin" && (
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Branch
                  <select
                    className="field"
                    value={form.branchId ?? 0}
                    onChange={(event) => setForm((c) => ({ ...c, branchId: Number(event.target.value) }))}
                    required
                  >
                    <option value={0}>Select Branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.code} - {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="md:col-span-2 flex flex-wrap gap-2">
                <button type="submit" className="btn-primary">{editingId ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </section>,
        document.body
      )
    : null;

  const memberImportModal = isImportOpen && canImportMembers
    ? createPortal(
        <section className="modal-shell">
          <div className="modal-card max-w-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Import Members</h3>
              <button type="button" className="btn-muted" onClick={closeImportModal}>
                Close
              </button>
            </div>

            <div className="surface-soft flex flex-wrap items-center gap-2 border-dashed border-black/20 p-3">
              <Upload size={16} className="text-black/60" />
              {user?.role === "super_admin" && (
                <select
                  className="field w-56"
                  value={importBranchId}
                  onChange={(event) => setImportBranchId(Number(event.target.value))}
                  aria-label="Select branch for member import"
                >
                  <option value={0}>Select import branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} - {branch.name}
                    </option>
                  ))}
                </select>
              )}
              <input type="file" accept=".csv,.xls,.xlsx" onChange={handleFileUpload} className="text-sm" />
              <p className="text-xs text-black/60">CSV/Excel: CIF Key, Member Name, Contact Info, Address</p>
            </div>
          </div>
        </section>,
        document.body
      )
    : null;

  const memberHistoryModal = historyBorrower
    ? createPortal(
        <section className="modal-shell">
          <div className="modal-card max-w-6xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold">Member History</h3>
                <p className="text-xs text-black/70">
                  {historyBorrower.cifKey} | {historyBorrower.memberName}
                </p>
              </div>
              <button type="button" className="btn-muted" onClick={closeHistoryModal}>
                Close
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="surface-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Loan Records</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{historyLoans.length}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Payment Records</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{historyPayments.length}</p>
              </div>
              <div className="surface-soft col-span-2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Collections</p>
                <p className="mt-1 text-lg font-semibold text-emerald-700">{formatCurrency(totalPaid)}</p>
              </div>
            </div>

            {historyError && (
              <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {historyError}
              </p>
            )}

            {historyLoading ? (
              <p className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
                Loading member history...
              </p>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">Loan History</h4>
                    <span className="glass-pill">Outstanding {formatCurrency(totalOutstanding)}</span>
                  </div>
                  <div className="mobile-record-list md:hidden">
                    {historyLoans.map((loan) => (
                      <article key={loan.id} className="mobile-record-card">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-slate-900">{loan.loanAccountNo}</p>
                            <p className="mt-1 text-xs text-slate-500">{loan.loanType}</p>
                          </div>
                          <span className={`${loan.status === "overdue" ? "status-danger" : loan.status === "closed" ? "status-warning" : "status-success"}`}>
                            {loan.status}
                          </span>
                        </div>

                        <div className="mobile-record-grid">
                          <MemberHistoryField label="Released" value={formatDate(loan.dateRelease)} />
                          <MemberHistoryField label="Maturity" value={formatDate(loan.maturityDate)} />
                          <MemberHistoryField label="Amount" value={formatCurrency(loan.loanAmount)} />
                          <MemberHistoryField label="Principal Due" value={formatCurrency(loan.principalDue)} />
                          <MemberHistoryField label="Penalty Due" value={formatCurrency(loan.penaltyDue)} />
                          <MemberHistoryField label="Interest" value={formatCurrency(loan.interest)} />
                          <MemberHistoryField label="Other Charges" value={formatCurrency(loan.otherCharges)} />
                        </div>
                      </article>
                    ))}
                    {historyLoans.length === 0 && (
                      <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">
                        No loan history found for this member.
                      </p>
                    )}
                  </div>
                  <div className="table-shell hidden max-h-[48vh] overflow-auto md:block">
                    <table className="table-clean text-xs">
                      <thead>
                        <tr>
                          <th>Loan Account</th>
                          <th>Type</th>
                          <th>Released</th>
                          <th>Maturity</th>
                          <th>Amount</th>
                          <th>Principal Due</th>
                          <th>Penalty Due</th>
                          <th>Interest</th>
                          <th>Other Charges</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyLoans.map((loan) => (
                          <tr key={loan.id}>
                            <td>{loan.loanAccountNo}</td>
                            <td>{loan.loanType}</td>
                            <td>{formatDate(loan.dateRelease)}</td>
                            <td>{formatDate(loan.maturityDate)}</td>
                            <td>{formatCurrency(loan.loanAmount)}</td>
                            <td>{formatCurrency(loan.principalDue)}</td>
                            <td>{formatCurrency(loan.penaltyDue)}</td>
                            <td>{formatCurrency(loan.interest)}</td>
                            <td>{formatCurrency(loan.otherCharges)}</td>
                            <td>
                              <span className={`${loan.status === "overdue" ? "status-danger" : loan.status === "closed" ? "status-warning" : "status-success"}`}>
                                {loan.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {historyLoans.length === 0 && (
                          <tr>
                            <td colSpan={10} className="py-4 text-sm text-slate-600">
                              No loan history found for this member.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">Payment History</h4>
                    <span className="glass-pill">{historyPayments.length} payment(s)</span>
                  </div>
                  <div className="mobile-record-list md:hidden">
                    {historyPayments.map((payment) => (
                      <article key={payment.id} className="mobile-record-card">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-slate-900">{payment.paymentId}</p>
                            <p className="mt-1 text-xs text-slate-500">{payment.loanAccountNo}</p>
                          </div>
                          <p className="text-sm font-semibold text-emerald-700">{formatCurrency(payment.amount)}</p>
                        </div>

                        <div className="mobile-record-grid">
                          <MemberHistoryField label="Collected By" value={payment.collectedBy || "System"} />
                          <MemberHistoryField label="Collected At" value={formatDateTime(payment.collectedAt)} />
                        </div>
                      </article>
                    ))}
                    {historyPayments.length === 0 && (
                      <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">
                        No payment history found for this member.
                      </p>
                    )}
                  </div>
                  <div className="table-shell hidden max-h-[48vh] overflow-auto md:block">
                    <table className="table-clean text-xs">
                      <thead>
                        <tr>
                          <th>Payment ID</th>
                          <th>Loan Account</th>
                          <th>Amount</th>
                          <th>Collected By</th>
                          <th>Collected At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyPayments.map((payment) => (
                          <tr key={payment.id}>
                            <td>{payment.paymentId}</td>
                            <td>{payment.loanAccountNo}</td>
                            <td>{formatCurrency(payment.amount)}</td>
                            <td>{payment.collectedBy || "System"}</td>
                            <td>{formatDateTime(payment.collectedAt)}</td>
                          </tr>
                        ))}
                        {historyPayments.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-4 text-sm text-slate-600">
                              No payment history found for this member.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>,
        document.body
      )
    : null;

  const memberRemarksModal = remarksBorrower
    ? createPortal(
        <section className="modal-shell">
          <div className="modal-card max-w-3xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold">Member Remarks</h3>
                <p className="text-xs text-black/70">
                  {remarksBorrower.cifKey} | {remarksBorrower.memberName}
                </p>
              </div>
              <button type="button" className="btn-muted" onClick={closeRemarksModal}>
                Close
              </button>
            </div>

            <form className="mb-3 grid gap-2" onSubmit={handleAddRemark}>
              <label className="grid gap-1 text-sm font-medium text-black/80">
                Category
                <select
                  className="field"
                  value={remarkCategory}
                  onChange={(event) => setRemarkCategory(event.target.value as RemarkCategory)}
                  required
                >
                  {REMARK_CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className="field"
                value={remarkInput}
                onChange={(event) => setRemarkInput(event.target.value)}
                placeholder="Add a member remark..."
                rows={3}
                required
              />
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={remarksSubmitting}>
                  {remarksSubmitting ? "Saving..." : "Add Remark"}
                </button>
              </div>
            </form>

            {remarksError && <p className="mb-2 text-sm text-red-700">{remarksError}</p>}
            {remarksLoading && <p className="text-sm text-black/70">Loading remarks...</p>}

            <div className="surface-soft max-h-[50vh] overflow-y-auto">
              {memberRemarks.length === 0 && !remarksLoading ? (
                <p className="p-3 text-sm text-black/60">No remarks yet.</p>
              ) : (
                <ul className="divide-y divide-black/10">
                  {memberRemarks.map((item) => (
                    <li key={item.id} className="p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {getRemarkCategoryLabel(item.remarkCategory)}
                      </p>
                      <p className="text-sm">{item.remark}</p>
                      <p className="mt-1 text-xs text-black/60">
                        {formatDateTime(item.createdAt)} | By: {item.createdBy}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>,
        document.body
      )
    : null;

  return (
    <main className="page-shell">
      {memberFormModal}
      {memberImportModal}
      {memberHistoryModal}
      {memberRemarksModal}
      <ConfirmDialog
        open={Boolean(borrowerPendingDelete)}
        tone="danger"
        title="Delete this member?"
        description={
          borrowerPendingDelete
            ? `This removes ${borrowerPendingDelete.memberName} from your member list. This action cannot be undone.`
            : ""
        }
        confirmLabel={isDeletePending ? "Deleting..." : "Delete Member"}
        cancelLabel="Cancel"
        disabled={isDeletePending}
        onCancel={() => {
          if (!isDeletePending) {
            setBorrowerPendingDelete(null);
          }
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
      <ConfirmDialog
        open={borrowersPendingBulkDelete.length > 0}
        tone="danger"
        title="Delete selected members?"
        description={
          borrowersPendingBulkDelete.length > 0
            ? `${borrowersPendingBulkDelete.length} selected member record(s) will be removed permanently. Members with any loan history, including closed loans hidden from the main loan list, will be skipped.`
            : ""
        }
        confirmLabel={isBulkDeletePending ? "Deleting..." : "Delete Selected Members"}
        cancelLabel="Cancel"
        disabled={isBulkDeletePending}
        onCancel={() => {
          if (!isBulkDeletePending) {
            setBorrowersPendingBulkDelete([]);
          }
        }}
        onConfirm={() => void handleConfirmBulkDelete()}
      />

      <PageHeader
        title="Members"
        subtitle={canManageMembers ? "Create, import, and maintain member records with branch-level access controls." : "View member records linked to your branch."}
        eyebrow="Member Registry"
        actions={<PageMetaStamp />}
      />

      {importMessage && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{importMessage}</p>}
      {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {user?.role === "super_admin" && (
        <section className="panel p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium text-black/80 sm:max-w-xs">
              Branch Filter
              <select
                className="field"
                value={selectedBranchId}
                onChange={(event) => setSelectedBranchId(Number(event.target.value))}
                aria-label="Filter members by branch"
              >
                <option value={0}>All Branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} - {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-600">{filteredBorrowers.length} member(s) in view</p>
          </div>
        </section>
      )}

      <BorrowerList
        borrowers={filteredBorrowers}
        onEdit={startEdit}
        onDelete={handleDelete}
        onHistory={handleViewHistory}
        onRemarks={handleOpenRemarks}
        onDeleteSelected={handleDeleteSelectedBorrowers}
        onImport={openImportModal}
        onAdd={openCreateForm}
        canImport={canImportMembers}
        canAdd={canManageMembers}
        canEditDelete={canManageMembers}
        canViewHistory={canViewMemberHistory}
        canViewRemarks={canViewMemberActions}
      />
    </main>
  );
}
