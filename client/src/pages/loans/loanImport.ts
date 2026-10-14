import { IMPORT_REMARK_CATEGORIES } from "../../constants/remarkCategories";
import type { LoanImportSkipRow } from "./types";

export { loadXlsx } from "../../services/spreadsheet";

export function parseMoney(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseInteger(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWholeNumber(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function normalizeImportedLoanStatus(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!raw) return "active";
  if (["active", "current", "open"].includes(raw)) return "active";
  if (["closed", "paid", "fully paid", "complete", "completed", "settled"].includes(raw)) return "closed";
  if (["overdue", "past due", "pastdue", "delinquent"].includes(raw)) return "overdue";
  return raw;
}

export function formatLoanImportSkipReason(reason: string): string {
  if (reason.includes(":")) return reason;
  return reason.replace(/_/g, " ");
}

export function describeLoanImportSkip(item: LoanImportSkipRow): string {
  const identity = item.loanAccountNo || item.cifKey || (item.loanId > 0 ? `loan ${item.loanId}` : `member ${item.memberId}`);
  return `Row ${item.row}${identity ? ` (${identity})` : ""}: ${formatLoanImportSkipReason(item.reason)}`;
}

// [header, guidance, example]; headers match what mapLoanImportRows reads.
export const LOAN_IMPORT_TEMPLATE: [string, string, string][] = [
  ["Member Code", "Member's CIF / member code", "CIF-000123"],
  ["Member Name", "Full name of the member", "Juan Dela Cruz"],
  ["Address", "Member's address", "Brgy. Poblacion, Altavas"],
  ["Contact No.", "Mobile or phone number", "09171234567"],
  ["Loan Account Number", "Unique loan account number", "LN-2026-0001"],
  ["Loan Product", "Loan type or product name", "Salary Loan"],
  ["Release Date", "Date released (YYYY-MM-DD or MM/DD/YYYY)", "2026-01-15"],
  ["Maturity", "Maturity date (YYYY-MM-DD or MM/DD/YYYY)", "2027-01-15"],
  ["Loan Amount", "Original loan amount, numbers only", "50000"],
  ["Loan Balance", "Remaining balance, numbers only", "32000"],
  ["Principal Arrears", "Principal past due, numbers only", "2500"],
  ["Interest", "Interest due, numbers only", "350"],
  ["Fines", "Penalty / fines due, numbers only", "120"],
  ["Total", "Total amount due, numbers only", "2970"],
  ["PAR Age", "Days past due as a whole number; above 0 marks the loan overdue", "15"],
  // Remark history columns; the server decides whether they are imported (see REMARK_IMPORT_ONCE).
  ...IMPORT_REMARK_CATEGORIES.map(({ label }): [string, string, string] => [
    label, "Optional: what was done or said at this stage. Remarks already in the system are skipped.", ""
  ])
];

export function normalizeDate(value: unknown): string {
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

export interface LoanImportRow {
  loanId: number;
  memberId: number;
  cifKey: string;
  loanAccountNo: string;
  memberName: string;
  contactInfo: string;
  address: string;
  loanType: string;
  dateRelease: string;
  maturityDate: string;
  loanAmount: number;
  loanBalance: number;
  principalDue: number;
  penaltyDue: number;
  interest: number;
  otherCharges: number;
  total: number;
  parAge: number;
  status: string;
  notes: string;
  branchId?: number;
  /** Spreadsheet row number, so skip reasons point at the right line. */
  row?: number;
  /** Filled remark category cells; only used on a branch's first import. */
  remarks: Array<{ category: string; description: string }>;
}

export interface DroppedImportRow {
  row: number;
  loanAccountNo: string;
  cifKey: string;
  reason: string;
}

const headerKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const REMARK_COLUMNS = IMPORT_REMARK_CATEGORIES.map(category => ({ value: category.value, key: headerKey(category.label) }));

function readRemarks(record: Record<string, unknown>) {
  const remarks: LoanImportRow["remarks"] = [];
  for (const [header, cell] of Object.entries(record)) {
    const column = REMARK_COLUMNS.find(item => item.key === headerKey(header));
    const description = String(cell ?? "").trim();
    if (column && description) remarks.push({ category: column.value, description });
  }
  return remarks;
}

function missingFields(row: LoanImportRow) {
  const missing: string[] = [];
  if (!row.cifKey && !(row.memberId > 0)) missing.push("member code");
  if (!row.loanType) missing.push("loan product");
  if (!row.dateRelease) missing.push("release date");
  if (!row.maturityDate) missing.push("maturity date");
  return missing;
}

/**
 * Turns spreadsheet rows (header -> cell) into loan import payloads. Headers are matched
 * case-insensitively with several accepted spellings. Rows missing a member, loan type,
 * release date or maturity date are dropped. `defaultBranchId` (super admins only) fills
 * rows without their own Branch ID column.
 */
export function mapLoanImportRows(rows: Record<string, unknown>[], defaultBranchId?: number): LoanImportRow[] {
  return splitLoanImportRows(rows, defaultBranchId).rows;
}

/** Like mapLoanImportRows, but also explains each row that was left out. */
export function splitLoanImportRows(rows: Record<string, unknown>[], defaultBranchId?: number): { rows: LoanImportRow[]; dropped: DroppedImportRow[] } {
  const mapped = rows
    .map((row): LoanImportRow => {
      const normalized = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), String(value).trim()])
      );

      return {
        loanId: parseInteger(normalized["loan id"] || normalized["loanid"] || 0),
        memberId: parseInteger(normalized["member id"] || normalized["memberid"] || normalized["borrower id"] || normalized["borrowerid"] || 0),
        cifKey: normalized["member code"] || normalized["membercode"] || normalized["cif key"] || normalized["cifkey"] || "",
        loanAccountNo: normalized["loan acct. no."] || normalized["loan acct no"] || normalized["loan account number"] || normalized["loanaccountnumber"] || normalized["loan account no"] || normalized["loanaccountno"] || "",
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
        notes: "",
        ...(defaultBranchId !== undefined
          ? { branchId: parseInteger(normalized["branch id"] || normalized["branchid"] || defaultBranchId) }
          : {}),
        ...(Number(row.__row) > 0 ? { row: Number(row.__row) } : {}),
        remarks: readRemarks(row)
      };
    });
  const dropped: DroppedImportRow[] = [];
  const kept = mapped.filter((row, index) => {
    const missing = missingFields(row);
    if (!missing.length) return true;
    dropped.push({
      row: row.row ?? index + 2,
      loanAccountNo: row.loanAccountNo,
      cifKey: row.cifKey,
      reason: `Missing or invalid ${missing.join(", ")}`
    });
    return false;
  });
  return { rows: kept, dropped };
}

/** Builds the downloadable template: a blank "Loans" sheet first (the one imported), then instructions. */
export function buildLoanTemplateWorkbook(XLSX: typeof import("xlsx")) {
  const workbook = XLSX.utils.book_new();
  const loans = XLSX.utils.aoa_to_sheet([LOAN_IMPORT_TEMPLATE.map(([header]) => header)]);
  loans["!cols"] = LOAN_IMPORT_TEMPLATE.map(([header]) => ({ wch: Math.max(14, header.length + 2) }));
  XLSX.utils.book_append_sheet(workbook, loans, "Loans");
  const guide = XLSX.utils.aoa_to_sheet([["Column", "What to enter", "Example"], ...LOAN_IMPORT_TEMPLATE]);
  guide["!cols"] = [{ wch: 22 }, { wch: 60 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, guide, "Instructions");
  return workbook;
}
