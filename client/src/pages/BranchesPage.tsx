import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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

export function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{ branchName: string; username: string; password: string } | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
      [branch.code, branch.name, branch.address, branch.branchAdminUsername ?? ""]
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
    setForm(EMPTY_FORM);
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
      const response = await apiRequest<{ name: string; branchAdmin?: { username: string; password: string } }>("/branches", "POST", {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        address: form.address.trim()
      });
      setMessage("Branch created.");
      if (response.branchAdmin) {
        setCredentials({
          branchName: response.name,
          username: response.branchAdmin.username,
          password: response.branchAdmin.password
        });
      }
      setForm(EMPTY_FORM);
      setIsCreateOpen(false);
      await loadBranches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create branch");
    }
  }

  async function handleShowAdminCredentials(branch: Branch) {
    setError("");
    setMessage("");
    try {
      const response = await apiRequest<{ username: string; password: string }>(`/branches/${branch.id}/admin-credentials`, "POST");
      setCredentials({
        branchName: branch.name,
        username: response.username,
        password: response.password
      });
      await loadBranches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to fetch admin credentials");
    }
  }

  const createModal =
    isCreateOpen &&
    createPortal(
      <section className="modal-shell">
        <div className="modal-card max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Create Branch</h3>
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
                Add Branch
              </button>
            </div>
          </form>
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
              <h2 className="text-lg font-semibold">Branch Admin Credentials</h2>
              <button type="button" className="btn-muted" onClick={() => setCredentials(null)}>
                Close
              </button>
            </div>
            <p className="text-sm text-black/70">Branch: {credentials.branchName}</p>
            <p className="text-sm text-black/70">Username: <strong>{credentials.username}</strong></p>
            <p className="text-sm text-black/70">Password: <strong>{credentials.password}</strong></p>
            <p className="mt-2 text-xs text-black/60">This branch admin password stays the same unless changed in code/database.</p>
          </section>
        </div>
      </section>
    );

  return (
    <main className="page-shell">
      {createModal}
      {credentialsModal}

      <PageHeader
        title="Branches"
        subtitle="Manage branch records and branch admin access in one place."
        eyebrow="Network Control"
        actions={<PageMetaStamp />}
      />

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Branch Records</h2>
            <p className="text-xs text-slate-600">Manage branch details and admin login access.</p>
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

        <div className="table-shell mt-3">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th>Branch Admin</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedBranches.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.code}</td>
                  <td>{branch.name}</td>
                  <td>{branch.address}</td>
                  <td>{branch.branchAdminUsername || "-"}</td>
                  <td>
                    <button type="button" className="btn-muted btn-table" onClick={() => void handleShowAdminCredentials(branch)}>
                      Show Admin Login
                    </button>
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
