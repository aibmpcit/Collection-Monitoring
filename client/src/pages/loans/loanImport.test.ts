import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildLoanTemplateWorkbook, LOAN_IMPORT_TEMPLATE, mapLoanImportRows, normalizeDate, parseMoney, parseWholeNumber } from "./loanImport";

describe("normalizeDate", () => {
  it.each([
    ["2026-01-15", "2026-01-15"],
    ["2026-1-5", "2026-01-05"],
    ["01/15/2026", "2026-01-15"],
    ["15/01/2026", "2026-01-15"],
    ["46037", "2026-01-15"],
    ["", ""],
    ["not a date", ""]
  ])("reads %j as %j", (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});

describe("number parsing", () => {
  it("accepts thousands separators and blanks", () => {
    expect(parseMoney("50,000.50")).toBe(50000.5);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("abc")).toBe(0);
  });

  it("keeps PAR age a non-negative whole number", () => {
    expect(parseWholeNumber("15.9")).toBe(15);
    expect(parseWholeNumber("-3")).toBe(0);
    expect(parseWholeNumber("1,200")).toBe(1200);
  });
});

describe("mapLoanImportRows", () => {
  const row = {
    "Member Code": "CIF-1",
    "Member Name": "Juan Dela Cruz",
    "Loan Acct. No.": "LN-1",
    "Loan Product": "Salary Loan",
    "Release Date": "2026-01-15",
    "Maturity": "01/15/2027",
    "Loan Amount": "50,000",
    "Principal Arears": "2,500",
    "Fines": "120",
    "PAR Age": "15"
  };

  it("matches headers in any case and spelling the importer accepts", () => {
    const [mapped] = mapLoanImportRows([row]);
    expect(mapped).toMatchObject({
      cifKey: "CIF-1", memberName: "Juan Dela Cruz", loanAccountNo: "LN-1", loanType: "Salary Loan",
      dateRelease: "2026-01-15", maturityDate: "2027-01-15", loanAmount: 50000, principalDue: 2500, penaltyDue: 120, parAge: 15
    });
    expect(mapLoanImportRows([{ " LOAN TYPE ": "Salary", "membercode": "C", "releasedate": "2026-01-01", "maturity date": "2026-12-01" }])[0])
      .toMatchObject({ loanType: "Salary", cifKey: "C" });
  });

  it("marks loans overdue from PAR age unless a status column says otherwise", () => {
    expect(mapLoanImportRows([row])[0].status).toBe("overdue");
    expect(mapLoanImportRows([{ ...row, "PAR Age": "0" }])[0].status).toBe("active");
    expect(mapLoanImportRows([{ ...row, Status: "Fully Paid" }])[0].status).toBe("closed");
  });

  it("drops rows missing a member, loan type or dates", () => {
    expect(mapLoanImportRows([{ ...row, "Member Code": "" }])).toHaveLength(0);
    expect(mapLoanImportRows([{ ...row, "Loan Product": "" }])).toHaveLength(0);
    expect(mapLoanImportRows([{ ...row, "Maturity": "" }])).toHaveLength(0);
  });

  it("adds a branch only when one is given (super admin imports)", () => {
    expect(mapLoanImportRows([row])[0]).not.toHaveProperty("branchId");
    expect(mapLoanImportRows([row], 4)[0].branchId).toBe(4);
    expect(mapLoanImportRows([{ ...row, "Branch ID": "9" }], 4)[0].branchId).toBe(9);
  });
});

describe("loan import template", () => {
  it("puts the blank Loans sheet first, with headers the importer reads back", () => {
    const workbook = buildLoanTemplateWorkbook(XLSX);
    expect(workbook.SheetNames).toEqual(["Loans", "Instructions"]);
    const headers = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Loans, { header: 1 })[0];
    expect(headers).toEqual(LOAN_IMPORT_TEMPLATE.map(([header]) => header));

    // A row filled in using the template's own examples imports cleanly.
    const example = Object.fromEntries(LOAN_IMPORT_TEMPLATE.map(([header, , value]) => [header, value]));
    expect(mapLoanImportRows([example])[0]).toMatchObject({
      cifKey: "CIF-000123", loanAccountNo: "LN-2026-0001", loanType: "Salary Loan", maturityDate: "2027-01-15", parAge: 15, status: "overdue"
    });
  });
});
