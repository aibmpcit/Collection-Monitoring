import { MoreVertical, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DEFAULT_REMARK_CATEGORY, getRemarkCategoryLabel, REMARK_CATEGORIES, type RemarkCategory } from "../constants/remarkCategories";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { RemarkSummaryModal } from "../components/RemarkSummaryModal";
import { ToastNotification } from "../components/ToastNotification";
import { useAuth } from "../context/AuthContext";
import { apiDownload, apiRequest } from "../services/api";
import { fileToAttachment } from "../services/attachments";
import type { Borrower, Branch, LoanPayload, LoanPayment, LoanRemark } from "../types/models";

interface LoanRow extends LoanPayload {
  id: number;
  branchId?: number;
  cifKey: string;
  memberName: string;
  contactInfo: string;
  address: string;
  importedAt: string;
  latestRemarks: Array<{ remark: string; remarkCategory: string }>;
}

interface PaymentRecordRow {
  id: number;
  paymentId: string;
  loanId: number;
  branchId?: number;
  loanAccountNo: string;
  cifKey: string;
  memberName: string;
  amount: number;
  orNo: string;
  collectedBy: string;
  collectedAt: string;
}

interface RemarkRecordRow {
  id: number;
  kind: "loan_remark" | "member_remark";
  branch_id?: number;
  branch_name?: string | null;
  loan_id?: number | null;
  loan_account_no?: string | null;
  loan_type?: string | null;
  loan_status?: string | null;
  maturity_date?: string | null;
  member_id: number;
  member_name: string;
  cif_key?: string | null;
  contact_info?: string | null;
  address?: string | null;
  category?: string | null;
  remark: string;
  collector_name?: string | null;
  occurred_at: string;
  attachment_name?: string | null;
}

interface LoanQuickRef {
  id: number;
  loanAccountNo: string;
  memberName: string;
}

interface LoanImportSkipRow {
  row: number;
  loanId: number;
  memberId: number;
  loanAccountNo: string;
  cifKey: string;
  reason: string;
}

let xlsxLoader: Promise<typeof import("xlsx")> | null = null;

function loadXlsx() {
  xlsxLoader ??= import("xlsx");
  return xlsxLoader;
}

