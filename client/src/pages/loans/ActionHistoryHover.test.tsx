import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../services/api";
import { RemarkRecordsPanel } from "./RemarkRecordsPanel";
import type { RemarkGroupRow } from "./types";

vi.mock("../../services/api", () => ({ apiRequest: vi.fn() }));

const recent = (id: number, category: string) => ({ id, kind: "loan_remark" as const, loan_id: 9, loan_account_no: "LN-9", member_id: 4,
  member_name: "Juan Dela Cruz", category, remark: `Note ${id}`, collector_name: "ana", occurred_at: "2026-10-18 09:00:00" });
const row: RemarkGroupRow = { ...recent(3, "visited"), loan_type: "Salary", recentRemarks: [recent(3, "visited"), recent(2, "promised_to_pay")] };

const props = {
  remarkQuery: "", setRemarkQuery: vi.fn(), paginatedRemarkRecords: [row], remarkTotal: 1, remarkRecordsPage: 1, totalRemarkPages: 1,
  rowsPerPage: 15, setRemarkRecordsPage: vi.fn(), canDeleteRemarks: false, selectedRemarkLoans: [], setSelectedRemarkLoans: vi.fn(),
  toggleRemarkLoan: vi.fn(), selectAllMatchingRemarkLoans: vi.fn(), requestRemarkDelete: vi.fn(), remarkDeletePending: false, openLoanRemarks: vi.fn()
};

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockResolvedValue([
    { id: 3, loanId: 9, remark: "Visited the house", remarkCategory: "visited", createdAt: "2026-10-18 09:00:00", createdBy: "ana" },
    { id: 2, loanId: 9, remark: "Will pay Friday", remarkCategory: "promised_to_pay", createdAt: "2026-10-10 14:30:00", createdBy: "ben" },
    { id: 1, loanId: 9, remark: "Sent demand letter", remarkCategory: "others", createdAt: "2026-09-30 08:00:00", createdBy: "System" }
  ]);
});

describe("Actions Taken row hover", () => {
  it("shows every action taken on the loan, not just the two newest", async () => {
    const user = userEvent.setup();
    render(<RemarkRecordsPanel {...props} />);
    const tableRow = screen.getAllByRole("cell", { name: "Juan Dela Cruz" })[0].closest("tr")!;

    await user.hover(tableRow);
    const panel = await screen.findByRole("dialog", { name: "All actions taken on LN-9" });
    expect(apiRequest).toHaveBeenCalledWith("/loans/9/remarks");
    expect(await within(panel).findByText("3 action(s) taken", { exact: false })).toBeInTheDocument();
    expect(within(panel).getByText("Sent demand letter")).toBeInTheDocument();
    expect(within(panel).getByText("By ben")).toBeInTheDocument();
    expect(within(panel).getByText("2026-09-30 08:00")).toBeInTheDocument();

    await user.unhover(tableRow);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // A second hover reuses the loaded list.
    await user.hover(tableRow);
    await screen.findByRole("dialog", { name: "All actions taken on LN-9" });
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("scrolls without closing, and opens an action's summary when clicked", async () => {
    const user = userEvent.setup();
    render(<RemarkRecordsPanel {...props} />);
    await user.hover(screen.getAllByRole("cell", { name: "Juan Dela Cruz" })[0].closest("tr")!);
    const panel = await screen.findByRole("dialog", { name: "All actions taken on LN-9" });
    const entry = await within(panel).findByRole("button", { name: /Open Others from 2026-09-30 08:00/ });

    fireEvent.scroll(entry.closest("ol")!.parentElement!);
    expect(screen.getByRole("dialog", { name: "All actions taken on LN-9" })).toBeInTheDocument();
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "All actions taken on LN-9" })).not.toBeInTheDocument());

    const row = screen.getAllByRole("cell", { name: "Juan Dela Cruz" })[0].closest("tr")!;
    await user.unhover(row);
    await user.hover(row);
    await user.click(await screen.findByRole("button", { name: /Open Others from 2026-09-30 08:00/ }));
    const summary = await screen.findByRole("dialog", { name: "Others" });
    expect(within(summary).getByText("Sent demand letter")).toBeInTheDocument();
    expect(within(summary).getByText("LN-9")).toBeInTheDocument();
    expect(props.openLoanRemarks).not.toHaveBeenCalled();
    await user.click(within(summary).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Others" })).not.toBeInTheDocument();
  });
});
