import { Eye, EyeOff, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";
import type { Branch, Role } from "../types/models";

type ManagedRole = Exclude<Role, "super_admin">;

interface AccountRow {
  id: number;
  username: string;
  role: ManagedRole;
  branchId?: number | null;
  branchName?: string | null;
}

interface AccountForm {
  username: string;
  password: string;
  branchId: number;
  role: ManagedRole;
}

interface AccountEditForm {
  branchId: number;
  password: string;
}

const EMPTY_FORM: AccountForm = {
  username: "",
  password: "",
  branchId: 0,
  role: "staff"
};

const EMPTY_EDIT_FORM: AccountEditForm = {
  branchId: 0,
  password: ""
};

function computeRowsPerPage(viewportHeight: number): number {
  const reservedHeight = 430;
  const rowHeight = 42;
  const rawRows = Math.floor((viewportHeight - reservedHeight) / rowHeight);
  return Math.max(8, Math.min(22, rawRows));
}

function formatRoleLabel(role: ManagedRole): string {
  return role === "branch_admin" ? "Branch Admin" : "Collector";
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
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-600">
        Showing {startItem}-{endItem} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-muted btn-page"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <p className="text-xs font-semibold text-slate-700">
          Page {currentPage} of {totalPages}
        </p>
        <button
          type="button"
          className="btn-muted btn-page"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function AccountField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <p className="mobile-record-value">{value}</p>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  required = false,
  minLength,
  showToggle,
  visible,
  onToggle
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  showToggle: boolean;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <input
        className={`field ${showToggle ? "pr-11" : ""}`}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        minLength={minLength}
        placeholder={placeholder}
        required={required}
      />
      {showToggle && (
        <button
          type="button"
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-700"
          onClick={onToggle}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
}

export function StaffPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const isBranchAdmin = user?.role === "branch_admin";
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [editForm, setEditForm] = useState<AccountEditForm>(EMPTY_EDIT_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accountPendingDelete, setAccountPendingDelete] = useState<AccountRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    typeof window === "undefined" ? 13 : computeRowsPerPage(window.innerHeight)
  );

  async function loadData() {
    const [accountData, branchData] = await Promise.all([apiRequest<AccountRow[]>("/staff"), apiRequest<Branch[]>("/branches")]);
    setAccounts(accountData);
    setBranches(branchData);
    if (isSuperAdmin && branchData.length > 0 && form.branchId === 0) {
      setForm((current) => ({ ...current, branchId: branchData[0].id }));
    }
    if (isBranchAdmin && user?.branchId) {
      setForm((current) => ({ ...current, branchId: user.branchId as number }));
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleResize() {
      setRowsPerPage(computeRowsPerPage(window.innerHeight));
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? accounts.filter((row) =>
          [row.username, row.role, formatRoleLabel(row.role), row.branchName ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : accounts;

    return [...matches].sort(
      (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }) || formatRoleLabel(a.role).localeCompare(formatRoleLabel(b.role), undefined, { sensitivity: "base" })
    );
  }, [accounts, query]);

  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / rowsPerPage));

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedAccounts = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredAccounts.slice(start, start + rowsPerPage);
  }, [filteredAccounts, page, rowsPerPage]);

  function openCreateModal() {
    setError("");
    setMessage("");
    setEditingAccount(null);
    setEditForm(EMPTY_EDIT_FORM);
    setShowCreatePassword(false);
    setShowEditPassword(false);
    setForm({
      ...EMPTY_FORM,
      branchId: isSuperAdmin
        ? (form.branchId || branches[0]?.id || 0)
        : ((user?.branchId as number) ?? 0),
      role: "staff"
    });
    setIsModalOpen(true);
  }

  function openEditModal(account: AccountRow) {
    setError("");
    setMessage("");
    setEditingAccount(account);
    setShowCreatePassword(false);
    setShowEditPassword(false);
    setEditForm({
      branchId: account.branchId ?? branches[0]?.id ?? 0,
      password: ""
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setEditingAccount(null);
    setEditForm(EMPTY_EDIT_FORM);
    setForm(EMPTY_FORM);
    setShowCreatePassword(false);
    setShowEditPassword(false);
    setIsModalOpen(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      if (editingAccount) {
        const payload: { branchId: number; password?: string } = {
          branchId: editForm.branchId
        };
        if (editForm.password.trim()) {
          payload.password = editForm.password;
        }

        await apiRequest(`/staff/${editingAccount.id}`, "PATCH", payload);
        setMessage(`Updated account: ${editingAccount.username}`);
      } else {
        await apiRequest("/staff", "POST", {
          username: form.username.trim(),
          password: form.password,
          branchId: isSuperAdmin ? form.branchId : user?.branchId,
          role: isSuperAdmin ? form.role : "staff"
        });
        setMessage(`${formatRoleLabel(isSuperAdmin ? form.role : "staff")} account created.`);
      }

      closeModal();
      await loadData();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : editingAccount
            ? "Unable to update account"
            : "Unable to create account"
      );
    }
  }

  function handleDeleteAccount(row: AccountRow) {
    setAccountPendingDelete(row);
  }

  async function handleConfirmDeleteAccount() {
    if (!accountPendingDelete) return;
    const row = accountPendingDelete;
    setError("");
    setMessage("");
    setIsDeletePending(true);

    try {
      await apiRequest(`/staff/${row.id}`, "DELETE");
      setMessage(`Deleted account: ${row.username}`);
      await loadData();
      setAccountPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete account");
    } finally {
      setIsDeletePending(false);
    }
  }

  const modalTitle = editingAccount
    ? `Edit ${formatRoleLabel(editingAccount.role)}`
    : `Create ${formatRoleLabel(isSuperAdmin ? form.role : "staff")}`;

  const modal =
    isModalOpen &&
    createPortal(
      <section className="modal-shell">
        <div className="modal-card max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">{modalTitle}</h3>
            <button type="button" className="btn-muted" onClick={closeModal}>
              Close
            </button>
          </div>

          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
            {editingAccount ? (
              <>
                <div className="grid gap-1 text-sm font-medium text-black/80">
                  <span>Username</span>
                  <div className="field flex items-center bg-slate-50 text-slate-700">{editingAccount.username}</div>
                </div>
                <div className="grid gap-1 text-sm font-medium text-black/80">
                  <span>Role</span>
                  <div className="field flex items-center bg-slate-50 text-slate-700">{formatRoleLabel(editingAccount.role)}</div>
                </div>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Branch
                  <select
                    className="field"
                    value={editForm.branchId}
                    onChange={(event) => setEditForm((current) => ({ ...current, branchId: Number(event.target.value) }))}
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
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  New Password
                  <PasswordInput
                    value={editForm.password}
                    onChange={(value) => setEditForm((current) => ({ ...current, password: value }))}
                    minLength={8}
                    placeholder="Leave blank to keep current password"
                    showToggle={isSuperAdmin}
                    visible={showEditPassword}
                    onToggle={() => setShowEditPassword((current) => !current)}
                  />
                </label>
                <p className="md:col-span-2 text-xs text-black/65">
                  Super admin can move this account to another branch and optionally set a new password.
                </p>
              </>
            ) : (
              <>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Username
                  <input
                    className="field"
                    value={form.username}
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Password
                  <PasswordInput
                    value={form.password}
                    onChange={(value) => setForm((current) => ({ ...current, password: value }))}
                    minLength={8}
                    required
                    showToggle={isSuperAdmin}
                    visible={showCreatePassword}
                    onToggle={() => setShowCreatePassword((current) => !current)}
                  />
                </label>
                {isSuperAdmin && (
                  <label className="grid gap-1 text-sm font-medium text-black/80">
                    Role
                    <select
                      className="field"
                      value={form.role}
                      onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as ManagedRole }))}
                    >
                      <option value="staff">Collector</option>
                      <option value="branch_admin">Branch Admin</option>
                    </select>
                  </label>
                )}
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Branch
                  <select
                    className="field"
                    value={form.branchId}
                    onChange={(event) => setForm((current) => ({ ...current, branchId: Number(event.target.value) }))}
                    disabled={!isSuperAdmin}
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
                {isBranchAdmin && (
                  <p className="md:col-span-2 text-xs text-black/65">
                    Branch admin can create collector accounts for their own branch only.
                  </p>
                )}
              </>
            )}
            <div className="md:col-span-2">
              <button type="submit" className="btn-primary">
                {editingAccount ? "Save Changes" : `Add ${formatRoleLabel(isSuperAdmin ? form.role : "staff")}`}
              </button>
            </div>
          </form>
        </div>
      </section>,
      document.body
    );

  return (
    <main className="page-shell">
      {modal}
      <ConfirmDialog
        open={Boolean(accountPendingDelete)}
        tone="danger"
        title="Delete this account?"
        description={
          accountPendingDelete
            ? `${accountPendingDelete.username} will lose access immediately. This action cannot be undone.`
            : ""
        }
        confirmLabel={isDeletePending ? "Deleting..." : "Delete Account"}
        cancelLabel="Cancel"
        disabled={isDeletePending}
        onCancel={() => {
          if (!isDeletePending) {
            setAccountPendingDelete(null);
          }
        }}
        onConfirm={() => void handleConfirmDeleteAccount()}
      />

      <PageHeader
        title="Accounts"
        subtitle={
          isSuperAdmin
            ? "Manage collectors and branch admins, including branch assignment and password changes."
            : "Create collector accounts for your branch."
        }
        eyebrow="Workforce Access"
        actions={<PageMetaStamp />}
      />

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">{isSuperAdmin ? "User Accounts" : "Collector Accounts"}</h2>
            <p className="text-xs text-slate-600">
              {isSuperAdmin
                ? "Super admin can add branch admins, edit collector passwords, and manage branch assignment."
                : "Create and review collectors assigned to your branch."}
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateModal}>
            {isSuperAdmin ? "Add Account" : "Add Collector"}
          </button>
        </div>

        <div className="relative w-full max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="field pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search username, role, branch"
          />
        </div>

        {message && <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mobile-record-list mt-3 md:hidden">
          {paginatedAccounts.map((row) => (
            <article key={row.id} className="mobile-record-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">{row.username}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatRoleLabel(row.role)}</p>
                </div>
              </div>

              <div className="mobile-record-grid">
                <AccountField label="Role" value={formatRoleLabel(row.role)} />
                <AccountField label="Branch" value={row.branchName ?? "-"} />
              </div>

              {isSuperAdmin && (
                <div className="mobile-action-row">
                  <button type="button" className="btn-muted btn-page w-full sm:w-auto" onClick={() => openEditModal(row)}>
                    Edit
                  </button>
                  <button type="button" className="btn-danger btn-page w-full sm:w-auto" onClick={() => handleDeleteAccount(row)}>
                    Delete
                  </button>
                </div>
              )}
            </article>
          ))}
          {filteredAccounts.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">
              {isSuperAdmin ? "No accounts yet." : "No collector accounts yet."}
            </p>
          )}
        </div>

        <div className="table-shell mt-3 hidden md:block">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Branch</th>
                {isSuperAdmin && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedAccounts.map((row) => (
                <tr key={row.id}>
                  <td>{row.username}</td>
                  <td>{formatRoleLabel(row.role)}</td>
                  <td>{row.branchName ?? "-"}</td>
                  {isSuperAdmin && (
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-muted btn-table" onClick={() => openEditModal(row)}>
                          Edit
                        </button>
                        <button type="button" className="btn-danger btn-table" onClick={() => handleDeleteAccount(row)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filteredAccounts.length === 0 && (
            <p className="p-3 text-sm text-slate-600">{isSuperAdmin ? "No accounts yet." : "No collector accounts yet."}</p>
          )}
        </div>
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalItems={filteredAccounts.length}
          pageSize={rowsPerPage}
          onPageChange={setPage}
        />
      </section>
    </main>
  );
}
