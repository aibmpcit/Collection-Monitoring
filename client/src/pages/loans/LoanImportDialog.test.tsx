import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../services/api";
import { LoanImportDialog, type LoanImportResult } from "./LoanImportDialog";
import { splitLoanImportRows } from "./loanImport";

vi.mock("../../services/api", () => ({ apiRequest: vi.fn() }));

const CSV = [
  "Member Code,Member Name,Loan Acct. No.,Loan Product,Release Date,Maturity,PAR Age,Personal Visit,Demand Letter",
  "000123,Ana Cruz,0012345,Salary,01/15/2026,01/15/2027,15,Visited member,",
  ",Missing Code,LN-9,Salary,01/15/2026,01/15/2027,0,,",
  "000456,Ben Reyes,LN-2,Salary,01/15/2026,01/15/2027,0,,Sent letter"
].join("\n");

function csvFile() {
  const buffer = new TextEncoder().encode(CSV).buffer as ArrayBuffer;
  const file = new File([buffer], "altavas-oct15.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
  return file;
}

const result = (overrides: Partial<LoanImportResult> = {}): LoanImportResult => ({
  preview: true, closeMissing: false, inserted: 1, updated: 1, reopened: 0, closed: 0, notInFile: 1, openBefore: 10, skipped: 0, skippedRows: [],
  closedLoans: [{ loanAccountNo: "LN-OLD", memberName: "Old Member" }], remarksImported: 2, remarksDuplicate: 0, remarksInFile: 2, remarksNote: "", ...overrides
});

const branches = [{ id: 2, code: "BR-2", name: "North", address: "" }];

beforeEach(() => vi.mocked(apiRequest).mockReset());

describe("splitLoanImportRows", () => {
  it("reads action taken columns and explains dropped rows with their spreadsheet row", () => {
    const { rows, dropped } = splitLoanImportRows([
      { "Member Code": "C1", "Loan Product": "Salary", "Release Date": "2026-01-01", "Maturity": "2026-12-01", "Personal Visit": "Visited", "Atty’s Final Demand": "Served", __row: 2 },
      { "Member Code": "", "Loan Acct. No.": "LN-9", "Loan Product": "", "Release Date": "", "Maturity": "2026-12-01", __row: 5 }
    ]);
    expect(rows[0]).toMatchObject({ row: 2, remarks: [{ category: "personal_visit", description: "Visited" }, { category: "atty_s_final_demand", description: "Served" }] });
    expect(dropped).toEqual([{ row: 5, loanAccountNo: "LN-9", cifKey: "", reason: "Missing or invalid member code, loan product, release date" }]);
  });
});

describe("LoanImportDialog", () => {
  it("checks the file first, shows what will change, and saves only after confirming", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(result({ closeMissing: true, closed: 1 }))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result({ closeMissing: true, closed: 1 }))
      .mockResolvedValueOnce(result({ preview: false, closeMissing: true, closed: 1 }));
    const onImported = vi.fn();
    const user = userEvent.setup();
    render(<LoanImportDialog isSuperAdmin branches={branches} importBranchId={2} setImportBranchId={vi.fn()} branchError="" onClose={vi.fn()} onImported={onImported} />);

    await user.upload(screen.getByLabelText("Loan spreadsheet"), csvFile());
    await user.click(screen.getByRole("button", { name: "Check File" }));

    expect(await screen.findByText(/Ready to import altavas-oct15.csv into BR-2 - North/)).toBeInTheDocument();
    // By default, loans missing from the updated list move to Settled Accounts.
    expect(screen.getByText(/1 loan\(s\) will move to Settled Accounts/)).toBeInTheDocument();
    expect(screen.getByText(/LN-OLD \(Old Member\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 remark\(s\) will be imported/)).toBeInTheDocument();
    expect(screen.getByText("1 row(s) will be skipped.")).toBeInTheDocument();

    const [, , previewBody] = vi.mocked(apiRequest).mock.calls[0] as [string, string, Record<string, unknown>];
    expect(previewBody).toMatchObject({ preview: true, closeMissing: true, branchId: 2, fileName: "altavas-oct15.csv", rowsInFile: 3 });
    const sent = previewBody.rows as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ cifKey: "000123", loanAccountNo: "0012345", row: 2, remarks: [{ category: "personal_visit", description: "Visited member" }] });
    expect(sent[1]).toMatchObject({ row: 4, remarks: [{ category: "demand_letter", description: "Sent letter" }] });
    expect(onImported).not.toHaveBeenCalled();

    // Unticking (partial file) checks again with missing loans kept open; ticking restores it.
    const option = screen.getByLabelText(/Move loans that are not in this file to Settled Accounts/);
    await user.click(option);
    expect(await screen.findByText(/1 open loan\(s\) are not in this file and will stay open/)).toBeInTheDocument();
    expect((vi.mocked(apiRequest).mock.calls[1][2] as Record<string, unknown>)).toMatchObject({ preview: true, closeMissing: false });
    await user.click(option);
    expect(await screen.findByText(/1 loan\(s\) will move to Settled Accounts/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Import" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("Import complete: 1 new, 1 updated, 1 moved to Settled Accounts, 2 actions taken imported."));
    expect((vi.mocked(apiRequest).mock.calls[3][2] as Record<string, unknown>)).toMatchObject({ preview: false, closeMissing: true });
    expect(screen.getByText(/1 loan\(s\) moved to Settled Accounts/)).toBeInTheDocument();
  });

  it("warns before closing an unusually large share of the branch", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(result({ closeMissing: true, closed: 6, notInFile: 6, openBefore: 10, remarksImported: 0, remarksNote: "Actions taken for this branch were already imported on 2026-10-01 by admin; action taken columns were ignored." }));
    const user = userEvent.setup();
    render(<LoanImportDialog isSuperAdmin={false} branches={[]} importBranchId={0} setImportBranchId={vi.fn()} branchError="" onClose={vi.fn()} onImported={vi.fn()} />);
    await user.upload(screen.getByLabelText("Loan spreadsheet"), csvFile());
    await user.click(screen.getByRole("button", { name: "Check File" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This would move 6 of 10 open loans (60%) to Settled Accounts");
    expect(screen.getByText(/already imported on 2026-10-01/)).toBeInTheDocument();
    expect((vi.mocked(apiRequest).mock.calls[0][2] as Record<string, unknown>)).not.toHaveProperty("branchId");
  });
});
