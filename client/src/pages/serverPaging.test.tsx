import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../services/api";
import { DashboardPage } from "./DashboardPage";
import { LoansPage } from "./LoansPage";
import { OverdueReportPage } from "./OverdueReportPage";

vi.mock("../services/api", () => ({ apiRequest: vi.fn(), apiDownload: vi.fn() }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 3, username: "manager", role: "branch_admin", branchId: 2, permissions: {} } })
}));

const loan = (id: number) => ({
  id, borrowerId: id, branchId: 2, cifKey: `CIF-${id}`, memberName: `Member ${id}`, contactInfo: "", address: "",
  loanAccountNo: `LN-${id}`, loanType: "Salary", dateRelease: "2026-01-01", maturityDate: "2026-12-01", loanAmount: 1000,
  loanBalance: 500, principalDue: 100, penaltyDue: 0, interest: 10, otherCharges: 0, total: 110, parAge: 0, status: "active",
  notes: "", importedAt: "2026-10-01T09:00:00", latestRemarks: [], actionStatus: id === 101 ? "visited" : null
});

const requests = () => vi.mocked(apiRequest).mock.calls.map(([path]) => String(path));
const loanPageRequests = () => requests().filter(path => path.startsWith("/loans?") && path.includes("page="));

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path.startsWith("/loans?") && path.includes("idsOnly=true")) return { ids: [1, 2, 3] };
    if (path.startsWith("/loans?")) {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return { items: [loan(page * 100 + 1)], total: 40, page, pageSize: 15, loanTypes: ["Salary"], latestImportedAt: "2026-10-01T09:00:00" };
    }
    if (path.startsWith("/payments?") && path.includes("sort=recent")) {
      return { items: [{ id: 1, paymentId: "PAY-000001", loanId: 1, loanAccountNo: "LN-1", memberName: "Payer One", amount: 300, collectedAt: "2026-10-14 09:00:00" }], total: 1, page: 1, pageSize: 7 };
    }
    if (path.startsWith("/payments?")) return { items: [], total: 0, page: 1, pageSize: 15 };
    if (path.startsWith("/loans/remarked?")) return { items: [], total: 0, page: 1, pageSize: 15 };
    if (path.startsWith("/loans/due-soon?")) {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return { items: [{ ...loan(page), daysUntilDue: page, outstanding: 110 }], total: 12, page, pageSize: 8 };
    }
    if (path === "/reports/overdue") return [];
    if (path === "/dashboard/metrics") return { totalPortfolio: 5000, totalOverdue: 1200, collectionsToday: 300, activeLoans: 6, overdueLoans: 2 };
    if (path === "/analytics/overview") return { overdueRate: 25, collectionEfficiency: 50, activeLoans: 8 };
    return [];
  });
});

describe("Collections page", () => {
  it("asks the server for one page of loans instead of the whole list", async () => {
    render(<MemoryRouter><LoansPage /></MemoryRouter>);
    expect((await screen.findAllByText("Member 101")).length).toBeGreaterThan(0);
    expect(loanPageRequests()[0]).toBe("/loans?page=1&pageSize=15");
    expect(requests()).not.toContain("/loans");
    expect(requests()).not.toContain("/payments");
    expect(screen.getAllByText("Showing 1-15 of 40").length).toBeGreaterThan(0);
  });

  it("pages, searches and filters on the server", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansPage /></MemoryRouter>);
    await screen.findAllByText("Member 101");

    await user.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect((await screen.findAllByText("Member 201")).length).toBeGreaterThan(0);
    expect(loanPageRequests()).toContain("/loans?page=2&pageSize=15");

    await user.type(screen.getByPlaceholderText("Search loan records"), "ana");
    await waitFor(() => expect(loanPageRequests().some(path => path.includes("search=ana") && path.includes("page=1"))).toBe(true));
    // Typing is debounced: no request is sent for the partial words.
    expect(loanPageRequests().some(path => path.includes("search=a&") || path.includes("search=an&"))).toBe(false);

    await user.selectOptions(screen.getByLabelText("Filter by PAR age"), "31-60");
    await waitFor(() => expect(loanPageRequests().some(path => path.includes("parAge=31-60"))).toBe(true));
  });

  it("selects every matching loan across pages for bulk delete", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansPage /></MemoryRouter>);
    await screen.findAllByText("Member 101");
    await user.click(screen.getByRole("button", { name: "Select All Results" }));
    expect(await screen.findByRole("button", { name: "Delete Selected (3)" })).toBeEnabled();
    expect(requests()).toContain("/loans?idsOnly=true");
  });
});

describe("Collections loan status", () => {
  it("shows each loan's field status and filters by it on the server", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansPage /></MemoryRouter>);
    await screen.findAllByText("Member 101");
    expect(screen.getAllByText("Visited").length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("Filter by status"), "none");
    await waitFor(() => expect(loanPageRequests().some(path => path.includes("actionStatus=none") && path.includes("page=1"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Filter by status"), "settled");
    await waitFor(() => expect(loanPageRequests().some(path => path.includes("actionStatus=settled"))).toBe(true));
  });
});

describe("Collections settled accounts tab", () => {
  it("shows settled accounts in their own tab", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansPage /></MemoryRouter>);
    await screen.findAllByText("Member 101");
    await user.click(screen.getByRole("tab", { name: "Settled Accounts" }));
    expect(screen.getByRole("tab", { name: "Settled Accounts" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(requests()).toContain("/loans?settled=true&page=1&pageSize=15"));
    expect(await screen.findByRole("list", { name: "Settled accounts" })).toBeInTheDocument();
  });
});

describe("Due Monitoring page", () => {
  it("pages upcoming accounts on the server", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OverdueReportPage /></MemoryRouter>);
    expect((await screen.findAllByText("Member 1")).length).toBeGreaterThan(0);
    expect(requests()).toContain("/loans/due-soon?page=1&pageSize=8");
    expect(screen.getByText("12 upcoming account(s)")).toBeInTheDocument();
    const nextButtons = screen.getAllByRole("button", { name: "Next" });
    await user.click(nextButtons[nextButtons.length - 1]);
    expect((await screen.findAllByText("Member 2")).length).toBeGreaterThan(0);
    expect(requests()).toContain("/loans/due-soon?page=2&pageSize=8");
    expect(requests()).not.toContain("/loans");
  });
});

describe("Dashboard", () => {
  it("uses server counts, the latest payments and a paged due-soon list", async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText("8 total account(s)")).toBeInTheDocument();
    expect((await screen.findAllByText("Payer One")).length).toBeGreaterThan(0);
    expect(await screen.findByText("12 upcoming account(s)")).toBeInTheDocument();
    expect(requests()).toContain("/payments?page=1&pageSize=7&sort=recent&openLoansOnly=true");
    expect(requests()).toContain("/loans/due-soon?page=1&pageSize=8");
    expect(requests()).not.toContain("/loans");
    expect(requests()).not.toContain("/payments");
  });
});
