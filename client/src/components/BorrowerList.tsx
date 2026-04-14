import { MoreVertical, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Borrower } from "../types/models";

interface BorrowerListProps {
  borrowers: Borrower[];
  onEdit: (borrower: Borrower) => void;
  onDelete: (borrower: Borrower) => void;
  onHistory?: (borrower: Borrower) => void;
  onRemarks?: (borrower: Borrower) => void;
  onDeleteSelected?: (borrowers: Borrower[]) => void;
  onImport?: () => void;
  onAdd?: () => void;
  canImport?: boolean;
  canAdd?: boolean;
  canEditDelete?: boolean;
  canViewHistory?: boolean;
  canViewRemarks?: boolean;
}

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
    <div className="pagination-bar">
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

function BorrowerField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <p className="mobile-record-value">{value}</p>
    </div>
  );
}

export function BorrowerList({
  borrowers,
  onEdit,
  onDelete,
  onHistory,
  onRemarks,
  onDeleteSelected,
  onImport,
  onAdd,
  canImport = true,
  canAdd = true,
  canEditDelete = true,
  canViewHistory = true,
  canViewRemarks = true
}: BorrowerListProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [openMenu, setOpenMenu] = useState<{ borrowerId: number; top: number; left: number; openUp: boolean } | null>(null);
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    typeof window === "undefined" ? 13 : computeRowsPerPage(window.innerHeight)
  );
  const [selectedBorrowerIds, setSelectedBorrowerIds] = useState<number[]>([]);
  const selectPageCheckboxRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return borrowers;
    return borrowers.filter((b) =>
      [b.cifKey, b.memberName, b.contactInfo, b.address].join(" ").toLowerCase().includes(q)
    );
  }, [borrowers, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));

  useEffect(() => {
    function handleResize() {
      setRowsPerPage(computeRowsPerPage(window.innerHeight));
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    function closeMenu() {
      setOpenMenu(null);
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-action-menu='borrower']")) {
        return;
      }
      closeMenu();
    }

    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  useEffect(() => {
    setOpenMenu(null);
  }, [page, query]);

  useEffect(() => {
    setSelectedBorrowerIds((current) => current.filter((id) => borrowers.some((borrower) => borrower.id === id)));
  }, [borrowers]);

  const paginated = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page, rowsPerPage]);
  const selectedIdSet = useMemo(() => new Set(selectedBorrowerIds), [selectedBorrowerIds]);
  const paginatedIds = useMemo(() => paginated.map((borrower) => borrower.id), [paginated]);
  const filteredIds = useMemo(() => filtered.map((borrower) => borrower.id), [filtered]);
  const selectedBorrowers = useMemo(
    () => borrowers.filter((borrower) => selectedIdSet.has(borrower.id)),
    [borrowers, selectedIdSet]
  );

  const canBulkDelete = canEditDelete && typeof onDeleteSelected === "function";
  const hasAnySelection = selectedBorrowerIds.length > 0;
  const hasPageRows = paginatedIds.length > 0;
  const allCurrentPageSelected = hasPageRows && paginatedIds.every((borrowerId) => selectedIdSet.has(borrowerId));
  const someCurrentPageSelected = hasPageRows && paginatedIds.some((borrowerId) => selectedIdSet.has(borrowerId));

  useEffect(() => {
    if (!selectPageCheckboxRef.current) return;
    selectPageCheckboxRef.current.indeterminate = someCurrentPageSelected && !allCurrentPageSelected;
  }, [allCurrentPageSelected, someCurrentPageSelected]);

  const activeMenuBorrower = useMemo(
    () => (openMenu ? borrowers.find((borrower) => borrower.id === openMenu.borrowerId) ?? null : null),
    [borrowers, openMenu]
  );
  const hasHistoryAction = canViewHistory && typeof onHistory === "function";
  const hasRemarksAction = canViewRemarks && typeof onRemarks === "function";
  const canOpenActionMenu = hasHistoryAction || hasRemarksAction || canEditDelete;
  const actionItemCount = (hasHistoryAction ? 1 : 0) + (hasRemarksAction ? 1 : 0) + (canEditDelete ? 2 : 0);
  const isReadOnlyView = !canImport && !canAdd && !canOpenActionMenu && !canBulkDelete;

  function toggleMenu(button: HTMLButtonElement, borrowerId: number) {
    const rect = button.getBoundingClientRect();
    setOpenMenu((current) => {
      if (current?.borrowerId === borrowerId) {
        return null;
      }
      const estimatedMenuHeight = actionItemCount * 40 + 8;
      const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight - 8;
      return {
        borrowerId,
        left: rect.right,
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        openUp
      };
    });
  }

  function toggleBorrowerSelection(borrowerId: number, checked: boolean) {
    setSelectedBorrowerIds((current) => {
      const currentSet = new Set(current);
      if (checked) {
        currentSet.add(borrowerId);
      } else {
        currentSet.delete(borrowerId);
      }
      return Array.from(currentSet);
    });
  }

  function toggleCurrentPageSelection(checked: boolean) {
    setSelectedBorrowerIds((current) => {
      const currentSet = new Set(current);
      for (const borrowerId of paginatedIds) {
        if (checked) {
          currentSet.add(borrowerId);
        } else {
          currentSet.delete(borrowerId);
        }
      }
      return Array.from(currentSet);
    });
  }

  return (
    <>
      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Member Records</h2>
            <p className="text-xs text-slate-600">{isReadOnlyView ? "View branch member profiles." : "Manage branch member profiles."}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {onImport && canImport && (
              <button type="button" className="btn-muted w-full sm:w-auto" onClick={onImport}>
                Import CSV
              </button>
            )}
            {onAdd && canAdd && (
              <button type="button" className="btn-primary w-full sm:w-auto" onClick={onAdd}>
                Add Member
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative w-full max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search borrowers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search CIF, member, contact"
              className="field pl-9"
            />
          </div>
          {canBulkDelete && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <button
                type="button"
                className="btn-muted w-full sm:w-auto"
                onClick={() => setSelectedBorrowerIds(filteredIds)}
                disabled={filteredIds.length === 0}
              >
                Select All Results
              </button>
              <button
                type="button"
                className="btn-muted w-full sm:w-auto"
                onClick={() => setSelectedBorrowerIds([])}
                disabled={!hasAnySelection}
              >
                Clear Selection
              </button>
              <button
                type="button"
                className="btn-danger w-full sm:w-auto"
                onClick={() => onDeleteSelected?.(selectedBorrowers)}
                disabled={!hasAnySelection}
              >
                Delete Selected ({selectedBorrowerIds.length})
              </button>
            </div>
          )}
        </div>

        <div className="mobile-record-list mt-3 md:hidden">
          {paginated.map((borrower) => (
            <article key={borrower.id} className="mobile-record-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">{borrower.memberName}</p>
                  <p className="mt-1 text-xs text-slate-500">{borrower.cifKey}</p>
                </div>
                {canBulkDelete && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${borrower.memberName}`}
                    checked={selectedIdSet.has(borrower.id)}
                    onChange={(event) => toggleBorrowerSelection(borrower.id, event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-teal-600"
                  />
                )}
              </div>

              <div className="mobile-record-grid">
                <BorrowerField label="Contact Info" value={borrower.contactInfo} />
                <BorrowerField label="Address" value={borrower.address} />
              </div>

              <div className="mobile-action-row">
                {hasHistoryAction && (
                  <button type="button" className="btn-muted btn-page w-full sm:w-auto" onClick={() => onHistory?.(borrower)}>
                    History
                  </button>
                )}
                {hasRemarksAction && (
                  <button type="button" className="btn-muted btn-page w-full sm:w-auto" onClick={() => onRemarks?.(borrower)}>
                    Remarks
                  </button>
                )}
                {canEditDelete && (
                  <button type="button" className="btn-muted btn-page w-full sm:w-auto" onClick={() => onEdit(borrower)}>
                    Edit
                  </button>
                )}
                {canEditDelete && (
                  <button type="button" className="btn-danger btn-page w-full sm:w-auto" onClick={() => onDelete(borrower)}>
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
          {filtered.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No members found.</p>}
        </div>

        <div className="table-shell mt-3 hidden md:block">
          <table className="table-clean">
            <thead>
              <tr>
                {canBulkDelete && (
                  <th>
                    <input
                      ref={selectPageCheckboxRef}
                      type="checkbox"
                      aria-label="Select all members on current page"
                      checked={allCurrentPageSelected}
                      onChange={(event) => toggleCurrentPageSelection(event.target.checked)}
                      disabled={!hasPageRows}
                      className="h-4 w-4 accent-teal-600"
                    />
                  </th>
                )}
                <th>CIF Key</th>
                <th>Member Name</th>
                <th>Contact Info</th>
                <th>Address</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((borrower) => (
                <tr key={borrower.id}>
                  {canBulkDelete && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${borrower.memberName}`}
                        checked={selectedIdSet.has(borrower.id)}
                        onChange={(event) => toggleBorrowerSelection(borrower.id, event.target.checked)}
                        className="h-4 w-4 accent-teal-600"
                      />
                    </td>
                  )}
                  <td>{borrower.cifKey}</td>
                  <td>{borrower.memberName}</td>
                  <td>{borrower.contactInfo}</td>
                  <td>{borrower.address}</td>
                  <td>
                    <div className="flex w-full justify-center">
                      {canOpenActionMenu ? (
                        <div data-action-menu="borrower" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="action-menu-trigger"
                            aria-label={`Open actions for ${borrower.memberName}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenu?.borrowerId === borrower.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleMenu(event.currentTarget, borrower.id);
                            }}
                          >
                            <MoreVertical size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">View only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-3 text-sm text-slate-600">No members found.</p>}
        </div>
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalItems={filtered.length}
          pageSize={rowsPerPage}
          onPageChange={setPage}
        />
      </section>
      {openMenu && activeMenuBorrower && createPortal(
        <div
          className="action-menu-popover-floating"
          data-action-menu="borrower"
          role="menu"
          style={{
            left: openMenu.left,
            top: openMenu.top,
            transform: openMenu.openUp ? "translate(-100%, -100%)" : "translateX(-100%)"
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {hasHistoryAction && (
            <button
              type="button"
              className="action-menu-item"
              onClick={() => {
                setOpenMenu(null);
                onHistory(activeMenuBorrower);
              }}
            >
              History
            </button>
          )}
          {hasRemarksAction && (
            <button
              type="button"
              className="action-menu-item"
              onClick={() => {
                setOpenMenu(null);
                onRemarks(activeMenuBorrower);
              }}
            >
              Remarks
            </button>
          )}
          {canEditDelete && (
            <>
              <button
                type="button"
                className="action-menu-item"
                onClick={() => {
                  setOpenMenu(null);
                  onEdit(activeMenuBorrower);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="action-menu-item action-menu-item-danger"
                onClick={() => {
                  setOpenMenu(null);
                  onDelete(activeMenuBorrower);
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
