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
  // jsdom has no modal dialogs; the forms only need them to open and close.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
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
  it("shows who to reach and what is owed, with the full record in a window", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Ana Garcia" })).toBeInTheDocument();
    expect(screen.getByText("LN-9 | Business Loan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call Ana Garcia" })).toHaveAttribute("href", "tel:09171234567");

    const due = screen.getByRole("region", { name: "Amount due" });
    expect(within(due).getByText("Total outstanding")).toBeInTheDocument();
    expect(within(due).getByText("Penalty")).toBeInTheDocument();
    // The full record stays out of the page until asked for.
    expect(screen.queryByText("Loan Account No")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View all loan details" }));
    const dialog = screen.getByRole("dialog", { name: "Ana Garcia" });
    expect(within(dialog).getByText("Total Outstanding")).toBeInTheDocument();
    expect(within(dialog).getByText("Loan Account No")).toBeInTheDocument();
    expect(within(dialog).getByText("LN-9")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Ana Garcia" })).not.toBeInTheDocument();
  });

  it("gives collectors a + button that shows Add Action Taken and Add Payment when tapped", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Ana Garcia" });
    const bar = screen.getByRole("group", { name: "Record on this loan" });
    // Closed until tapped.
    expect(within(bar).queryByRole("menuitem")).not.toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Add payment or action taken" }));
    expect(within(bar).getByRole("menuitem", { name: "Add Action Taken" })).toBeInTheDocument();
    expect(within(bar).getByRole("menuitem", { name: "Add Payment" })).toBeInTheDocument();

    // Choosing one closes the choices and opens its form.
    await user.click(within(bar).getByRole("menuitem", { name: "Add Payment" }));
    expect(within(bar).queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add Payment" })).toBeInTheDocument();
  });
});
