import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { mapLoanImportRows } from "../pages/loans/loanImport";
import { gridToRecords, preserveLeadingZeros, readSpreadsheet } from "./spreadsheet";

function fileFrom(data: ArrayBuffer | Uint8Array, name: string, type: string) {
  const buffer = data instanceof Uint8Array ? new Uint8Array(data).buffer as ArrayBuffer : data;
  const file = new File([buffer], name, { type });
  Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
  return file;
}

describe("readSpreadsheet", () => {
  it("keeps CSV cells as typed, including leading zeros", async () => {
    const csv = "Member Code,Contact No.,Loan Acct. No.,Release Date,Loan Amount\n000123,09171234567,0012345,01/15/2026,\"50,000\"\n";
    const { grid } = await readSpreadsheet(fileFrom(new TextEncoder().encode(csv), "loans.csv", "text/csv"));
    expect(grid[1]).toEqual(["000123", "09171234567", "0012345", "01/15/2026", "50,000"]);
  });

  it("keeps zeros an Excel cell displays while leaving amounts and dates as numbers", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Member Code", "Contact No.", "Loan Amount", "Release Date"], [123, 9171234567, 50000, 46037]]);
    sheet.A2.z = "000000";
    sheet.B2.z = "00000000000";
    sheet.C2.z = "#,##0.00";
    sheet.D2.z = "mm/dd/yyyy";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Loans");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { grid, texts } = await readSpreadsheet(fileFrom(data, "loans.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    expect(grid[1]).toEqual(["000123", "09171234567", 50000, 46037]);
    expect(texts[1][2]).toBe("50,000.00");
  });

  it("feeds the loan import so codes and contacts arrive intact", async () => {
    const csv = "Member Code,Member Name,Contact No.,Loan Acct. No.,Loan Product,Release Date,Maturity,Loan Amount\n000123,Ana Cruz,09171234567,0012345,Salary,01/15/2026,01/15/2027,\"50,000\"\n";
    const { grid } = await readSpreadsheet(fileFrom(new TextEncoder().encode(csv), "loans.csv", "text/csv"));
    expect(mapLoanImportRows(gridToRecords(grid))[0]).toMatchObject({
      cifKey: "000123", contactInfo: "09171234567", loanAccountNo: "0012345", dateRelease: "2026-01-15", loanAmount: 50000
    });
  });
});

describe("helpers", () => {
  it("only swaps in displayed text for numbers shown with leading zeros", () => {
    expect(preserveLeadingZeros(123, "000123")).toBe("000123");
    expect(preserveLeadingZeros(50000, "50,000.00")).toBe(50000);
    expect(preserveLeadingZeros(0, "0")).toBe(0);
    expect(preserveLeadingZeros("LN-1", "LN-1")).toBe("LN-1");
  });

  it("builds one record per non-blank row keyed by header", () => {
    expect(gridToRecords([["A", "B"], ["1", ""], ["", ""], ["3"]])).toEqual([{ A: "1", B: "", __row: 2 }, { A: "3", B: "", __row: 4 }]);
    expect(gridToRecords([["A"], ["1"]], 3)[0].__row).toBe(4);
  });
});
