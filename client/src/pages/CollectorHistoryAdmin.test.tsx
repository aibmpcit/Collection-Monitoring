import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../services/api";
import { CollectorHistoryPage } from "./CollectorHistoryPage";

vi.mock("../services/api", () => ({ apiRequest: vi.fn(), apiDownload: vi.fn() }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 3, username: "manager", role: "branch_admin", branchId: 2, permissions: {} } })
}));

const historyRequests = () => vi.mocked(apiRequest).mock.calls.map(([path]) => String(path)).filter(path => path.startsWith("/collection-history?"));

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("/collection-history")) return { items: [], total: 0, page: 1, pageSize: 20, summary: { total: 0, amount: 0, payments: 0, members: 0, attachments: 0 } };
    if (path === "/staff") return [{ id: 8, username: "ana", role: "staff", branchName: "North" }];
    return [];
  });
});

describe("Collection History toolbar (admins and managers)", () => {
  it("searches as you type, with filters in the Filters popup like Collection Records", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CollectorHistoryPage /></MemoryRouter>);
    await waitFor(() => expect(historyRequests().length).toBeGreaterThan(0));

    // No Search button and no inline filter dropdowns: just search, Filters and Export.
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("User account")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export collection history" })).toBeInTheDocument();
    // This month is the default date filter, counted on the button.
    expect(screen.getByRole("button", { name: "Filters (1 active)" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search activity"), "juan");
    await waitFor(() => expect(historyRequests().some(path => path.includes("search=juan"))).toBe(true));
    expect(historyRequests().some(path => path.includes("search=j&") || path.includes("search=ju&"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Filters (1 active)" }));
    await user.selectOptions(screen.getByLabelText("Filter by date"), "custom");
    await user.clear(screen.getByLabelText("Date from"));
    await user.type(screen.getByLabelText("Date from"), "2026-09-01");
    await user.clear(screen.getByLabelText("Date to"));
    await user.type(screen.getByLabelText("Date to"), "2026-09-15");
    await user.selectOptions(screen.getByLabelText("Filter by user account"), "8");
    await user.selectOptions(screen.getByLabelText("Filter by activity"), "payments");
    await waitFor(() => expect(historyRequests().some(path =>
      path.includes("from=2026-09-01") && path.includes("to=2026-09-15") && path.includes("userId=8") && path.includes("type=payments"))).toBe(true));
    expect(screen.getByRole("button", { name: "Filters (3 active)" })).toBeInTheDocument();

    // "Any date" shows all time: no date range in the request.
    await user.selectOptions(screen.getByLabelText("Filter by date"), "");
    await waitFor(() => {
      const last = historyRequests().at(-1)!;
      expect(last).not.toMatch(/from=|to=/);
    });
  });
});
