import { hasPermission } from "../services/permissions";
import { MoreVertical, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { actionStatusClass, DEFAULT_REMARK_CATEGORY, getRemarkCategoryLabel, isLoanActionStatus, LOAN_ACTION_STATUSES, REMARK_CATEGORIES, type RemarkCategory } from "../constants/remarkCategories";
import { RemarkCategoryOptions } from "../components/RemarkCategoryOptions";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { RemarkSummaryModal } from "../components/RemarkSummaryModal";
import { ToastNotification } from "../components/ToastNotification";
import { useAuth } from "../context/AuthContext";
import { apiDownload, apiRequest } from "../services/api";
import { fileToAttachment } from "../services/attachments";
import { RemarkPhotoField } from "../components/RemarkPhoto";
import { photoPayload, type CapturedPhoto } from "../services/photo";
import type { Borrower, Branch, LoanPayload, LoanPayment, LoanRemark, Paged } from "../types/models";
import { PaginationControls } from "../components/PaginationControls";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { computeRowsPerPage, EMPTY_FORM, formatCurrency, formatDate, formatDateTime, loanStatusClass } from "./loans/format";
import { LoanImportDialog } from "./loans/LoanImportDialog";
import { LoanRecordField } from "./loans/LoanRecordField";
import { PaymentRecordsPanel } from "./loans/PaymentRecordsPanel";
import { RemarkRecordsPanel } from "./loans/RemarkRecordsPanel";
import { SettledAccountsPanel } from "./loans/SettledAccountsPanel";
import type { LoanListPage, LoanQuickRef, LoanRow, PaymentRecordRow, RemarkGroupRow, RemarkRecordRow } from "./loans/types";

const SEARCH_DEBOUNCE_MS = 300;

type RecordsTab = "loans" | "payments" | "remarks" | "settled";
// Collectors and LAS on phones get just the search box; the extra filters stay on larger screens.
const COLLECTOR_MOBILE_HIDDEN = "hidden lg:block ";
const isSecondaryTab = (tab: string | null): tab is Exclude<RecordsTab, "loans"> =>
  tab === "payments" || tab === "remarks" || tab === "settled";

export function LoansPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isCollector = user?.role === "staff";
  // Collectors and LAS work in the field, so they share the simpler phone layout.
  const isFieldUser = isCollector || user?.role === "las";
  const isBranchManager = user?.role === "branch_admin";
  const canAddLoans = user?.role === "super_admin" || user?.role === "branch_admin";
  const canImportLoans = hasPermission(user, "import_collections");
  const canEditLoans = user?.role === "super_admin" || user?.role === "branch_admin";
  const canDeleteLoans = user?.role === "super_admin" || user?.role === "branch_admin";
  const canDeletePayments = user?.role === "super_admin" || user?.role === "branch_admin";
  const canUseLoanActions = canEditLoans;
  const [members, setMembers] = useState<Borrower[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  // Loans and payments hold only the current page; the server filters, sorts and counts.
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [loanTotal, setLoanTotal] = useState(0);
  const [loanTypeOptions, setLoanTypeOptions] = useState<string[]>([]);
  const [latestImportedAt, setLatestImportedAt] = useState("");
  const [lastImport, setLastImport] = useState<LoanListPage["lastImport"]>(null);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  const loanRequestRef = useRef(0);
  const paymentRequestRef = useRef(0);
  const [form, setForm] = useState<LoanPayload>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isRemarksOpen, setIsRemarksOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importBranchError, setImportBranchError] = useState("");
  const [remarkLoan, setRemarkLoan] = useState<Pick<LoanRow, "id" | "loanAccountNo" | "memberName"> | null>(null);
  const [remarks, setRemarks] = useState<LoanRemark[]>([]);
  const [remarkInput, setRemarkInput] = useState("");
  const [remarkCategory, setRemarkCategory] = useState<RemarkCategory>(DEFAULT_REMARK_CATEGORY);
  const [remarkAttachment, setRemarkAttachment] = useState<File | null>(null);
  const [remarkPhoto, setRemarkPhoto] = useState<CapturedPhoto | null | undefined>(undefined);
  const [summaryRemark, setSummaryRemark] = useState<LoanRemark | null>(null);
  const [remarksLoading, setRemarksLoading] = useState(false);
  const [remarkError, setRemarkError] = useState("");
  const [loanQuery, setLoanQuery] = useState("");
  const [loanTypeFilter, setLoanTypeFilter] = useState("");
  const [parAgeFilter, setParAgeFilter] = useState("");
  const [actionStatusFilter, setActionStatusFilter] = useState("");
  const [activeRecordsTab, setActiveRecordsTab] = useState<RecordsTab>(
    !isCollector && isSecondaryTab(searchParams.get("tab")) ? searchParams.get("tab") as RecordsTab : "loans"
  );
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecordRow[]>([]);
  const [paymentQuery, setPaymentQuery] = useState("");
  const [remarkRecords, setRemarkRecords] = useState<RemarkGroupRow[]>([]);
  const [remarkTotal, setRemarkTotal] = useState(0);
  const remarkRequestRef = useRef(0);
  const canDeleteRemarks = canDeletePayments;
  const [selectedRemarkLoans, setSelectedRemarkLoans] = useState<number[]>([]);
  const [remarkDeleteIds, setRemarkDeleteIds] = useState<number[]>([]);
  const [remarkDeletePending, setRemarkDeletePending] = useState(false);
  const [remarkQuery, setRemarkQuery] = useState("");
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentLoan, setPaymentLoan] = useState<Pick<LoanRow, "id" | "loanAccountNo" | "memberName"> | null>(null);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentOrNo, setPaymentOrNo] = useState("");
  const [paymentDateTime, setPaymentDateTime] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [openMenuLoan, setOpenMenuLoan] = useState<{ loanId: number; top: number; left: number; openUp: boolean } | null>(null);
  const [loanPendingDelete, setLoanPendingDelete] = useState<LoanQuickRef | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [loanBulkDeleteIds, setLoanBulkDeleteIds] = useState<number[]>([]);
  const [isBulkLoanDeletePending, setIsBulkLoanDeletePending] = useState(false);
  const [selectedLoanIds, setSelectedLoanIds] = useState<number[]>([]);
  const [paymentBulkDeleteIds, setPaymentBulkDeleteIds] = useState<number[]>([]);
  const [isBulkPaymentDeletePending, setIsBulkPaymentDeletePending] = useState(false);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<number[]>([]);
  const [loanPage, setLoanPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [remarkRecordsPage, setRemarkRecordsPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    typeof window === "undefined" ? 13 : computeRowsPerPage(window.innerHeight)
  );
  const [importBranchId, setImportBranchId] = useState(0);
  const [membersNeedRefresh, setMembersNeedRefresh] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState(0);
  const [loanFormBranchId, setLoanFormBranchId] = useState(0);

  const availableLoanMembers = useMemo(() => {
    const matches =
      user?.role === "super_admin"
        ? loanFormBranchId <= 0
          ? []
          : members.filter((member) => Number(member.branchId ?? 0) === loanFormBranchId)
        : (() => {
            const branchId = Number(user?.branchId ?? loanFormBranchId ?? 0);
            if (branchId <= 0) return members;
            return members.filter((member) => Number(member.branchId ?? 0) === branchId);
          })();

    return [...matches].sort(
      (a, b) => a.memberName.localeCompare(b.memberName, undefined, { sensitivity: "base" }) || a.cifKey.localeCompare(b.cifKey, undefined, { sensitivity: "base" })
    );
  }, [loanFormBranchId, members, user?.branchId, user?.role]);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === form.borrowerId) ?? null,
    [members, form.borrowerId]
  );

  const debouncedLoanQuery = useDebouncedValue(loanQuery.trim(), SEARCH_DEBOUNCE_MS);
  const debouncedPaymentQuery = useDebouncedValue(paymentQuery.trim(), SEARCH_DEBOUNCE_MS);
  const branchFilterId = user?.role === "super_admin" && selectedBranchId > 0 ? selectedBranchId : 0;
  const collectorFilterClass = isFieldUser ? COLLECTOR_MOBILE_HIDDEN : "";

  const debouncedRemarkQuery = useDebouncedValue(remarkQuery.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    setSelectedRemarkLoans([]);
  }, [branchFilterId, listRefresh]);

  function toggleRemarkLoan(id: number, checked: boolean) {
    setSelectedRemarkLoans(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }

  async function deleteSelectedRemarks() {
    setRemarkDeletePending(true);
    setError("");
    try {
      const result = await apiRequest<{ deleted: number }>("/loans/remarks/bulk", "DELETE", { ids: remarkDeleteIds });
      setRemarkDeleteIds([]);
      setSelectedRemarkLoans([]);
      setMessage(`Deleted ${result.deleted} remark(s).`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete remarks");
    } finally {
      setRemarkDeletePending(false);
    }
  }

  function openLoanRemarks(row: RemarkRecordRow) {
    navigate(`/loan-details/${row.loan_id}?tab=remarks&from=remarks&remarkId=${row.id}`);
  }

  const totalLoanPages = Math.max(1, Math.ceil(loanTotal / rowsPerPage));
  const totalPaymentPages = Math.max(1, Math.ceil(paymentTotal / rowsPerPage));
  const totalRemarkPages = Math.max(1, Math.ceil(remarkTotal / rowsPerPage));

  useEffect(() => {
    function handleResize() {
      setRowsPerPage(computeRowsPerPage(window.innerHeight));
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setLoanPage(1);
  }, [debouncedLoanQuery, loanTypeFilter, parAgeFilter, actionStatusFilter, branchFilterId]);

  useEffect(() => {
    setPaymentPage(1);
  }, [debouncedPaymentQuery, branchFilterId]);

  useEffect(() => {
    setRemarkRecordsPage(1);
  }, [debouncedRemarkQuery, branchFilterId]);

  useEffect(() => {
    setLoanPage((current) => Math.min(current, totalLoanPages));
  }, [totalLoanPages]);

  useEffect(() => {
    setPaymentPage((current) => Math.min(current, totalPaymentPages));
  }, [totalPaymentPages]);

  useEffect(() => {
    setRemarkRecordsPage((current) => Math.min(current, totalRemarkPages));
  }, [totalRemarkPages]);

  useEffect(() => {
    function closeMenu() {
      setOpenMenuLoan(null);
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-action-menu='loan']")) {
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
    setOpenMenuLoan(null);
  }, [activeRecordsTab, loanPage, loanQuery, loanTypeFilter, parAgeFilter]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!isCollector && isSecondaryTab(requestedTab)) {
      setActiveRecordsTab(requestedTab);
      return;
    }

    setActiveRecordsTab("loans");
  }, [isCollector, searchParams]);

  useEffect(() => {
    if (user?.role === "super_admin" && importBranchId === 0 && branches.length > 0) {
      setImportBranchId(branches[0].id);
    }
  }, [user?.role, branches, importBranchId]);

  useEffect(() => {
    if (!isFormOpen) return;

    if (user?.role === "super_admin") {
      if (loanFormBranchId === 0 && branches.length > 0) {
        setLoanFormBranchId(branches[0].id);
      }
      return;
    }

    const branchId = Number(user?.branchId ?? 0);
    if (branchId > 0 && loanFormBranchId !== branchId) {
      setLoanFormBranchId(branchId);
    }
  }, [branches, isFormOpen, loanFormBranchId, user?.branchId, user?.role]);

  useEffect(() => {
    if (form.borrowerId === 0) return;
    const memberStillAvailable = availableLoanMembers.some((member) => member.id === form.borrowerId);
    if (!memberStillAvailable) {
      setForm((current) => ({ ...current, borrowerId: 0 }));
    }
  }, [availableLoanMembers, form.borrowerId]);

  const paginatedLoans = loans;
  const paginatedPaymentRecords = paymentRecords;

  const paginatedRemarkRecords = remarkRecords;
  const selectedLoanIdSet = useMemo(() => new Set(selectedLoanIds), [selectedLoanIds]);
  const paginatedLoanIds = useMemo(() => paginatedLoans.map((loan) => loan.id), [paginatedLoans]);
  const paginatedPaymentIds = useMemo(() => paginatedPaymentRecords.map((row) => row.id), [paginatedPaymentRecords]);
  const hasAnyLoanSelection = selectedLoanIds.length > 0;
  const hasLoanPageRows = paginatedLoanIds.length > 0;
  const allLoanPageSelected = hasLoanPageRows && paginatedLoanIds.every((id) => selectedLoanIdSet.has(id));

  const activeMenuLoan = useMemo(
    () => (openMenuLoan ? loans.find((loan) => loan.id === openMenuLoan.loanId) ?? null : null),
    [loans, openMenuLoan]
  );

  function openLoanDetails(targetLoanId: number) {
    navigate(`/loan-details/${targetLoanId}?from=collections`);
  }

  function toggleLoanMenu(button: HTMLButtonElement, loanId: number) {
    const rect = button.getBoundingClientRect();
    setOpenMenuLoan((current) => {
      if (current?.loanId === loanId) {
        return null;
      }
      const estimatedMenuHeight = 156;
      const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight - 8;
      return {
        loanId,
        left: rect.right,
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        openUp
      };
    });
  }

  async function loadMembers() {
    const memberData = await apiRequest<Borrower[]>("/borrowers");
    setMembers(memberData);
    setMembersNeedRefresh(false);
  }

  function loanFilterParams() {
    const params = new URLSearchParams();
    if (debouncedLoanQuery) params.set("search", debouncedLoanQuery);
    if (loanTypeFilter) params.set("loanType", loanTypeFilter);
    if (parAgeFilter) params.set("parAge", parAgeFilter);
    if (actionStatusFilter) params.set("actionStatus", actionStatusFilter);
    if (branchFilterId > 0) params.set("branchId", String(branchFilterId));
    return params;
  }

  function paymentFilterParams() {
    const params = new URLSearchParams();
    if (debouncedPaymentQuery) params.set("search", debouncedPaymentQuery);
    if (branchFilterId > 0) params.set("branchId", String(branchFilterId));
    return params;
  }

  // Only the newest request may update the list, so fast typing never shows stale results.
  async function loadLoanPage() {
    const request = ++loanRequestRef.current;
    const params = loanFilterParams();
    params.set("page", String(loanPage));
    params.set("pageSize", String(rowsPerPage));
    try {
      const result = await apiRequest<LoanListPage>(`/loans?${params}`);
      if (request !== loanRequestRef.current) return;
      setLoans(result.items);
      setLoanTotal(result.total);
      setLoanTypeOptions(result.loanTypes);
      setLatestImportedAt(result.latestImportedAt);
      setLastImport(result.lastImport ?? null);
      if (result.page !== loanPage) setLoanPage(result.page);
    } catch (e) {
      if (request === loanRequestRef.current) setError(e instanceof Error ? e.message : "Unable to load loans");
    }
  }

  async function loadPaymentPage() {
    const request = ++paymentRequestRef.current;
    const params = paymentFilterParams();
    params.set("page", String(paymentPage));
    params.set("pageSize", String(rowsPerPage));
    try {
      const result = await apiRequest<Paged<PaymentRecordRow>>(`/payments?${params}`);
      if (request !== paymentRequestRef.current) return;
      setPaymentRecords(result.items);
      setPaymentTotal(result.total);
      if (result.page !== paymentPage) setPaymentPage(result.page);
    } catch {
      if (request === paymentRequestRef.current) { setPaymentRecords([]); setPaymentTotal(0); }
    }
  }

  function remarkFilterParams() {
    const params = new URLSearchParams();
    if (debouncedRemarkQuery) {
      params.set("search", debouncedRemarkQuery);
      // Category labels are client-side, so send the keys whose label matches the search.
      const query = debouncedRemarkQuery.toLowerCase();
      const categories = REMARK_CATEGORIES.filter(category => category.label.toLowerCase().includes(query)).map(category => category.value);
      if (categories.length) params.set("categories", categories.join(","));
    }
    if (branchFilterId > 0) params.set("branchId", String(branchFilterId));
    return params;
  }

  async function loadRemarkPage() {
    const request = ++remarkRequestRef.current;
    const params = remarkFilterParams();
    params.set("page", String(remarkRecordsPage));
    params.set("pageSize", String(rowsPerPage));
    try {
      const result = await apiRequest<Paged<RemarkGroupRow>>(`/loans/remarked?${params}`);
      if (request !== remarkRequestRef.current) return;
      setRemarkRecords(result.items);
      setRemarkTotal(result.total);
      if (result.page !== remarkRecordsPage) setRemarkRecordsPage(result.page);
    } catch {
      if (request === remarkRequestRef.current) { setRemarkRecords([]); setRemarkTotal(0); }
    }
  }

  async function selectAllMatchingRemarkLoans() {
    const params = remarkFilterParams();
    params.set("idsOnly", "true");
    try {
      const result = await apiRequest<{ ids: number[] }>(`/loans/remarked?${params}`);
      setSelectedRemarkLoans(result.ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to select remarks");
    }
  }

  // Deleting covers every remark on the selected loans, including ones not shown in the list.
  async function requestRemarkDelete() {
    try {
      const result = await apiRequest<{ ids: number[] }>("/loans/remarked/remark-ids", "POST", { loanIds: selectedRemarkLoans });
      setRemarkDeleteIds(result.ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to prepare remark deletion");
    }
  }

  async function selectAllMatchingLoans() {
    const params = loanFilterParams();
    params.set("idsOnly", "true");
    try {
      const result = await apiRequest<{ ids: number[] }>(`/loans?${params}`);
      setSelectedLoanIds(result.ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to select loans");
    }
  }

  async function selectAllMatchingPayments() {
    const params = paymentFilterParams();
    params.set("idsOnly", "true");
    try {
      const result = await apiRequest<{ ids: number[] }>(`/payments?${params}`);
      setSelectedPaymentIds(result.ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to select payments");
    }
  }

  useEffect(() => {
    void loadLoanPage();
  }, [loanPage, rowsPerPage, debouncedLoanQuery, loanTypeFilter, parAgeFilter, actionStatusFilter, branchFilterId, listRefresh]);

  useEffect(() => {
    void loadPaymentPage();
  }, [paymentPage, rowsPerPage, debouncedPaymentQuery, branchFilterId, listRefresh]);

  useEffect(() => {
    if (isCollector) return;
    void loadRemarkPage();
  }, [remarkRecordsPage, rowsPerPage, debouncedRemarkQuery, branchFilterId, listRefresh, isCollector]);

  // The list effects already load on first render, so only later reloads ask them to refresh.
  async function loadData(refreshLists = true) {
    const [memberData, branchData] = await Promise.all([
      apiRequest<Borrower[]>("/borrowers"),
      apiRequest<Branch[]>("/branches").catch(() => [])
    ]);
    setMembers(memberData);
    setMembersNeedRefresh(false);
    setBranches(branchData);
    if (refreshLists) setListRefresh((value) => value + 1);
  }

  async function refreshLoanImportData() {
    setListRefresh((value) => value + 1);
    setMembersNeedRefresh(true);
  }

  useEffect(() => {
    void loadData(false);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      if (editingId) {
        await apiRequest(`/loans/${editingId}`, "PATCH", form);
        setMessage("Loan updated.");
      } else {
        await apiRequest("/loans", "POST", form);
        setMessage("Loan created.");
      }

      setEditingId(null);
      setForm(EMPTY_FORM);
      setIsFormOpen(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save loan");
    }
  }

  async function openCreateModal() {
    setError("");
    setMessage("");
    if (membersNeedRefresh) {
      await loadMembers();
    }
    setEditingId(null);
    setForm(EMPTY_FORM);
    setLoanFormBranchId(user?.role === "super_admin" ? (branches[0]?.id ?? 0) : Number(user?.branchId ?? 0));
    setIsFormOpen(true);
  }

  async function openImportModal() {
    if (!canImportLoans) return;
    setError("");
    setMessage("");
    setImportBranchError("");
    if (user?.role === "super_admin") {
      try {
        const latestBranches = await apiRequest<Branch[]>("/branches");
        setBranches(latestBranches);
        setImportBranchId((current) => latestBranches.some(branch => branch.id === current) ? current : (latestBranches[0]?.id ?? 0));
        if (latestBranches.length === 0) {
          setImportBranchError("No branches are available. Create a branch before importing loans.");
        }
      } catch (e) {
        setImportBranchId(0);
        setImportBranchError(e instanceof Error ? e.message : "Unable to load branches");
      }
    }
    setIsImportOpen(true);
  }

  function closeImportModal() {
    setIsImportOpen(false);
  }

  function handleImported(summary: string) {
    setImportMessage(summary);
    void refreshLoanImportData().catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : "Import finished but list refresh failed");
    });
  }

  async function startEdit(loan: LoanRow) {
    setError("");
    setMessage("");
    if (membersNeedRefresh) {
      await loadMembers();
    }
    setEditingId(loan.id);
    setForm({
      borrowerId: loan.borrowerId,
      loanAccountNo: loan.loanAccountNo,
      loanType: loan.loanType,
      dateRelease: loan.dateRelease,
      maturityDate: loan.maturityDate,
      loanAmount: loan.loanAmount,
      loanBalance: loan.loanBalance,
      principalDue: loan.principalDue,
      penaltyDue: loan.penaltyDue,
      interest: loan.interest,
      otherCharges: loan.otherCharges,
      total: loan.total,
      parAge: loan.parAge,
      status: loan.status,
      notes: loan.notes ?? ""
    });
    setLoanFormBranchId(user?.role === "super_admin" ? Number(loan.branchId ?? branches[0]?.id ?? 0) : Number(user?.branchId ?? loan.branchId ?? 0));
    setIsFormOpen(true);
  }

  function closeFormModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setLoanFormBranchId(0);
    setIsFormOpen(false);
  }

  async function loadRemarks(loanId: number) {
    setRemarksLoading(true);
    setRemarkError("");
    try {
      const data = await apiRequest<LoanRemark[]>(`/loans/${loanId}/remarks`);
      setRemarks(data);
    } catch (e) {
      setRemarkError(e instanceof Error ? e.message : "Unable to load remarks");
    } finally {
      setRemarksLoading(false);
    }
  }

  async function openRemarksModal(loan: LoanQuickRef) {
    setRemarkLoan({ id: loan.id, loanAccountNo: loan.loanAccountNo, memberName: loan.memberName });
    setRemarkInput("");
    setRemarkCategory(DEFAULT_REMARK_CATEGORY);
    setRemarkAttachment(null);
    setRemarkPhoto(undefined);
    setRemarks([]);
    setSummaryRemark(null);
    setIsRemarksOpen(true);
    await loadRemarks(loan.id);
  }

  function closeRemarksModal() {
    setIsRemarksOpen(false);
    setRemarkLoan(null);
    setRemarkInput("");
    setRemarkCategory(DEFAULT_REMARK_CATEGORY);
    setRemarkAttachment(null);
    setRemarkPhoto(undefined);
    setRemarks([]);
    setRemarkError("");
  }

  async function handleAddRemark(event: React.FormEvent) {
    event.preventDefault();
    if (!remarkLoan) return;
    const remark = remarkInput.trim();
    // A status (primary remark) can be saved without a note.
    if (!remark && !isLoanActionStatus(remarkCategory)) return;

    setRemarkError("");
    try {
      const attachment = await fileToAttachment(remarkAttachment);
      await apiRequest(`/loans/${remarkLoan.id}/remarks`, "POST", { remark, remarkCategory, attachment, photo: photoPayload(remarkPhoto) });
      setRemarkInput("");
      setRemarkAttachment(null);
      setRemarkPhoto(undefined);
      await loadRemarks(remarkLoan.id);
      // A new status changes the loan's badge in the list.
      if (isLoanActionStatus(remarkCategory)) setListRefresh((value) => value + 1);
    } catch (e) {
      setRemarkError(e instanceof Error ? e.message : "Unable to add remark");
    }
  }

  function handleDeleteLoanRow(loan: LoanQuickRef) {
    setLoanPendingDelete(loan);
  }

  async function handleConfirmDeleteLoan() {
    if (!loanPendingDelete) return;
    const loan = loanPendingDelete;
    setError("");
    setMessage("");
    setIsDeletePending(true);
    try {
      await apiRequest(`/loans/${loan.id}`, "DELETE");
      setSelectedLoanIds((current) => current.filter((id) => id !== loan.id));
      setMessage("Loan removed from Collections. Its payments and remarks remain in history.");
      if (editingId === loan.id) {
        closeFormModal();
      }
      await loadData();
      setLoanPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete loan");
    } finally {
      setIsDeletePending(false);
    }
  }

  function formatBulkDeleteReason(reason: string): string {
    if (reason === "forbidden") return "outside your branch";
    if (reason === "not_found") return "not found";
    return "delete failed";
  }

  function toggleLoanSelection(loanId: number, checked: boolean) {
    setSelectedLoanIds((current) => {
      const currentSet = new Set(current);
      if (checked) {
        currentSet.add(loanId);
      } else {
        currentSet.delete(loanId);
      }
      return Array.from(currentSet);
    });
  }

  function toggleLoanPageSelection(checked: boolean) {
    setSelectedLoanIds((current) => {
      const currentSet = new Set(current);
      for (const loanId of paginatedLoanIds) {
        if (checked) {
          currentSet.add(loanId);
        } else {
          currentSet.delete(loanId);
        }
      }
      return Array.from(currentSet);
    });
  }

  function togglePaymentSelection(paymentId: number, checked: boolean) {
    setSelectedPaymentIds((current) => {
      const currentSet = new Set(current);
      if (checked) {
        currentSet.add(paymentId);
      } else {
        currentSet.delete(paymentId);
      }
      return Array.from(currentSet);
    });
  }

  function togglePaymentPageSelection(checked: boolean) {
    setSelectedPaymentIds((current) => {
      const currentSet = new Set(current);
      for (const paymentId of paginatedPaymentIds) {
        if (checked) {
          currentSet.add(paymentId);
        } else {
          currentSet.delete(paymentId);
        }
      }
      return Array.from(currentSet);
    });
  }

  function handleRequestBulkLoanDelete() {
    if (!canDeleteLoans || selectedLoanIds.length === 0) return;
    setLoanBulkDeleteIds(selectedLoanIds);
  }

  async function handleConfirmBulkLoanDelete() {
    if (loanBulkDeleteIds.length === 0) return;

    setError("");
    setMessage("");
    setIsBulkLoanDeletePending(true);
    const loanLabelById = new Map(loans.map((loan) => [loan.id, loan.loanAccountNo]));

    try {
      const result = await apiRequest<{ deleted: number; skipped: Array<{ id: number; reason: string }> }>(
        "/loans/bulk",
        "DELETE",
        { ids: loanBulkDeleteIds }
      );
      if (editingId && loanBulkDeleteIds.includes(editingId)) {
        closeFormModal();
      }
      await loadData();
      setSelectedLoanIds((current) => current.filter((id) => !loanBulkDeleteIds.includes(id)));
      setLoanBulkDeleteIds([]);
      setMessage(`Removed ${result.deleted} loan record(s) from Collections. Their history was retained.`);

      if (result.skipped.length > 0) {
        const summary = result.skipped
          .slice(0, 3)
          .map((item) => `${loanLabelById.get(item.id) ?? `#${item.id}`} (${formatBulkDeleteReason(item.reason)})`)
          .join(", ");
        const hidden = result.skipped.length > 3 ? ` and ${result.skipped.length - 3} more` : "";
        setError(`${result.skipped.length} loan(s) were not deleted: ${summary}${hidden}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete selected loans");
    } finally {
      setIsBulkLoanDeletePending(false);
    }
  }

  function handleRequestBulkPaymentDelete() {
    if (!canDeletePayments || selectedPaymentIds.length === 0) return;
    setPaymentBulkDeleteIds(selectedPaymentIds);
  }

  async function handleConfirmBulkPaymentDelete() {
    if (paymentBulkDeleteIds.length === 0) return;

    setError("");
    setMessage("");
    setIsBulkPaymentDeletePending(true);
    const paymentLabelById = new Map(paymentRecords.map((row) => [row.id, row.paymentId]));

    try {
      const result = await apiRequest<{ deleted: number; skipped: Array<{ id: number; reason: string }> }>(
        "/payments/bulk",
        "DELETE",
        { ids: paymentBulkDeleteIds }
      );
      await loadData();
      setSelectedPaymentIds((current) => current.filter((id) => !paymentBulkDeleteIds.includes(id)));
      setPaymentBulkDeleteIds([]);
      setMessage(`Deleted ${result.deleted} payment record(s).`);

      if (result.skipped.length > 0) {
        const summary = result.skipped
          .slice(0, 3)
          .map((item) => `${paymentLabelById.get(item.id) ?? `#${item.id}`} (${formatBulkDeleteReason(item.reason)})`)
          .join(", ");
        const hidden = result.skipped.length > 3 ? ` and ${result.skipped.length - 3} more` : "";
        setError(`${result.skipped.length} payment(s) were not deleted: ${summary}${hidden}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete selected payments");
    } finally {
      setIsBulkPaymentDeletePending(false);
    }
  }

  async function loadPayments(loanId: number) {
    setPaymentLoading(true);
    setPaymentError("");
    try {
      const data = await apiRequest<LoanPayment[]>(`/loans/${loanId}/payments`);
      setPayments(data);
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Unable to load payments");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function openPaymentModal(loan: LoanQuickRef) {
    setPaymentLoan({ id: loan.id, loanAccountNo: loan.loanAccountNo, memberName: loan.memberName });
    setPayments([]);
    setPaymentAmount("");
    setPaymentOrNo("");
    setPaymentError("");
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setPaymentDateTime(localIso);
    setIsPaymentOpen(true);
    await loadPayments(loan.id);
  }

  function closePaymentModal() {
    setIsPaymentOpen(false);
    setPaymentLoan(null);
    setPayments([]);
    setPaymentAmount("");
    setPaymentOrNo("");
    setPaymentDateTime("");
    setPaymentError("");
  }

  async function handleSubmitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!paymentLoan) return;
    const amount = Number(paymentAmount);
    const orNo = paymentOrNo.trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a valid payment amount.");
      return;
    }
    if (orNo.length > 80) {
      setPaymentError("OR No is too long.");
      return;
    }

    setPaymentError("");
    try {
      await apiRequest(`/loans/${paymentLoan.id}/payments`, "POST", {
        amount,
        orNo,
        collectedAt: paymentDateTime
      });
      setPaymentAmount("");
      setPaymentOrNo("");
      await loadPayments(paymentLoan.id);
      setMessage("Payment recorded.");
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Unable to record payment");
    }
  }

  const loanFormModal =
    canEditLoans && isFormOpen
      ? createPortal(
          <section className="modal-shell">
            <div className="modal-card max-h-[90vh] max-w-2xl overflow-y-auto">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{editingId ? "Edit Loan" : "Add Loan"}</h3>
                <button type="button" className="btn-muted" onClick={closeFormModal}>
                  Close
                </button>
              </div>

              <form className="grid items-start gap-3 lg:grid-cols-2 lg:gap-x-4" onSubmit={handleSubmit}>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Branch
                  <select
                    className="field min-w-0"
                    value={loanFormBranchId}
                    onChange={(event) => {
                      const nextBranchId = Number(event.target.value);
                      setLoanFormBranchId(nextBranchId);
                      setForm((current) => ({ ...current, borrowerId: 0 }));
                    }}
                    disabled={user?.role !== "super_admin"}
                    required
                  >
                    <option value={0}>{user?.role === "super_admin" ? "Select Branch" : "Assigned Branch"}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.code} - {branch.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Member
                  <select
                    className="field min-w-0"
                    value={form.borrowerId}
                    onChange={(event) => setForm((current) => ({ ...current, borrowerId: Number(event.target.value) }))}
                    required
                    disabled={loanFormBranchId <= 0}
                  >
                    <option value={0}>Select Member</option>
                    {availableLoanMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.cifKey} - {member.memberName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Loan Account Number
                  <input
                    className="field min-w-0"
                    value={form.loanAccountNo}
                    onChange={(event) => setForm((c) => ({ ...c, loanAccountNo: event.target.value }))}
                    placeholder="Loan Account Number"
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Loan Product
                  <input className="field min-w-0" value={form.loanType} onChange={(event) => setForm((c) => ({ ...c, loanType: event.target.value }))} placeholder="Loan Product" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Release Date
                  <input className="field min-w-0" type="date" value={form.dateRelease} onChange={(event) => setForm((c) => ({ ...c, dateRelease: event.target.value }))} required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Maturity
                  <input className="field min-w-0" type="date" value={form.maturityDate} onChange={(event) => setForm((c) => ({ ...c, maturityDate: event.target.value }))} required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Loan Amount
                  <input className="field min-w-0" type="number" min={0} value={form.loanAmount} onChange={(event) => setForm((c) => ({ ...c, loanAmount: Number(event.target.value) }))} placeholder="Loan Amount" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Loan Balance
                  <input className="field min-w-0" type="number" min={0} value={form.loanBalance} onChange={(event) => setForm((c) => ({ ...c, loanBalance: Number(event.target.value) }))} placeholder="Loan Balance" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Principal Arrears
                  <input className="field min-w-0" type="number" min={0} value={form.principalDue} onChange={(event) => setForm((c) => ({ ...c, principalDue: Number(event.target.value) }))} placeholder="Principal Arrears" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Fines
                  <input className="field min-w-0" type="number" min={0} value={form.penaltyDue} onChange={(event) => setForm((c) => ({ ...c, penaltyDue: Number(event.target.value) }))} placeholder="Fines" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Interest
                  <input className="field min-w-0" type="number" min={0} value={form.interest} onChange={(event) => setForm((c) => ({ ...c, interest: Number(event.target.value) }))} placeholder="Interest" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Total
                  <input className="field min-w-0" type="number" min={0} value={form.total} onChange={(event) => setForm((c) => ({ ...c, total: Number(event.target.value) }))} placeholder="Total" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Par Age
                  <input className="field min-w-0" type="number" min={0} value={form.parAge} onChange={(event) => setForm((c) => ({ ...c, parAge: Number(event.target.value) }))} placeholder="Par Age" required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Status
                  <select className="field min-w-0" value={form.status} onChange={(event) => setForm((c) => ({ ...c, status: event.target.value as LoanPayload["status"] }))}>
                    <option value="active">active</option>
                    <option value="overdue">overdue</option>
                    <option value="closed">closed</option>
                  </select>
                </label>

                {loanFormBranchId > 0 && availableLoanMembers.length === 0 && (
                  <p className="md:col-span-2 text-xs text-black/70">
                    No members found for the selected branch.
                  </p>
                )}

                {selectedMember && (
                  <p className="md:col-span-2 text-xs text-black/70">
                    Member: {selectedMember.memberName} | Contact: {selectedMember.contactInfo} | Address: {selectedMember.address}
                  </p>
                )}

                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <button type="submit" className="btn-primary">{editingId ? "Update" : "Create Loan"}</button>
                </div>
              </form>
            </div>
          </section>,
          document.body
        )
      : null;

  const loanImportModal =
    canImportLoans && isImportOpen ? (
      <LoanImportDialog
        isSuperAdmin={user?.role === "super_admin"}
        branches={branches}
        importBranchId={importBranchId}
        setImportBranchId={setImportBranchId}
        branchError={importBranchError}
        onClose={closeImportModal}
        onImported={handleImported}
      />
    ) : null;

  const remarksModal =
    isRemarksOpen && remarkLoan
      ? createPortal(
          <section className="modal-shell">
            <div className="modal-card max-w-2xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">Loan Remarks</h3>
                  <p className="text-xs text-black/70">
                    {remarkLoan.loanAccountNo} | {remarkLoan.memberName}
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
                    <RemarkCategoryOptions />
                  </select>
                </label>
                <textarea
                  className="field"
                  value={remarkInput}
                  onChange={(event) => setRemarkInput(event.target.value)}
                  placeholder={isLoanActionStatus(remarkCategory) ? "Optional note" : "Add a new remark..."}
                  rows={3}
                  required={!isLoanActionStatus(remarkCategory)}
                />
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Attachment (optional, max 5 MB)
                  <input className="field" type="file" onChange={event => setRemarkAttachment(event.target.files?.[0] ?? null)} />
                </label>
                <RemarkPhotoField photo={remarkPhoto} hasExisting={false} onChange={setRemarkPhoto} />
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary">
                    Add Remark
                  </button>
                </div>
              </form>

              {remarkError && <p className="mb-2 text-sm text-red-700">{remarkError}</p>}
              {remarksLoading && <p className="text-sm text-black/70">Loading remarks...</p>}

              <div className="surface-soft max-h-[45vh] overflow-y-auto">
                {remarks.length === 0 && !remarksLoading ? (
                  <p className="p-3 text-sm text-black/60">No remarks yet.</p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {remarks.map((item) => (
                      <li key={item.id} className="cursor-pointer p-3 transition hover:bg-white/60" role="button" tabIndex={0}
                        onClick={() => setSummaryRemark(item)}
                        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSummaryRemark(item); } }}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {getRemarkCategoryLabel(item.remarkCategory)}
                        </p>
                        <p className="text-sm">{item.remark}</p>
                        <p className="mt-1 text-xs text-black/60">
                          {new Date(item.createdAt).toLocaleString()} | By: {item.createdBy}
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

  const paymentModal =
    isPaymentOpen && paymentLoan
      ? createPortal(
          <section className="modal-shell">
            <div className="modal-card max-w-2xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">Add Payments</h3>
                  <p className="text-xs text-black/70">
                    {paymentLoan.loanAccountNo} | {paymentLoan.memberName}
                  </p>
                </div>
                <button type="button" className="btn-muted" onClick={closePaymentModal}>
                  Close
                </button>
              </div>

              <form className="mb-3 grid gap-3 sm:grid-cols-2" onSubmit={handleSubmitPayment}>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Amount
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    placeholder="Enter amount"
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  OR No
                  <input
                    className="field"
                    type="text"
                    value={paymentOrNo}
                    onChange={(event) => setPaymentOrNo(event.target.value)}
                    placeholder="Official receipt number"
                    maxLength={80}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Payment Date/Time
                  <input
                    className="field"
                    type="datetime-local"
                    value={paymentDateTime}
                    onChange={(event) => setPaymentDateTime(event.target.value)}
                    required
                  />
                </label>
                <div className="sm:col-span-2 flex justify-end">
                  <button type="submit" className="btn-primary">
                    Save Payment
                  </button>
                </div>
              </form>

              {paymentError && <p className="mb-2 text-sm text-red-700">{paymentError}</p>}
              {paymentLoading && <p className="text-sm text-black/70">Loading payments...</p>}

              <div className="surface-soft max-h-[45vh] overflow-y-auto">
                {payments.length === 0 && !paymentLoading ? (
                  <p className="p-3 text-sm text-black/60">No payments yet.</p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {payments.map((item) => (
                      <li key={item.id} className="p-3">
                        <p className="text-xs font-semibold text-black/70">{item.paymentId}</p>
                        <p className="text-xs text-black/60">OR No: {item.orNo || "-"}</p>
                        <p className="text-xs text-black/60">Collected By: {item.collectedBy || "System"}</p>
                        <p className="text-sm font-semibold">{formatCurrency(item.amount)}</p>
                        <p className="mt-1 text-xs text-black/60">{formatDateTime(item.collectedAt)}</p>
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

  const deleteLoanModal = (
    <ConfirmDialog
      open={Boolean(loanPendingDelete)}
      tone="danger"
      title="Delete this loan record?"
      description={
        loanPendingDelete
          ? `Loan account ${loanPendingDelete.loanAccountNo} for ${loanPendingDelete.memberName} will be removed from Collections. Its payments and remarks will remain in history.`
          : ""
      }
      confirmLabel={isDeletePending ? "Deleting..." : "Delete Loan"}
      cancelLabel="Cancel"
      disabled={isDeletePending}
      onCancel={() => {
        if (!isDeletePending) {
          setLoanPendingDelete(null);
        }
      }}
      onConfirm={() => void handleConfirmDeleteLoan()}
    />
  );

  const deleteBulkLoanModal = (
    <ConfirmDialog
      open={loanBulkDeleteIds.length > 0}
      tone="danger"
      title="Delete selected loan records?"
      description={
        loanBulkDeleteIds.length > 0
          ? `${loanBulkDeleteIds.length} selected loan record(s) will be removed from Collections. Their payments and remarks will remain in history.`
          : ""
      }
      confirmLabel={isBulkLoanDeletePending ? "Deleting..." : "Delete Selected Loans"}
      cancelLabel="Cancel"
      disabled={isBulkLoanDeletePending}
      onCancel={() => {
        if (!isBulkLoanDeletePending) {
          setLoanBulkDeleteIds([]);
        }
      }}
      onConfirm={() => void handleConfirmBulkLoanDelete()}
    />
  );

  const deleteBulkPaymentModal = (
    <ConfirmDialog
      open={paymentBulkDeleteIds.length > 0}
      tone="danger"
      title="Delete selected payments?"
      description={
        paymentBulkDeleteIds.length > 0
          ? `${paymentBulkDeleteIds.length} selected payment record(s) will be deleted.`
          : ""
      }
      confirmLabel={isBulkPaymentDeletePending ? "Deleting..." : "Delete Selected Payments"}
      cancelLabel="Cancel"
      disabled={isBulkPaymentDeletePending}
      onCancel={() => {
        if (!isBulkPaymentDeletePending) {
          setPaymentBulkDeleteIds([]);
        }
      }}
      onConfirm={() => void handleConfirmBulkPaymentDelete()}
    />
  );

  const loanActionMenu =
    openMenuLoan && activeMenuLoan
      ? createPortal(
          <div
            className="action-menu-popover-floating"
            data-action-menu="loan"
            role="menu"
            style={{
              left: openMenuLoan.left,
              top: openMenuLoan.top,
              transform: openMenuLoan.openUp ? "translate(-100%, -100%)" : "translateX(-100%)"
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="action-menu-item"
              onClick={() => {
                setOpenMenuLoan(null);
                openLoanDetails(activeMenuLoan.id);
              }}
            >
              View Details
            </button>
            {canEditLoans && (
              <button
                type="button"
                className="action-menu-item"
                onClick={() => {
                  setOpenMenuLoan(null);
                  void startEdit(activeMenuLoan);
                }}
              >
                Edit
              </button>
            )}
            {canDeleteLoans && (
              <button
                type="button"
                className="action-menu-item action-menu-item-danger"
                onClick={() => {
                  setOpenMenuLoan(null);
                  handleDeleteLoanRow(activeMenuLoan);
                }}
              >
                Delete
              </button>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <main className="page-shell min-w-0 overflow-x-hidden">
      {loanFormModal}
      {loanImportModal}
      {remarksModal}
      {remarkLoan && summaryRemark && (() => {
        const selectedLoan = loans.find(loan => loan.id === remarkLoan.id);
        return <RemarkSummaryModal open remark={summaryRemark.remark} category={summaryRemark.remarkCategory}
          createdAt={summaryRemark.createdAt} createdBy={summaryRemark.createdBy}
          member={{ name: selectedLoan?.memberName ?? remarkLoan.memberName, cifKey: selectedLoan?.cifKey, contact: selectedLoan?.contactInfo, address: selectedLoan?.address }}
          loan={{ accountNo: remarkLoan.loanAccountNo, type: selectedLoan?.loanType, status: selectedLoan?.status, maturityDate: selectedLoan ? formatDate(selectedLoan.maturityDate) : undefined }}
          attachmentName={summaryRemark.attachmentName}
          photo={summaryRemark.photo}
          photoPath={`/loans/${remarkLoan.id}/remarks/${summaryRemark.id}/photo`}
          onDownload={summaryRemark.attachmentName ? () => void apiDownload(`/loans/${remarkLoan.id}/remarks/${summaryRemark.id}/attachment`, summaryRemark.attachmentName || "attachment").catch(e => setRemarkError(e instanceof Error ? e.message : "Unable to download attachment")) : undefined}
          onClose={() => setSummaryRemark(null)} />;
      })()}
      <ConfirmDialog
        open={remarkDeleteIds.length > 0}
        tone="danger"
        title="Delete selected loans' remarks?"
        description={`Delete all ${remarkDeleteIds.length} loaded remark(s) and their attachments for the selected loans, including older remarks not shown in the list? Loan records and payments will remain. This cannot be undone.`}
        confirmLabel={remarkDeletePending ? "Deleting..." : "Delete Remarks"}
        cancelLabel="Cancel"
        disabled={remarkDeletePending}
        onCancel={() => { if (!remarkDeletePending) setRemarkDeleteIds([]); }}
        onConfirm={() => void deleteSelectedRemarks()}
      />
      {paymentModal}
      {deleteLoanModal}
      {deleteBulkLoanModal}
      {deleteBulkPaymentModal}
      {loanActionMenu}
      {error ? (
        <ToastNotification message={error} tone="error" onClose={() => setError("")} />
      ) : importMessage ? (
        <ToastNotification message={importMessage} tone="success" onClose={() => setImportMessage("")} />
      ) : message ? (
        <ToastNotification message={message} tone="success" onClose={() => setMessage("")} />
      ) : null}

      <PageHeader
        title="Collections"
        eyebrow="Loan Operations"
        actionsTopRight
        actions={<PageMetaStamp />}
      />

      <section className="panel min-w-0 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Collection Records</h2>
            {lastImport ? (
              <p className="mt-1 text-xs text-slate-500">
                Data as of {formatDateTime(lastImport.uploadedAt)}{lastImport.uploadedBy ? ` · uploaded by ${lastImport.uploadedBy}` : ""}
                {lastImport.branch && branchFilterId <= 0 && user?.role === "super_admin" ? ` (${lastImport.branch})` : ""}
              </p>
            ) : latestImportedAt && <p className="mt-1 text-xs text-slate-500">As of: {formatDate(latestImportedAt)}</p>}
          </div>
          {(canAddLoans || canImportLoans) && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {canImportLoans && <button
                type="button"
                className="btn-muted w-full sm:w-auto"
                onClick={openImportModal}
                title="Import loan records from CSV/Excel"
              >
                Import CSV
              </button>}
              {canAddLoans && <button
                type="button"
                className="btn-primary w-full sm:w-auto"
                onClick={() => void openCreateModal()}
                title="Add a new loan"
              >
                Add Loan
              </button>}
            </div>
          )}
        </div>
        {user?.role === "super_admin" && (
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium text-black/80 sm:max-w-xs">
              Branch Filter
              <select
                className="field"
                value={selectedBranchId}
                onChange={(event) => setSelectedBranchId(Number(event.target.value))}
                aria-label="Filter collections by branch"
              >
                <option value={0}>All Branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} - {branch.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {!isCollector && (
          <div className="mb-4 flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Collection records">
            {([
              ["loans", "Loan Records"],
              ["remarks", "Remarks"],
              ["payments", "Payments"],
              ["settled", "Settled Accounts"]
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeRecordsTab === tab}
                className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  activeRecordsTab === tab
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setActiveRecordsTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {activeRecordsTab === "loans" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 md:flex-nowrap">
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-row md:min-w-0 md:flex-1">
                <div className="relative col-span-2 min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="field pl-9"
                    value={loanQuery}
                    onChange={(event) => setLoanQuery(event.target.value)}
                    placeholder="Search loan records"
                  />
                </div>
                <select
                  className={`${collectorFilterClass}field min-w-0 w-full sm:w-52 md:w-44 md:shrink-0`}
                  value={loanTypeFilter}
                  onChange={(event) => setLoanTypeFilter(event.target.value)}
                  aria-label="Filter by loan type"
                >
                  <option value="">All loan types</option>
                  {loanTypeOptions.map((loanType) => <option key={loanType} value={loanType}>{loanType}</option>)}
                </select>
                <select
                  className={`${collectorFilterClass}field min-w-0 w-full sm:w-48 md:w-40 md:shrink-0`}
                  value={parAgeFilter}
                  onChange={(event) => setParAgeFilter(event.target.value)}
                  aria-label="Filter by PAR age"
                >
                  <option value="">All PAR ages</option>
                  <option value="1-30">PAR 1-30</option>
                  <option value="31-60">PAR 31-60</option>
                  <option value="61-90">PAR 61-90</option>
                  <option value="91-180">PAR 91-180</option>
                  <option value="181-365">PAR 181-365</option>
                  <option value="over-365">PAR over 365</option>
                </select>
                <select
                  className={`${collectorFilterClass}field min-w-0 w-full sm:w-44 md:w-40 md:shrink-0`}
                  value={actionStatusFilter}
                  onChange={(event) => setActionStatusFilter(event.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  <option value="none">No action yet</option>
                  {LOAN_ACTION_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </div>
              {canDeleteLoans && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto md:shrink-0 md:flex-nowrap">
                  <button
                    type="button"
                    className="btn-muted w-full sm:w-auto"
                    onClick={() => void selectAllMatchingLoans()}
                    disabled={loanTotal === 0}
                  >
                    Select All Results
                  </button>
                  <button
                    type="button"
                    className="btn-muted w-full sm:w-auto"
                    onClick={() => setSelectedLoanIds([])}
                    disabled={!hasAnyLoanSelection}
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    className="btn-danger w-full sm:w-auto"
                    onClick={handleRequestBulkLoanDelete}
                    disabled={!hasAnyLoanSelection}
                  >
                    Delete Selected ({selectedLoanIds.length})
                  </button>
                </div>
              )}
            </div>
            {isFieldUser ? (
              <div className="mobile-record-list mt-3">
                {paginatedLoans.map((loan) => (
                  <button
                    key={loan.id}
                    type="button"
                    className="collector-loan-list-item text-left"
                    onClick={() => openLoanDetails(loan.id)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{loan.memberName}</p>
                      <p className="mt-1 break-all text-xs text-slate-500">{loan.loanAccountNo}</p>
                      <p className="mt-1 text-xs text-slate-500">{loan.loanType}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {loan.actionStatus
                        ? <span className={actionStatusClass(loan.actionStatus)}>{getRemarkCategoryLabel(loan.actionStatus)}</span>
                        : <span className={loanStatusClass(loan.status)}>{loan.status}</span>}
                      <span className="text-sm font-semibold text-slate-700">{formatCurrency(loan.loanAmount)}</span>
                    </div>
                  </button>
                ))}
                {loanTotal === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No loans found.</p>}
              </div>
            ) : (
              <div className="mobile-record-list mt-3">
                {paginatedLoans.map((loan) => (
                  <article key={loan.id} className="mobile-record-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-slate-900">{loan.memberName}</p>
                        {!isBranchManager && <p className="mt-1 break-all text-xs text-slate-500">Loan Account Number: {loan.loanAccountNo}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {canDeleteLoans && (
                          <input
                            type="checkbox"
                            aria-label={`Select loan ${loan.loanAccountNo}`}
                            checked={selectedLoanIdSet.has(loan.id)}
                            onChange={(event) => toggleLoanSelection(loan.id, event.target.checked)}
                            className="h-4 w-4 accent-brand-600"
                          />
                        )}
                        <span className={loanStatusClass(loan.status)}>{loan.status}</span>
                        {loan.actionStatus && <span className={actionStatusClass(loan.actionStatus)}>{getRemarkCategoryLabel(loan.actionStatus)}</span>}
                      </div>
                    </div>

                    <div className="mobile-record-grid">
                      {!isBranchManager && <LoanRecordField label="Member Code" value={loan.cifKey} />}
                      <LoanRecordField label="Address" value={loan.address || "-"} />
                      <LoanRecordField label="Contact No." value={loan.contactInfo || "-"} />
                      <LoanRecordField label="Loan Product" value={loan.loanType} />
                      <LoanRecordField label="Release Date" value={formatDate(loan.dateRelease)} />
                      <LoanRecordField label="Maturity" value={formatDate(loan.maturityDate)} />
                      <LoanRecordField label="Loan Amount" value={formatCurrency(loan.loanAmount)} />
                      <LoanRecordField label="Loan Balance" value={formatCurrency(loan.loanBalance)} />
                      <LoanRecordField label="Principal Arrears" value={formatCurrency(loan.principalDue)} />
                      <LoanRecordField label="Fines" value={formatCurrency(loan.penaltyDue)} />
                      <LoanRecordField label="Interest" value={formatCurrency(loan.interest)} />
                      <LoanRecordField label="Total" value={formatCurrency(loan.total)} />
                      <LoanRecordField label="PAR Age" value={loan.parAge} />
                      {isBranchManager ? (
                        <LoanRecordField
                          label="Remarks"
                          value={loan.latestRemarks.length
                            ? loan.latestRemarks.map(item => getRemarkCategoryLabel(item.remarkCategory)).join(" | ")
                            : "-"}
                        />
                      ) : (
                        <LoanRecordField label="Notes" value={loan.notes?.trim() ? loan.notes : "-"} />
                      )}
                    </div>

                    <div className="mobile-action-row">
                      <button
                        type="button"
                        className="btn-primary btn-page w-full sm:w-auto"
                        onClick={() => openLoanDetails(loan.id)}
                      >
                        Open Loan
                      </button>
                      {canEditLoans && (
                        <button type="button" className="btn-muted btn-page w-full sm:w-auto" onClick={() => void startEdit(loan)}>
                          Edit
                        </button>
                      )}
                      {canDeleteLoans && (
                        <button type="button" className="btn-danger btn-page w-full sm:w-auto" onClick={() => handleDeleteLoanRow(loan)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {loanTotal === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No loans found.</p>}
              </div>
            )}

            {isCollector && <div className="table-shell mt-3 hidden w-full min-w-0 max-w-full overflow-x-auto lg:block">
              <table className="table-clean w-full text-sm">
                <thead className="sticky top-0 z-10 bg-c1">
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Address</th>
                    <th>Loan Type</th>
                    <th>PAR Age</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLoans.map(loan => <tr key={loan.id} className="cursor-pointer hover:bg-slate-50" tabIndex={0}
                    onClick={() => openLoanDetails(loan.id)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openLoanDetails(loan.id); } }}>
                    <td>{loan.memberName}</td>
                    <td>{loan.contactInfo || "-"}</td>
                    <td>{loan.address || "-"}</td>
                    <td>{loan.loanType || "-"}</td>
                    <td>{loan.parAge}</td>
                    <td>{loan.actionStatus ? <span className={actionStatusClass(loan.actionStatus)}>{getRemarkCategoryLabel(loan.actionStatus)}</span> : <span className="text-xs text-slate-400">No action yet</span>}</td>
                  </tr>)}
                </tbody>
              </table>
              {loanTotal === 0 && <p className="p-3 text-sm text-slate-600">No loans found.</p>}
            </div>}

            <div className={isCollector ? "hidden" : "table-shell loan-records-scroll mt-3 hidden w-full min-w-0 max-w-full overflow-x-auto pb-2 lg:block"}>
              <table className={`table-clean loan-records-table text-xs ${isBranchManager ? "w-[1900px]" : "w-[2200px]"}`}>
                <thead className="sticky top-0 z-10 bg-c1">
                  <tr>
                    {canDeleteLoans && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all loans on current page"
                          checked={allLoanPageSelected}
                          onChange={(event) => toggleLoanPageSelection(event.target.checked)}
                          disabled={!hasLoanPageRows}
                          className="h-4 w-4 accent-brand-600"
                        />
                      </th>
                    )}
                    {canUseLoanActions && <th>Action</th>}
                    {!isBranchManager && <th>Member Code</th>}
                    <th>Member Name</th>
                    <th>Address</th>
                    <th>Contact No.</th>
                    {!isBranchManager && <th>Loan Account Number</th>}
                    <th>Loan Product</th>
                    <th>Release Date</th>
                    <th>Maturity</th>
                    <th>Loan Amount</th>
                    <th>Loan Balance</th>
                    <th>Principal Arrears</th>
                    <th>Interest</th>
                    <th>Fines</th>
                    <th>Total</th>
                    <th>PAR Age</th>
                    <th>Status</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLoans.map((loan) => (
                    <tr
                      key={loan.id}
                      className="cursor-pointer hover:bg-slate-50"
                      tabIndex={0}
                      onClick={() => openLoanDetails(loan.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openLoanDetails(loan.id);
                        }
                      }}
                    >
                      {canDeleteLoans && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select loan ${loan.loanAccountNo}`}
                            checked={selectedLoanIdSet.has(loan.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => toggleLoanSelection(loan.id, event.target.checked)}
                            className="h-4 w-4 accent-brand-600"
                          />
                        </td>
                      )}
                      {canUseLoanActions && <td>
                        <div className="flex w-full justify-center">
                          <div data-action-menu="loan" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="action-menu-trigger"
                              aria-label={`Open actions for loan ${loan.loanAccountNo}`}
                              aria-haspopup="menu"
                              aria-expanded={openMenuLoan?.loanId === loan.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleLoanMenu(event.currentTarget, loan.id);
                              }}
                            >
                              <MoreVertical size={14} />
                            </button>
                          </div>
                        </div>
                      </td>}
                      {!isBranchManager && <td title={loan.cifKey}>
                        <span className="cell-clip">{loan.cifKey}</span>
                      </td>}
                      <td title={loan.memberName}>
                        <span className="cell-clip">{loan.memberName}</span>
                      </td>
                      <td title={loan.address}>
                        <span className="cell-clip">{loan.address}</span>
                      </td>
                      <td title={loan.contactInfo}>
                        <span className="cell-clip">{loan.contactInfo}</span>
                      </td>
                      {!isBranchManager && <td title={loan.loanAccountNo}>
                        <span className="cell-clip">{loan.loanAccountNo}</span>
                      </td>}
                      <td title={loan.loanType}>
                        <span className="cell-clip">{loan.loanType}</span>
                      </td>
                      <td>{new Date(loan.dateRelease).toLocaleDateString()}</td>
                      <td>{new Date(loan.maturityDate).toLocaleDateString()}</td>
                      <td>{formatCurrency(loan.loanAmount)}</td>
                      <td>{formatCurrency(loan.loanBalance)}</td>
                      <td>{formatCurrency(loan.principalDue)}</td>
                      <td>{formatCurrency(loan.interest)}</td>
                      <td>{formatCurrency(loan.penaltyDue)}</td>
                      <td>{formatCurrency(loan.total)}</td>
                      <td>{loan.parAge}</td>
                      <td>{loan.actionStatus ? <span className={actionStatusClass(loan.actionStatus)}>{getRemarkCategoryLabel(loan.actionStatus)}</span> : <span className="text-xs text-slate-400">-</span>}</td>
                      {isBranchManager ? (
                        <td title={loan.latestRemarks.map(item => getRemarkCategoryLabel(item.remarkCategory)).join(" | ")}>
                          {loan.latestRemarks.length ? (
                            <ol className="max-w-[260px] space-y-1 whitespace-normal text-xs text-slate-700">
                              {loan.latestRemarks.map((item, index) => (
                                <li key={`${loan.id}-remark-${index}`} className="line-clamp-2">
                                  <span className="font-semibold text-slate-900">{getRemarkCategoryLabel(item.remarkCategory)}</span>
                                </li>
                              ))}
                            </ol>
                          ) : "-"}
                        </td>
                      ) : (
                        <td title={loan.notes ?? ""}>
                          <span className="cell-clip">{loan.notes ?? ""}</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {loanTotal === 0 && <p className="p-3 text-sm text-slate-600">No loans found.</p>}
            </div>
            <PaginationControls
              currentPage={loanPage}
              totalPages={totalLoanPages}
              totalItems={loanTotal}
              pageSize={rowsPerPage}
              onPageChange={setLoanPage}
            />
          </>
        ) : activeRecordsTab === "settled" ? (
          <SettledAccountsPanel branchId={branchFilterId} />
        ) : activeRecordsTab === "payments" ? (
          <PaymentRecordsPanel
            paymentQuery={paymentQuery}
            setPaymentQuery={setPaymentQuery}
            paginatedPaymentRecords={paginatedPaymentRecords}
            paymentTotal={paymentTotal}
            paymentPage={paymentPage}
            totalPaymentPages={totalPaymentPages}
            rowsPerPage={rowsPerPage}
            setPaymentPage={setPaymentPage}
            canDeletePayments={canDeletePayments}
            selectedPaymentIds={selectedPaymentIds}
            setSelectedPaymentIds={setSelectedPaymentIds}
            togglePaymentSelection={togglePaymentSelection}
            togglePaymentPageSelection={togglePaymentPageSelection}
            selectAllMatchingPayments={selectAllMatchingPayments}
            handleRequestBulkPaymentDelete={handleRequestBulkPaymentDelete}
          />
        ) : (
          <RemarkRecordsPanel
            remarkQuery={remarkQuery}
            setRemarkQuery={setRemarkQuery}
            paginatedRemarkRecords={paginatedRemarkRecords}
            remarkTotal={remarkTotal}
            remarkRecordsPage={remarkRecordsPage}
            totalRemarkPages={totalRemarkPages}
            rowsPerPage={rowsPerPage}
            setRemarkRecordsPage={setRemarkRecordsPage}
            canDeleteRemarks={canDeleteRemarks}
            selectedRemarkLoans={selectedRemarkLoans}
            setSelectedRemarkLoans={setSelectedRemarkLoans}
            toggleRemarkLoan={toggleRemarkLoan}
            selectAllMatchingRemarkLoans={selectAllMatchingRemarkLoans}
            requestRemarkDelete={requestRemarkDelete}
            remarkDeletePending={remarkDeletePending}
            openLoanRemarks={openLoanRemarks}
          />
        )}
      </section>
    </main>
  );
}
