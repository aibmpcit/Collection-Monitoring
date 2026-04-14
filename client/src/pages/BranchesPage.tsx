import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../services/api";
import type { Branch } from "../types/models";

interface BranchForm {
  code: string;
  name: string;
  address: string;
}

const EMPTY_FORM: BranchForm = {
  code: "",
  name: "",
  address: ""
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

function BranchField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <p className="mobile-record-value">{value}</p>
    </div>
  );
}

export function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [branchPendingDelete, setBranchPendingDelete] = useState<Branch | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    typeof window === "undefined" ? 13 : computeRowsPerPage(window.innerHeight)
  );

  async function loadBranches() {
    const data = await apiRequest<Branch[]>("/branches");
    setBranches(data);
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  useEffect(() => {
    function handleResize() {
      setRowsPerPage(computeRowsPerPage(window.innerHeight));
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const filteredBranches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((branch) =>
      [branch.code, branch.name, branch.address, String(branch.branchAdminCount ?? 0)]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [branches, query]);

  const totalPages = Math.max(1, Math.ceil(filteredBranches.length / rowsPerPage));

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedBranches = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredBranches.slice(start, start + rowsPerPage);
  }, [filteredBranches, page, rowsPerPage]);

  function openCreateModal() {
    setError("");
    setMessage("");
    setEditingBranch(null);
    setForm(EMPTY_FORM);
    setIsCreateOpen(true);
  }

  function openEditModal(branch: Branch) {
    setError("");
    setMessage("");
    setEditingBranch(branch);
    setForm({
      code: branch.code,
      name: branch.name,
      address: branch.address
    });
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    setEditingBranch(null);
    setForm(EMPTY_FORM);
    setIsCreateOpen(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      if (editingBranch) {
        await apiRequest(`/branches/${editingBranch.id}`, "PATCH", {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          address: form.address.trim()
        });
        setMessage(`Branch updated: ${form.name.trim()}`);
      } else {
        await apiRequest("/branches", "POST", {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          address: form.address.trim()
        });
        setMessage("Branch created. Add branch admin accounts from the Accounts page.");
      }
      setEditingBranch(null);
      setForm(EMPTY_FORM);
      setIsCreateOpen(false);
      await loadBranches();
    } catch (e) {
      setError(e instanceof Error ? e.message : editingBranch ? "Unable to update branch" : "Unable to create branch");
    }
  }

  function handleDeleteBranch(branch: Branch) {
    setBranchPendingDelete(branch);
  }

  async function handleConfirmDeleteBranch() {
    if (!branchPendingDelete) return;
    const branch = branchPendingDelete;
    setError("");
    setMessage("");
    setIsDeletePending(true);

    try {
      await apiRequest(`/branches/${branch.id}`, "DELETE");
      setMessage(`Branch deleted: ${branch.name}`);
      if (editingBranch?.id === branch.id) {
        closeCreateModal();
      }
      await loadBranches();
      setBranchPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete branch");
    } finally {
      setIsDeletePending(false);
    }
  }

  const createModal =
    isCreateOpen &&
    createPortal(
      <section className="modal-shell">
        <div className="modal-card max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">{editingBranch ? "Edit Branch" : "Create Branch"}</h3>
            <button type="button" className="btn-muted" onClick={closeCreateModal}>
              Close
            </button>
          </div>

          <form className="grid gap-3 md:grid-cols-3" onSubmit={handleSubmit}>
            <label className="grid gap-1 text-sm font-medium text-black/80">
              Branch Code
              <input
                className="field"
                value={form.code}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="e.g. BR-001"
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-black/80">
              Branch Name
              <input
                className="field"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Branch Name"
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-black/80">
              Address
              <input
                className="field"
                value={form.address}
                onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                placeholder="Address"
              />
            </label>
            <div className="md:col-span-3">
              <button type="submit" className="btn-primary">
                {editingBranch ? "Save Changes" : "Add Branch"}
              </button>
            </div>
          </form>
        </div>
      </section>,
      document.body
    );

  return (
    <main className="page-shell">
      {createModal}

      <PageHeader
        title="Branches"
        subtitle="Manage branch records, then assign one or more branch admins from the Accounts page."
        eyebrow="Network Control"
        actions={<PageMetaStamp />}
      />
      <ConfirmDialog
        open={Boolean(branchPendingDelete)}
        tone="danger"
        title="Delete this branch?"
        description={
          branchPendingDelete
            ? `${branchPendingDelete.name} will be removed. Linked users and members will become unassigned from a branch.`
            : ""
        }
        confirmLabel={isDeletePending ? "Deleting..." : "Delete Branch"}
        cancelLabel="Cancel"
        disabled={isDeletePending}
        onCancel={() => {
          if (!isDeletePending) {
            setBranchPendingDelete(null);
          }
        }}
        onConfirm={() => void handleConfirmDeleteBranch()}
      />

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Branch Records</h2>
            <p className="text-xs text-slate-600">Manage branch details and track how many branch admins are assigned.</p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateModal}>
            Add Branch
          </button>
        </div>

        <div className="relative w-full max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="field pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search code, name, address"
          />
        </div>

        {message && <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mobile-record-list mt-3 md:hidden">
          {paginatedBranches.map((branch) => (
            <article key={branch.id} className="mobile-record-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">{branch.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{branch.code}</p>
                </div>
              </div>

              <div className="mobile-record-grid">
                <BranchField label="Address" value={branch.address || "-"} />
                <BranchField label="Branch Admins" value={String(branch.branchAdminCount ?? 0)} />
              </div>

              <div className="mobile-action-row">
                <button type="button" className="btn-muted btn-page w-full sm:w-auto" onClick={() => openEditModal(branch)}>
                  Edit
                </button>
                <button type="button" className="btn-danger btn-page w-full sm:w-auto" onClick={() => handleDeleteBranch(branch)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
          {filteredBranches.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No branches yet.</p>}
        </div>

        <div className="table-shell mt-3 hidden md:block">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th>Branch Admins</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedBranches.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.code}</td>
                  <td>{branch.name}</td>
                  <td>{branch.address}</td>
                  <td>{branch.branchAdminCount ?? 0}</td>
                  <td>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button type="button" className="btn-muted btn-table" onClick={() => openEditModal(branch)}>
                        Edit
                      </button>
                      <button type="button" className="btn-danger btn-table" onClick={() => handleDeleteBranch(branch)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredBranches.length === 0 && <p className="p-3 text-sm text-slate-600">No branches yet.</p>}
        </div>
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalItems={filteredBranches.length}
          pageSize={rowsPerPage}
          onPageChange={setPage}
        />
      </section>
    </main>
  );
}