function parseMoney(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWholeNumber(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeImportedLoanStatus(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!raw) return "active";
  if (["active", "current", "open"].includes(raw)) return "active";
  if (["closed", "paid", "fully paid", "complete", "completed", "settled"].includes(raw)) return "closed";
  if (["overdue", "past due", "pastdue", "delinquent"].includes(raw)) return "overdue";
  return raw;
}

function formatLoanImportSkipReason(reason: string): string {
  if (reason.includes(":")) return reason;
  return reason.replace(/_/g, " ");
}

function describeLoanImportSkip(item: LoanImportSkipRow): string {
  const identity = item.loanAccountNo || item.cifKey || (item.loanId > 0 ? `loan ${item.loanId}` : `member ${item.memberId}`);
  return `Row ${item.row}${identity ? ` (${identity})` : ""}: ${formatLoanImportSkipReason(item.reason)}`;
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 0) {
      const utcDays = Math.floor(serial - 25569);
      const utcValue = utcDays * 86400 * 1000;
      const parsed = new Date(utcValue);
      if (!Number.isNaN(parsed.getTime())) {
        const y = parsed.getUTCFullYear();
        const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
        const d = String(parsed.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, first, second] = isoMatch;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const month = firstNumber > 12 && secondNumber <= 12 ? second : first;
    const day = firstNumber > 12 && secondNumber <= 12 ? first : second;
    return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (slashMatch) {
    const [, first, second, y] = slashMatch;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const month = firstNumber > 12 && secondNumber <= 12 ? second : first;
    const day = firstNumber > 12 && secondNumber <= 12 ? first : second;
    return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return "";
}

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

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

const EMPTY_FORM: LoanPayload = {
  borrowerId: 0,
  loanAccountNo: "",
  loanType: "",
  dateRelease: "",
  maturityDate: "",
  loanAmount: 0,
  loanBalance: 0,
  principalDue: 0,
  penaltyDue: 0,
  interest: 0,
  otherCharges: 0,
  total: 0,
  parAge: 0,
  status: "active",
  notes: ""
};

function computeRowsPerPage(viewportHeight: number): number {
  // Reserve space for header, tabs, search, messages, and pagination.
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

function loanStatusClass(status: string): string {
  if (status === "overdue") return "status-danger";
  if (status === "closed") return "status-warning";
  return "status-success";
}

function LoanRecordField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mobile-record-field">
      <p className="mobile-record-label">{label}</p>
      <div className="mobile-record-value">{value}</div>
    </div>
  );
}

export function LoansPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isCollector = user?.role === "staff";
  const isBranchManager = user?.role === "branch_admin";
  const canAddLoans = user?.role === "super_admin" || user?.role === "branch_admin";
  const canEditLoans = user?.role === "super_admin" || user?.role === "branch_admin";
  const canDeleteLoans = user?.role === "super_admin" || user?.role === "branch_admin";
  const canDeletePayments = user?.role === "super_admin" || user?.role === "branch_admin";
  const canUseLoanActions = canEditLoans;
  const [members, setMembers] = useState<Borrower[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [form, setForm] = useState<LoanPayload>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isRemarksOpen, setIsRemarksOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importBranchError, setImportBranchError] = useState("");
  const [loanImportFile, setLoanImportFile] = useState<File | null>(null);
  const [loanImportInputKey, setLoanImportInputKey] = useState(0);
  const [isImportPending, setIsImportPending] = useState(false);
  const [remarkLoan, setRemarkLoan] = useState<Pick<LoanRow, "id" | "loanAccountNo" | "memberName"> | null>(null);
  const [remarks, setRemarks] = useState<LoanRemark[]>([]);
  const [remarkInput, setRemarkInput] = useState("");
  const [remarkCategory, setRemarkCategory] = useState<RemarkCategory>(DEFAULT_REMARK_CATEGORY);
  const [remarkAttachment, setRemarkAttachment] = useState<File | null>(null);
  const [summaryRemark, setSummaryRemark] = useState<LoanRemark | null>(null);
  const [remarksLoading, setRemarksLoading] = useState(false);
  const [remarkError, setRemarkError] = useState("");
  const [loanQuery, setLoanQuery] = useState("");
  const [loanTypeFilter, setLoanTypeFilter] = useState("");
  const [parAgeFilter, setParAgeFilter] = useState("");
  const [activeRecordsTab, setActiveRecordsTab] = useState<"loans" | "payments" | "remarks">(
    !isCollector && (searchParams.get("tab") === "payments" || searchParams.get("tab") === "remarks")
      ? searchParams.get("tab") as "payments" | "remarks"
      : "loans"
  );
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecordRow[]>([]);
  const [paymentQuery, setPaymentQuery] = useState("");
  const [remarkRecords, setRemarkRecords] = useState<RemarkRecordRow[]>([]);
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
  const [mobileLoanPreview, setMobileLoanPreview] = useState<LoanRow | null>(null);
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

  const filteredLoans = useMemo(() => {
    const q = loanQuery.trim().toLowerCase();
    const matches = loans.filter((loan) => {
      if (loan.status === "closed") return false;
      const matchesBranch = user?.role !== "super_admin" || selectedBranchId <= 0 || Number(loan.branchId ?? 0) === selectedBranchId;
      if (!matchesBranch) return false;
      if (loanTypeFilter && loan.loanType !== loanTypeFilter) return false;
      if (parAgeFilter) {
        const parAge = Number(loan.parAge ?? 0);
        const matchesParAge =
          parAgeFilter === "1-30" ? parAge >= 1 && parAge <= 30 :
          parAgeFilter === "31-60" ? parAge >= 31 && parAge <= 60 :
          parAgeFilter === "61-90" ? parAge >= 61 && parAge <= 90 :
          parAgeFilter === "91-180" ? parAge >= 91 && parAge <= 180 :
          parAgeFilter === "181-365" ? parAge >= 181 && parAge <= 365 :
          parAgeFilter === "over-365" ? parAge > 365 : true;
        if (!matchesParAge) return false;
      }
      if (!q) return true;

      return [
        loan.cifKey,
        loan.loanAccountNo,
        loan.memberName,
        loan.loanType,
        loan.status,
        loan.contactInfo,
        loan.address,
        loan.notes ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    return [...matches].sort(
      (a, b) => a.memberName.localeCompare(b.memberName, undefined, { sensitivity: "base" }) || a.loanAccountNo.localeCompare(b.loanAccountNo, undefined, { sensitivity: "base" })
    );
  }, [loanQuery, loanTypeFilter, loans, parAgeFilter, selectedBranchId, user?.role]);

  const loanTypeOptions = useMemo(() => {
    const types = loans
      .filter((loan) => user?.role !== "super_admin" || selectedBranchId <= 0 || Number(loan.branchId ?? 0) === selectedBranchId)
      .map((loan) => loan.loanType.trim())
      .filter(Boolean);
    return [...new Set(types)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [loans, selectedBranchId, user?.role]);

  const latestImportedAt = useMemo(() => {
    return loans.reduce<string>((latest, loan) => {
      const currentTime = new Date(loan.importedAt).getTime();
      const latestTime = latest ? new Date(latest).getTime() : Number.NEGATIVE_INFINITY;
      return Number.isNaN(currentTime) || currentTime <= latestTime ? latest : loan.importedAt;
    }, "");
  }, [loans]);

  const filteredPaymentRecords = useMemo(() => {
    const q = paymentQuery.trim().toLowerCase();
    const matches = paymentRecords.filter((row) => {
      const matchesBranch = user?.role !== "super_admin" || selectedBranchId <= 0 || Number(row.branchId ?? 0) === selectedBranchId;
      if (!matchesBranch) return false;
      if (!q) return true;

      return [
        row.paymentId,
        row.orNo ?? "",
        row.collectedBy ?? "",
        row.loanAccountNo,
        row.cifKey,
        row.memberName,
        String(row.amount),
        row.collectedAt
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    return [...matches].sort(
      (a, b) => a.memberName.localeCompare(b.memberName, undefined, { sensitivity: "base" }) || a.paymentId.localeCompare(b.paymentId, undefined, { sensitivity: "base" })
    );
  }, [paymentQuery, paymentRecords, selectedBranchId, user?.role]);

  const filteredRemarkRecords = useMemo(() => {
    const q = remarkQuery.trim().toLowerCase();
    const grouped = new Map<number, { latest: RemarkRecordRow; recent: RemarkRecordRow[]; matchesQuery: boolean }>();
    for (const row of remarkRecords) {
      if (row.kind !== "loan_remark" || !row.loan_id || !row.remark.trim()) continue;
      if (user?.role === "super_admin" && selectedBranchId > 0 && Number(row.branch_id ?? 0) !== selectedBranchId) continue;
      const matchesQuery = !q || [row.member_name, row.loan_account_no ?? "", row.loan_type ?? "", getRemarkCategoryLabel(row.category), row.remark, row.collector_name ?? ""].join(" ").toLowerCase().includes(q);
      const group = grouped.get(row.loan_id);
      if (!group) {
        grouped.set(row.loan_id, { latest: row, recent: [row], matchesQuery });
      } else {
        group.recent = [...group.recent, row]
          .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime() || b.id - a.id)
          .slice(0, 2);
        group.matchesQuery ||= matchesQuery;
        if (new Date(row.occurred_at).getTime() > new Date(group.latest.occurred_at).getTime() ||
            (row.occurred_at === group.latest.occurred_at && row.id > group.latest.id)) group.latest = row;
      }
    }
    return [...grouped.values()]
      .filter(group => group.matchesQuery)
      .map(group => ({ ...group.latest, recentRemarks: group.recent }))
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime() || b.id - a.id);
  }, [remarkQuery, remarkRecords, selectedBranchId, user?.role]);

  useEffect(() => {
    setSelectedRemarkLoans([]);
  }, [selectedBranchId, remarkRecords]);

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

  const totalLoanPages = Math.max(1, Math.ceil(filteredLoans.length / rowsPerPage));
  const totalPaymentPages = Math.max(1, Math.ceil(filteredPaymentRecords.length / rowsPerPage));
  const totalRemarkPages = Math.max(1, Math.ceil(filteredRemarkRecords.length / rowsPerPage));

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
  }, [loanQuery, loanTypeFilter, parAgeFilter]);

  useEffect(() => {
    setPaymentPage(1);
  }, [paymentQuery]);

  useEffect(() => {
    setRemarkRecordsPage(1);
  }, [remarkQuery]);

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
    if (!isCollector && (requestedTab === "payments" || requestedTab === "remarks")) {
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

  const paginatedLoans = useMemo(() => {
    const start = (loanPage - 1) * rowsPerPage;
    return filteredLoans.slice(start, start + rowsPerPage);
  }, [filteredLoans, loanPage, rowsPerPage]);

  const paginatedPaymentRecords = useMemo(() => {
    const start = (paymentPage - 1) * rowsPerPage;
    return filteredPaymentRecords.slice(start, start + rowsPerPage);
  }, [filteredPaymentRecords, paymentPage, rowsPerPage]);

  const paginatedRemarkRecords = useMemo(() => {
    const start = (remarkRecordsPage - 1) * rowsPerPage;
    return filteredRemarkRecords.slice(start, start + rowsPerPage);
  }, [filteredRemarkRecords, remarkRecordsPage, rowsPerPage]);
  const selectedLoanIdSet = useMemo(() => new Set(selectedLoanIds), [selectedLoanIds]);
  const selectedPaymentIdSet = useMemo(() => new Set(selectedPaymentIds), [selectedPaymentIds]);
  const paginatedLoanIds = useMemo(() => paginatedLoans.map((loan) => loan.id), [paginatedLoans]);
  const paginatedPaymentIds = useMemo(() => paginatedPaymentRecords.map((row) => row.id), [paginatedPaymentRecords]);
  const filteredLoanIds = useMemo(() => filteredLoans.map((loan) => loan.id), [filteredLoans]);
  const filteredPaymentIds = useMemo(() => filteredPaymentRecords.map((row) => row.id), [filteredPaymentRecords]);
  const hasAnyLoanSelection = selectedLoanIds.length > 0;
  const hasAnyPaymentSelection = selectedPaymentIds.length > 0;
  const hasLoanPageRows = paginatedLoanIds.length > 0;
  const hasPaymentPageRows = paginatedPaymentIds.length > 0;
  const allLoanPageSelected = hasLoanPageRows && paginatedLoanIds.every((id) => selectedLoanIdSet.has(id));
  const allPaymentPageSelected = hasPaymentPageRows && paginatedPaymentIds.every((id) => selectedPaymentIdSet.has(id));

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

  async function loadLoans() {
    const loanData = await apiRequest<LoanRow[]>("/loans");
    setLoans(loanData);
  }

  async function loadData() {
    const [memberData, loanData, paymentsData, branchData, remarksData] = await Promise.all([
      apiRequest<Borrower[]>("/borrowers"),
      apiRequest<LoanRow[]>("/loans"),
      apiRequest<PaymentRecordRow[]>("/payments").catch(() => []),
      apiRequest<Branch[]>("/branches").catch(() => []),
      apiRequest<{ items: RemarkRecordRow[] }>("/collection-history?type=remarks&export=true").catch(() => ({ items: [] }))
    ]);
    setMembers(memberData);
    setMembersNeedRefresh(false);
    setLoans(loanData);
    setPaymentRecords(paymentsData);
    setBranches(branchData);
    setRemarkRecords(remarksData.items);
  }

  async function refreshLoanImportData() {
    await loadLoans();
    setMembersNeedRefresh(true);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setSelectedLoanIds((current) => current.filter((id) => loans.some((loan) => loan.id === id)));
  }, [loans]);

  useEffect(() => {
    setSelectedPaymentIds((current) => current.filter((id) => paymentRecords.some((row) => row.id === id)));
  }, [paymentRecords]);

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

  function handleLoanFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setLoanImportFile(file);
    setError("");
    setImportMessage("");
  }

  async function handleLoanFileUpload() {
    const file = loanImportFile;
    if (!file) return;

    setError("");
    setImportMessage("");
    setIsImportPending(true);

    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const mappedRows = rows
        .map((row) => {
          const normalized = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), String(value).trim()])
          );

          return {
            loanId: parseInteger(normalized["loan id"] || normalized["loanid"] || 0),
            memberId: parseInteger(normalized["member id"] || normalized["memberid"] || normalized["borrower id"] || normalized["borrowerid"] || 0),
            cifKey: normalized["member code"] || normalized["membercode"] || normalized["cif key"] || normalized["cifkey"] || "",
            loanAccountNo: normalized["loan account number"] || normalized["loanaccountnumber"] || normalized["loan account no"] || normalized["loanaccountno"] || "",
            memberName: normalized["member name"] || normalized["membername"] || "",
            contactInfo: normalized["contact no."] || normalized["contact no"] || normalized["contactno"] || normalized["contact info"] || normalized["contactinfo"] || "",
            address: normalized["address"] || "",
            loanType: normalized["loan product"] || normalized["loanproduct"] || normalized["loan type"] || normalized["loantype"] || "",
            dateRelease: normalizeDate(normalized["release date"] || normalized["releasedate"] || normalized["date release"] || normalized["daterelease"] || ""),
            maturityDate: normalizeDate(normalized["maturity"] || normalized["maturity date"] || normalized["maturitydate"] || ""),
            loanAmount: parseMoney(normalized["loan amount"] || normalized["loanamount"] || 0),
            loanBalance: parseMoney(normalized["loan balance"] || normalized["loanbalance"] || 0),
            principalDue: parseMoney(normalized["principal arears"] || normalized["principal arrears"] || normalized["principalarrears"] || normalized["principal due"] || normalized["principaldue"] || 0),
            penaltyDue: parseMoney(normalized["fines"] || normalized["penalty due"] || normalized["penaltydue"] || 0),
            interest: parseMoney(normalized["interest"] || 0),
            otherCharges: parseMoney(normalized["other charges"] || normalized["othercharges"] || 0),
            total: parseMoney(normalized["total"] || 0),
            parAge: parseWholeNumber(normalized["par age"] || normalized["parage"] || 0),
            status: normalized["status"]
              ? normalizeImportedLoanStatus(normalized["status"])
              : parseWholeNumber(normalized["par age"] || normalized["parage"] || 0) > 0 ? "overdue" : "active",
            notes: normalized["remarks"] || normalized["notes"] || "",
            ...(user?.role === "super_admin"
              ? {
                  branchId: parseInteger(normalized["branch id"] || normalized["branchid"] || importBranchId)
                }
              : {})
          };
        })
        .filter((row) => (row.cifKey || row.memberId > 0) && row.loanType && row.dateRelease && row.maturityDate);

      if (mappedRows.length === 0) {
        throw new Error("No valid loan rows found in file");
      }

      const result = await apiRequest<{ inserted: number; updated: number; skipped: number; skippedRows?: LoanImportSkipRow[] }>(
        "/loans/bulk",
        "POST",
        {
        rows: mappedRows
        }
      );

      setImportMessage(`Loan import complete: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped.`);
      if ((result.skippedRows?.length ?? 0) > 0) {
        const preview = result.skippedRows!.slice(0, 3).map(describeLoanImportSkip).join("; ");
        const hidden = result.skippedRows!.length > 3 ? ` and ${result.skippedRows!.length - 3} more.` : "";
        setError(`Skipped ${result.skippedRows!.length} row(s): ${preview}${hidden}`);
      }
      setLoanImportFile(null);
      setLoanImportInputKey((current) => current + 1);
      setIsImportOpen(false);
      setIsImportPending(false);
      void refreshLoanImportData().catch((refreshError) => {
        setError(refreshError instanceof Error ? refreshError.message : "Import finished but list refresh failed");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to import loan file");
    } finally {
      setIsImportPending(false);
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
    if (!canAddLoans) return;
    setError("");
    setMessage("");
    setImportBranchError("");
    setLoanImportFile(null);
    setLoanImportInputKey((current) => current + 1);
    void loadXlsx();
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
    if (isImportPending) return;
    setLoanImportFile(null);
    setLoanImportInputKey((current) => current + 1);
    setIsImportOpen(false);
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
    setRemarks([]);
    setRemarkError("");
  }

  async function handleAddRemark(event: React.FormEvent) {
    event.preventDefault();
    if (!remarkLoan) return;
    const remark = remarkInput.trim();
    if (!remark) return;

    setRemarkError("");
    try {
      const attachment = await fileToAttachment(remarkAttachment);
      await apiRequest(`/loans/${remarkLoan.id}/remarks`, "POST", { remark, remarkCategory, attachment });
      setRemarkInput("");
      setRemarkAttachment(null);
      await loadRemarks(remarkLoan.id);
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

  function openMobileLoanPreview(loan: LoanRow) {
    setMobileLoanPreview(loan);
  }

  function closeMobileLoanPreview() {
    setMobileLoanPreview(null);
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

  const mobileLoanPreviewModal =
    user?.role === "staff" && mobileLoanPreview
      ? createPortal(
          <section className="modal-shell" onClick={closeMobileLoanPreview}>
            <div className="modal-card max-w-xl" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">{mobileLoanPreview.memberName}</h3>
                  <p className="mt-1 break-all text-xs text-slate-500">{mobileLoanPreview.loanAccountNo}</p>
                </div>
                <button type="button" className="btn-muted" onClick={closeMobileLoanPreview}>
                  Close
                </button>
              </div>

              <div className="mb-3 flex items-center justify-between gap-2">
                <span className={loanStatusClass(mobileLoanPreview.status)}>{mobileLoanPreview.status}</span>
                <p className="text-sm font-semibold text-slate-700">{formatCurrency(mobileLoanPreview.loanAmount)}</p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <LoanRecordField label="CIF Key" value={mobileLoanPreview.cifKey} />
                <LoanRecordField label="Loan Type" value={mobileLoanPreview.loanType} />
                <LoanRecordField label="Date Release" value={formatDate(mobileLoanPreview.dateRelease)} />
                <LoanRecordField label="Maturity Date" value={formatDate(mobileLoanPreview.maturityDate)} />
                <LoanRecordField label="Loan Amount" value={formatCurrency(mobileLoanPreview.loanAmount)} />
                <LoanRecordField label="Loan Balance" value={formatCurrency(mobileLoanPreview.loanBalance)} />
                <LoanRecordField label="Principal Arrears" value={formatCurrency(mobileLoanPreview.principalDue)} />
                <LoanRecordField label="Fines" value={formatCurrency(mobileLoanPreview.penaltyDue)} />
                <LoanRecordField label="Interest" value={formatCurrency(mobileLoanPreview.interest)} />
                <LoanRecordField label="Total" value={formatCurrency(mobileLoanPreview.total)} />
                <LoanRecordField label="PAR Age" value={mobileLoanPreview.parAge} />
                <LoanRecordField label="Contact" value={mobileLoanPreview.contactInfo || "-"} />
                <div className="col-span-2">
                  <LoanRecordField label="Address" value={mobileLoanPreview.address || "-"} />
                </div>
                <div className="col-span-2">
                  <LoanRecordField label="Notes" value={mobileLoanPreview.notes?.trim() ? mobileLoanPreview.notes : "-"} />
                </div>
              </div>

              <div className="mobile-action-row">
                <button
                  type="button"
                  className="btn-primary btn-page w-full sm:w-auto"
                  onClick={() => {
                    closeMobileLoanPreview();
                    openLoanDetails(mobileLoanPreview.id);
                  }}
                >
                  Open Loan
                </button>
                <button
                  type="button"
                  className="btn-muted btn-page w-full sm:w-auto"
                  onClick={() => {
                    closeMobileLoanPreview();
                    void openRemarksModal(mobileLoanPreview);
                  }}
                >
                  Remarks
                </button>
                <button
                  type="button"
                  className="btn-muted btn-page w-full sm:w-auto"
                  onClick={() => {
                    closeMobileLoanPreview();
                    void openPaymentModal(mobileLoanPreview);
                  }}
                >
                  Add Payments
                </button>
              </div>
            </div>
          </section>,
          document.body
        )
      : null;

  const loanImportModal =
    canAddLoans && isImportOpen
      ? createPortal(
          <section className="modal-shell">
            <div className="modal-card max-w-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">Import Loans</h3>
                <button type="button" className="btn-muted" onClick={closeImportModal} disabled={isImportPending}>
                  Close
                </button>
              </div>

              <div className="surface-soft grid gap-3 border-dashed border-black/20 p-3" aria-busy={isImportPending}>
                <Upload size={16} className="text-black/60" />
                <div className="flex flex-wrap items-center gap-2">
                  {user?.role === "super_admin" && (
                    <select
                      className="field w-56"
                      value={importBranchId}
                      onChange={(event) => setImportBranchId(Number(event.target.value))}
                      aria-label="Select branch for loan import"
                      disabled={isImportPending}
                    >
                      <option value={0}>Select import branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.code} - {branch.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    key={loanImportInputKey}
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    onChange={handleLoanFileSelect}
                    className="text-sm"
                    disabled={isImportPending}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleLoanFileUpload()}
                    disabled={isImportPending || !loanImportFile || (user?.role === "super_admin" && importBranchId <= 0)}
                  >
                    {isImportPending ? "Importing..." : "Import Loans"}
                  </button>
                </div>
                <p className="text-xs text-black/70">
                  {loanImportFile ? `Selected file: ${loanImportFile.name}` : "Choose a CSV or Excel file, then click Import Loans."}
                </p>
                {importBranchError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{importBranchError}</p>}
                {isImportPending && (
                  <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Import in progress</span>
                      <span className="text-xs uppercase tracking-wide text-amber-700/80">Working</span>
                    </div>
                    <div className="import-progress-track" role="progressbar" aria-label="Loan import in progress" aria-valuetext="Importing loan records">
                      <div className="import-progress-bar" />
                    </div>
                    <p>Uploading loan records and refreshing the list. Please keep this window open.</p>
                  </div>
                )}
                <p className="text-xs text-black/60">Bulk upload CSV/Excel columns: Member Code, Member Name, Address, Contact No., Loan Account Number, Loan Product, Release Date, Maturity, Loan Amount, Loan Balance, Principal Arrears, Interest, Fines, Total, PAR Age, and Remarks.</p>
              </div>
            </div>
          </section>,
          document.body
        )
      : null;

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
                  placeholder="Add a new remark..."
                  rows={3}
                  required
                />
                <label className="grid gap-1 text-sm font-medium text-black/80">
                  Attachment (optional, max 5 MB)
                  <input className="field" type="file" onChange={event => setRemarkAttachment(event.target.files?.[0] ?? null)} />
                </label>
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
      {mobileLoanPreviewModal}
      {remarksModal}
      {remarkLoan && summaryRemark && (() => {
        const selectedLoan = loans.find(loan => loan.id === remarkLoan.id);
        return <RemarkSummaryModal open remark={summaryRemark.remark} category={summaryRemark.remarkCategory}
          createdAt={summaryRemark.createdAt} createdBy={summaryRemark.createdBy}
          member={{ name: selectedLoan?.memberName ?? remarkLoan.memberName, cifKey: selectedLoan?.cifKey, contact: selectedLoan?.contactInfo, address: selectedLoan?.address }}
          loan={{ accountNo: remarkLoan.loanAccountNo, type: selectedLoan?.loanType, status: selectedLoan?.status, maturityDate: selectedLoan ? formatDate(selectedLoan.maturityDate) : undefined }}
          attachmentName={summaryRemark.attachmentName}
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
        actions={<PageMetaStamp />}
      />

      <section className="panel min-w-0 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Collection Records</h2>
            {latestImportedAt && <p className="mt-1 text-xs text-slate-500">As of: {formatDate(latestImportedAt)}</p>}
          </div>
          {canAddLoans && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <button
                type="button"
                className="btn-muted w-full sm:w-auto"
                onClick={openImportModal}
                title="Import loan records from CSV/Excel"
              >
                Import CSV
              </button>
              <button
                type="button"
                className="btn-primary w-full sm:w-auto"
                onClick={() => void openCreateModal()}
                title="Add a new loan"
              >
                Add Loan
              </button>
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
              ["payments", "Payments"]
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
              <div className="flex w-full flex-col gap-2 sm:flex-row md:min-w-0 md:flex-1">
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="field pl-9"
                    value={loanQuery}
                    onChange={(event) => setLoanQuery(event.target.value)}
                    placeholder="Search loan records"
                  />
                </div>
                <select
                  className="field w-full sm:w-52 md:w-44 md:shrink-0"
                  value={loanTypeFilter}
                  onChange={(event) => setLoanTypeFilter(event.target.value)}
                  aria-label="Filter by loan type"
                >
                  <option value="">All loan types</option>
                  {loanTypeOptions.map((loanType) => <option key={loanType} value={loanType}>{loanType}</option>)}
                </select>
                <select
                  className="field w-full sm:w-48 md:w-40 md:shrink-0"
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
              </div>
              {canDeleteLoans && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto md:shrink-0 md:flex-nowrap">
                  <button
                    type="button"
                    className="btn-muted w-full sm:w-auto"
                    onClick={() => setSelectedLoanIds(filteredLoanIds)}
                    disabled={filteredLoanIds.length === 0}
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
            {user?.role === "staff" ? (
              <div className="mobile-record-list mt-3">
                {paginatedLoans.map((loan) => (
                  <button
                    key={loan.id}
                    type="button"
                    className="collector-loan-list-item text-left"
                    onClick={() => openMobileLoanPreview(loan)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{loan.memberName}</p>
                      <p className="mt-1 break-all text-xs text-slate-500">{loan.loanAccountNo}</p>
                      <p className="mt-1 text-xs text-slate-500">{loan.loanType}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className={loanStatusClass(loan.status)}>{loan.status}</span>
                      <span className="text-sm font-semibold text-slate-700">{formatCurrency(loan.loanAmount)}</span>
                    </div>
                  </button>
                ))}
                {filteredLoans.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No loans found.</p>}
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
                {filteredLoans.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No loans found.</p>}
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
                  </tr>)}
                </tbody>
              </table>
              {filteredLoans.length === 0 && <p className="p-3 text-sm text-slate-600">No loans found.</p>}
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
              {filteredLoans.length === 0 && <p className="p-3 text-sm text-slate-600">No loans found.</p>}
            </div>
            <PaginationControls
              currentPage={loanPage}
              totalPages={totalLoanPages}
              totalItems={filteredLoans.length}
              pageSize={rowsPerPage}
              onPageChange={setLoanPage}
            />
          </>
        ) : activeRecordsTab === "payments" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full max-w-sm">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="field pl-9"
                  value={paymentQuery}
                  onChange={(event) => setPaymentQuery(event.target.value)}
                  placeholder="Search payments"
                />
              </div>
              {canDeletePayments && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <button
                    type="button"
                    className="btn-muted w-full sm:w-auto"
                    onClick={() => setSelectedPaymentIds(filteredPaymentIds)}
                    disabled={filteredPaymentIds.length === 0}
                  >
                    Select All Results
                  </button>
                  <button
                    type="button"
                    className="btn-muted w-full sm:w-auto"
                    onClick={() => setSelectedPaymentIds([])}
                    disabled={!hasAnyPaymentSelection}
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    className="btn-danger w-full sm:w-auto"
                    onClick={handleRequestBulkPaymentDelete}
                    disabled={!hasAnyPaymentSelection}
                  >
                    Delete Selected ({selectedPaymentIds.length})
                  </button>
                </div>
              )}
            </div>
            <div className="mobile-record-list mt-3">
              {paginatedPaymentRecords.map((row) => (
                <article key={row.id} className="mobile-record-card cursor-pointer transition hover:bg-slate-50" tabIndex={0}
                      onClick={() => navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`)}
                      onKeyDown={event => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`);
                        }
                      }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-slate-900">{row.memberName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.paymentId} | {row.loanAccountNo}
                      </p>
                    </div>
                    {canDeletePayments && (
                      <input
                        type="checkbox"
                        aria-label={`Select payment ${row.paymentId}`}
                        onClick={event => event.stopPropagation()}
                        checked={selectedPaymentIdSet.has(row.id)}
                        onChange={(event) => togglePaymentSelection(row.id, event.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                      />
                    )}
                  </div>

                  <div className="mobile-record-grid">
                    <LoanRecordField label="OR No" value={row.orNo || "-"} />
                    <LoanRecordField label="Collected By" value={row.collectedBy || "System"} />
                    <LoanRecordField label="Amount" value={formatCurrency(row.amount)} />
                    <LoanRecordField label="Collected At" value={formatDateTime(row.collectedAt)} />
                  </div>
                </article>
              ))}
              {filteredPaymentRecords.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No payments found.</p>}
            </div>

            <div className="table-shell loan-records-scroll mt-3 hidden w-full min-w-0 max-w-full overflow-x-auto pb-2 lg:block">
              <table className="table-clean w-[1050px] text-xs">
                <thead className="sticky top-0 z-10 bg-c1">
                  <tr>
                    {canDeletePayments && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all payments on current page"
                          checked={allPaymentPageSelected}
                          onChange={(event) => togglePaymentPageSelection(event.target.checked)}
                          disabled={!hasPaymentPageRows}
                          className="h-4 w-4 accent-brand-600"
                        />
                      </th>
                    )}
                    <th>Payment ID</th>
                    <th>OR No</th>
                    <th>Collected By</th>
                    <th>Loan Account No</th>
                    <th>Member Name</th>
                    <th>Amount</th>
                    <th>Collected At</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPaymentRecords.map((row) => (
                    <tr key={row.id} className="cursor-pointer transition hover:bg-slate-50" tabIndex={0}
                      onClick={() => navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`)}
                      onKeyDown={event => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/loan-details/${row.loanId}?tab=payments&from=payments&paymentId=${row.id}`);
                        }
                      }}>
                      {canDeletePayments && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select payment ${row.paymentId}`}
                        onClick={event => event.stopPropagation()}
                            checked={selectedPaymentIdSet.has(row.id)}
                            onChange={(event) => togglePaymentSelection(row.id, event.target.checked)}
                            className="h-4 w-4 accent-brand-600"
                          />
                        </td>
                      )}
                      <td>{row.paymentId}</td>
                      <td>{row.orNo || "-"}</td>
                      <td>{row.collectedBy || "System"}</td>
                      <td>{row.loanAccountNo}</td>
                      <td>{row.memberName}</td>
                      <td>{formatCurrency(row.amount)}</td>
                      <td>{formatDateTime(row.collectedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPaymentRecords.length === 0 && <p className="p-3 text-sm text-slate-600">No payments found.</p>}
            </div>
            <PaginationControls
              currentPage={paymentPage}
              totalPages={totalPaymentPages}
              totalItems={filteredPaymentRecords.length}
              pageSize={rowsPerPage}
              onPageChange={setPaymentPage}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="field pl-9"
                value={remarkQuery}
                onChange={(event) => setRemarkQuery(event.target.value)}
                placeholder="Search remarks"
              />
            </div>

            {canDeleteRemarks && <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-muted" disabled={!filteredRemarkRecords.length} onClick={() => setSelectedRemarkLoans(filteredRemarkRecords.map(row => Number(row.loan_id)))}>Select All Results</button>
              <button type="button" className="btn-muted" disabled={!selectedRemarkLoans.length} onClick={() => setSelectedRemarkLoans([])}>Clear Selection</button>
              <button type="button" className="btn-danger" disabled={!selectedRemarkLoans.length || remarkDeletePending} onClick={() => setRemarkDeleteIds(remarkRecords.filter(row => row.kind === "loan_remark" && selectedRemarkLoans.includes(Number(row.loan_id))).map(row => row.id))}>Delete Selected ({selectedRemarkLoans.length})</button>
            </div>}
            </div>

            <div className="mobile-record-list mt-3">
              {paginatedRemarkRecords.map((row) => (
                <article
                  key={`${row.kind}-${row.id}`}
                  className="mobile-record-card cursor-pointer transition hover:bg-white"
                  role="button"
                  tabIndex={0}
                  onClick={() => openLoanRemarks(row)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openLoanRemarks(row);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">{canDeleteRemarks && <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select remarks for ${row.loan_account_no}`} checked={selectedRemarkLoans.includes(Number(row.loan_id))} onClick={event => event.stopPropagation()} onChange={event => toggleRemarkLoan(Number(row.loan_id), event.target.checked)} />}
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-slate-900">{row.member_name}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {row.loan_type || "-"}
                      </p>
                    </div>
                  </div>
                  <ul className="mt-3 flex items-center gap-2 overflow-x-auto text-xs text-slate-800">
                    {row.recentRemarks.map(remark => (
                      <li key={remark.id} className="shrink-0">
                        <button
                          type="button"
                          className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 transition hover:border-brand-600 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                          aria-label={`View ${getRemarkCategoryLabel(remark.category)} remark for ${row.loan_account_no}`}
                          onClick={event => {
                            event.stopPropagation();
                            openLoanRemarks(remark);
                          }}
                        >
                          {getRemarkCategoryLabel(remark.category)}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mobile-record-grid">
                    <LoanRecordField label="Loan Account No" value={row.loan_account_no || "-"} />
                    <LoanRecordField label="Added By" value={row.collector_name || "System"} />
                  </div>
                </article>
              ))}
              {filteredRemarkRecords.length === 0 && <p className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">No loans with remarks found.</p>}
            </div>

            <div className="table-shell loan-records-scroll mt-3 hidden w-full min-w-0 max-w-full overflow-x-auto pb-2 lg:block">
              <table className="table-clean w-full min-w-[900px] text-xs">
                <thead className="sticky top-0 z-10 bg-c1">
                  <tr>
                    {canDeleteRemarks && <th><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label="Select all remarks on current page" disabled={!paginatedRemarkRecords.length} checked={paginatedRemarkRecords.length > 0 && paginatedRemarkRecords.every(row => selectedRemarkLoans.includes(Number(row.loan_id)))} onChange={event => { const ids = paginatedRemarkRecords.map(row => Number(row.loan_id)); setSelectedRemarkLoans(current => event.target.checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id))); }} /></th>}
                    <th>Member Name</th>
                    <th>Loan Account No</th>
                    <th>Loan Type</th>
                    <th>Remarks</th>
                    <th>Added By</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRemarkRecords.map((row) => (
                    <tr
                      key={`${row.kind}-${row.id}`}
                      className="cursor-pointer transition hover:bg-slate-50"
                      tabIndex={0}
                      onClick={() => openLoanRemarks(row)}
                      onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openLoanRemarks(row);
                        }
                      }}
                    >
                      {canDeleteRemarks && <td>{canDeleteRemarks && <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select remarks for ${row.loan_account_no}`} checked={selectedRemarkLoans.includes(Number(row.loan_id))} onClick={event => event.stopPropagation()} onChange={event => toggleRemarkLoan(Number(row.loan_id), event.target.checked)} />}</td>}
                      <td>{row.member_name}</td>
                      <td>{row.loan_account_no || "-"}</td>
                      <td>{row.loan_type || "-"}</td>
                      <td className="whitespace-nowrap">
                        <ul className="flex items-center justify-center gap-2">
                          {row.recentRemarks.map(remark => (
                            <li key={remark.id} className="shrink-0">
                        <button
                          type="button"
                          className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 transition hover:border-brand-600 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                          aria-label={`View ${getRemarkCategoryLabel(remark.category)} remark for ${row.loan_account_no}`}
                          onClick={event => {
                            event.stopPropagation();
                            openLoanRemarks(remark);
                          }}
                        >
                          {getRemarkCategoryLabel(remark.category)}
                        </button>
                      </li>
                          ))}
                        </ul>
                      </td>
                      <td>{row.collector_name || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRemarkRecords.length === 0 && <p className="p-3 text-sm text-slate-600">No loans with remarks found.</p>}
            </div>
            <PaginationControls
              currentPage={remarkRecordsPage}
              totalPages={totalRemarkPages}
              totalItems={filteredRemarkRecords.length}
              pageSize={rowsPerPage}
              onPageChange={setRemarkRecordsPage}
            />
          </>
        )}
      </section>
    </main>
  );
}
