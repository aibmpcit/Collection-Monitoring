import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../services/api";
import { LoanDetailsPage } from "./LoanDetailsPage";

vi.mock("../services/api", () => ({ apiRequest: vi.fn(), apiDownload: vi.fn(), apiBlobUrl: vi.fn() }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, username: "col1", role: "staff", branchId: 2, permissions: {} } })
}));

const loan = {
  id: 9, borrowerId: 4, loanAccountNo: "LN-9", loanType: "Business Loan", dateRelease: "2026-01-01", maturityDate: "2026-12-01",
  loanAmount: 50000, loanBalance: 20000, principalDue: 10244.02, penaltyDue: 275.38, interest: 549, otherCharges: 0, total: 11068.4,
  parAge: 30, principal: 10244.02, penalty: 275.38, dueDate: "2026-12-01", status: "overdue", actionStatus: null,
  memberName: "Ana Garcia", cifKey: "MC-2026-0004", contactInfo: "09171234567", address: "Poblacion"
};

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path: string) => {
    if (path === "/loans/9") return loan;
    return [];
  });
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/loan-details/9"]}>
    <Routes><Route path="/loan-details/:loanId" element={<LoanDetailsPage />} /></Routes>
  </MemoryRouter>
);

describe("loan details", () => {
  it("shows just the member card until the name is tapped, then all details in a window", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByRole("button", { name: "View loan details for Ana Garcia" });
    expect(card).toHaveTextContent("MC-2026-0004 | Business Loan");
    expect(screen.queryByText("Total Outstanding")).not.toBeInTheDocument();

    await user.click(card);
    const dialog = screen.getByRole("dialog", { name: "Ana Garcia" });
    expect(within(dialog).getByText("Total Outstanding")).toBeInTheDocument();
    expect(within(dialog).getByText("Loan Account No")).toBeInTheDocument();
    expect(within(dialog).getByText("LN-9")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Ana Garcia" })).not.toBeInTheDocument();
  });
});
