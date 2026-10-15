import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../services/api";
import { SettledAccountsPage } from "./SettledAccountsPage";

vi.mock("../services/api", () => ({ apiRequest: vi.fn() }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 3, username: "manager", role: "branch_admin", branchId: 2, permissions: {} } })
}));

const settled = {
  id: 9, borrowerId: 4, branchId: 2, cifKey: "C-4", memberName: "Juan Dela Cruz", contactInfo: "", address: "",
  loanAccountNo: "LN-9", loanType: "Salary", dateRelease: "2026-01-01", maturityDate: "2026-12-01", loanAmount: 50000,
  loanBalance: 1200, principalDue: 0, penaltyDue: 0, interest: 0, otherCharges: 0, total: 0, parAge: 0, status: "closed",
  notes: "", importedAt: "", latestRemarks: [], actionStatus: "settled", closedReason: "not_in_import", closedAt: "2026-10-15 07:05:00"
};

const requests = () => vi.mocked(apiRequest).mock.calls.map(([path]) => String(path));

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockResolvedValue({ items: [settled], total: 1, page: 1, pageSize: 15, loanTypes: [], latestImportedAt: "" });
});

describe("Settled Accounts", () => {
  it("lists loans that dropped off the uploaded list and opens their details", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/settled"]}>
      <Routes>
        <Route path="/settled" element={<SettledAccountsPage />} />
        <Route path="/loan-details/:loanId" element={<p>Loan details page</p>} />
      </Routes>
    </MemoryRouter>);
    const list = await screen.findByRole("list", { name: "Settled accounts" });
    expect(requests()[0]).toBe("/loans?settled=true&page=1&pageSize=15");
    expect(screen.getByText("1 settled account(s)")).toBeInTheDocument();
    const card = within(list).getByRole("button");
    expect(card).toHaveTextContent("Juan Dela Cruz");
    expect(card).toHaveTextContent("LN-9");
    expect(card).toHaveTextContent("Settled");
    await user.click(card);
    expect(await screen.findByText("Loan details page")).toBeInTheDocument();
  });

  it("searches on the server", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SettledAccountsPage /></MemoryRouter>);
    await screen.findByRole("list", { name: "Settled accounts" });
    await user.type(screen.getByLabelText("Search settled accounts"), "juan");
    await waitFor(() => expect(requests().some(path => path.includes("settled=true") && path.includes("search=juan"))).toBe(true));
  });
});
