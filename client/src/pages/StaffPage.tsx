import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";
import type { Branch, Role } from "../types/models";

interface StaffRow {
  id: number;
  username: string;
  role: Role;
  branchId?: number | null;
  branchName?: string | null;
}

interface StaffForm {
  username: string;
  password: string;
  branchId: number;
}

interface StaffEditForm {
  branchId: number;
}

const EMPTY_FORM: StaffForm = {
  username: "",
  password: "",
  branchId: 0
};

function computeRowsPerPage(viewportHeight: number): number {
  const reservedHeight = 430;
  const rowHeight = 42;
  const rawRows = Math.floor((viewportHeight - reservedHeight) / rowHeight);
  return Math.max(8, Math.min(22, rawRows));
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

export function StaffPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const isBranchAdmin = user?.role === "branch_admin";
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<StaffEditForm>({ branchId: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [staffPendingDelete, setStaffPendingDelete] = useState<StaffRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    typeof window === "undefined" ? 13 : computeRowsPerPage(window.innerHeight)
  );

  async function loadData() {
    const [staffData, branchData] = await Promise.all([apiRequest<StaffRow[]>("/staff"), apiRequest<Branch[]>("/branches")]);
    setStaff(staffData);
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

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((row) =>
      [row.username, row.role, row.branchName ?? ""].join(" ").toLowerCase().includes(q)
    );
  }, [query, staff]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / rowsPerPage));

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedStaff = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredStaff.slice(start, start + rowsPerPage);
  }, [filteredStaff, page, rowsPerPage]);

  function openCreateModal() {
    setError("");
    setMessage("");
    setForm((current) => ({
      ...EMPTY_FORM,
      branchId: isSuperAdmin
        ? (current.branchId || branches[0]?.id || 0)
        : ((user?.branchId as number) ?? 0)
    }));
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    setIsCreateOpen(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await apiRequest("/staff", "POST", {
        username: form.username.trim(),
        password: form.password,
        branchId: isSuperAdmin ? form.branchId : user?.branchId
      });
      setMessage("Staff account created.");
      setForm((current) => ({
        ...EMPTY_FORM,
        branchId: isSuperAdmin ? current.branchId : ((user?.branchId as number) ?? 0)
      }));
      setIsCreateOpen(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create staff account");
    }
  }

  function handleDeleteStaff(row: StaffRow) {
    setStaffPendingDelete(row);
  }

  async function handleConfirmDeleteStaff() {
    if (!staffPendingDelete) return;
    const row = staffPendingDelete;
    setError("");
    setMessage("");
    setIsDeletePending(true);
    try {
      await apiRequest(`/staff/${row.id}`, "DELETE");
      setMessage(`Deleted account: ${row.username}`);
      await loadData();
      setStaffPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete account");
    } finally {
      setIsDeletePending(false);
    }
  }

  function startEditStaff(row: StaffRow) {
    setEditingUserId(row.id);
    setEditForm({
      branchId: row.branchId ?? 0
    });
  }

  function cancelEditStaff() {
    setEditingUserId(null);
    setEditForm({ branchId: 0 });
  }

  async function handleUpdateStaff(row: StaffRow) {
    setError("");
    setMessage("");
    try {
      await apiRequest(`/staff/${row.id}`, "PATCH", {
        branchId: editForm.branchId
      });
      setMessage(`Updated account: ${row.username}`);
      cancelEditStaff();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update account");
    }
  }

  async function handleShowStaffCredentials(row: StaffRow) {
    setError("");
    setMessage("");
    try {
      const response = await apiRequest<{ username: string; password: string }>(`/staff/${row.id}/credentials`, "POST");
      setCredentials({
        username: response.username,
        password: response.password
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to fetch staff credentials");
    }
  }

  const createModal =
    isCreateOpen &&
    createPortal(
      <section className="modal-shell">
        <div className="modal-card max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Create Staff Account</h3>
            <button type="button" className="btn-muted" onClick={closeCreateModal}>
              Close
            </button>
          </div>

          <form className="grid gap-3 md:grid-cols-3" onSubmit={handleSubmit}>
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
              <input
                className="field"
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                minLength={8}
                required
              />
            </label>
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
            <div className="md:col-span-3">
              <button type="submit" className="btn-primary">
                Add Staff
              </button>
            </div>
          </form>
          {isBranchAdmin && <p className="mt-2 text-xs text-black/65">Branch admin can create staff for their own branch only.</p>}
        </div>
      </section>,
      document.body
    );

  const credentialsModal =
    credentials && (
      <section className="modal-shell" onClick={() => setCredentials(null)}>
        <div className="mx-auto mt-4 w-full max-w-md" onClick={(event) => event.stopPropagation()}>
          <section className="modal-card max-w-md p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Staff Credentials</h2>
              <button type="button" className="btn-muted" onClick={() => setCredentials(null)}>
                Close
              </button>
            </div>
            <p className="text-sm text-black/70">Username: <strong>{credentials.username}</strong></p>
            <p className="text-sm text-black/70">Password: <strong>{credentials.password}</strong></p>
            <p className="mt-2 text-xs text-black/60">This staff password stays the same unless changed in code/database.</p>
          </section>
        </div>
      </section>
    );

  return (
    <main className="page-shell">
      {createModal}
      {credentialsModal}
      <ConfirmDialog
        open={Boolean(staffPendingDelete)}
        tone="danger"
        title="Delete this staff account?"
        description={
          staffPendingDelete
            ? `${staffPendingDelete.username} will lose access immediately. This action cannot be undone.`
            : ""
        }
        confirmLabel={isDeletePending ? "Deleting..." : "Delete Account"}
        cancelLabel="Cancel"
        disabled={isDeletePending}
        onCancel={() => {
          if (!isDeletePending) {
            setStaffPendingDelete(null);
          }
        }}
        onConfirm={() => void handleConfirmDeleteStaff()}
      />

      <PageHeader
        title="Staff"
        subtitle="Provision staff accounts and manage branch assignment with role-based controls."
        eyebrow="Workforce Access"
        actions={<PageMetaStamp />}
      />

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Staff Accounts</h2>
            <p className="text-xs text-slate-600">Manage staff users and branch assignments.</p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateModal}>
            Add Staff
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

        <div className="table-shell mt-3">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Branch</th>
                {(isSuperAdmin || isBranchAdmin) && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedStaff.map((row) => (
                <tr key={row.id}>
                  <td>{row.username}</td>
                  <td>{row.role}</td>
                  <td>
                    {isSuperAdmin && editingUserId === row.id && row.role === "staff" ? (
                      <select
                        className="field"
                        value={editForm.branchId}
                        onChange={(event) => setEditForm((current) => ({ ...current, branchId: Number(event.target.value) }))}
                      >
                        <option value={0}>Select Branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.code} - {branch.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      row.branchName ?? "-"
                    )}
                  </td>
                  {(isSuperAdmin || isBranchAdmin) && (
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-muted btn-table" onClick={() => void handleShowStaffCredentials(row)} disabled={row.role !== "staff"}>
                          Show Login
                        </button>
                        {isSuperAdmin && (
                          <>
                            {editingUserId === row.id && row.role === "staff" ? (
                              <>
                                <button type="button" className="btn-primary btn-table" onClick={() => void handleUpdateStaff(row)}>
                                  Save
                                </button>
                                <button type="button" className="btn-muted btn-table" onClick={cancelEditStaff}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn-muted btn-table"
                                onClick={() => startEditStaff(row)}
                                disabled={row.role !== "staff"}
                              >
                                Edit
                              </button>
                            )}
                            <button type="button" className="btn-danger btn-table" onClick={() => void handleDeleteStaff(row)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filteredStaff.length === 0 && <p className="p-3 text-sm text-slate-600">No staff accounts yet.</p>}
        </div>
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalItems={filteredStaff.length}
          pageSize={rowsPerPage}
          onPageChange={setPage}
        />
      </section>
    </main>
  );
}
