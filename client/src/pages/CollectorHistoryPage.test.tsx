import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../services/api";
import { CollectorHistoryPage } from "./CollectorHistoryPage";

vi.mock("../services/api", () => ({ apiRequest: vi.fn(), apiDownload: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, username: "ana", role: "staff", branchId: 2, permissions: {} } })
}));

const history = {
  items: [
    { id: 1, kind: "payment", occurred_at: "2026-10-15 07:30:00", amount: 1500, or_no: "OR-77", remark: null, category: null,
      loan_id: 9, loan_account_no: "LN-9", member_id: 4, member_name: "Juan Dela Cruz", cif_key: "C-4", collector_name: "ana", branch_name: "North" },
    { id: 2, kind: "loan_remark", occurred_at: "2026-10-15 08:00:00", amount: 0, or_no: null, remark: "Promised to pay on Friday",
      category: "promised_to_pay", loan_id: 9, loan_account_no: "LN-9", member_id: 4, member_name: "Juan Dela Cruz", cif_key: "C-4",
      collector_name: "ana", branch_name: "North", attachment_name: "visit.jpg" }
  ],
  summary: { total: 2, amount: 1500, payments: 1, members: 1, attachments: 1 },
  total: 2, page: 1, pageSize: 15
};

const requests = () => vi.mocked(apiRequest).mock.calls.map(([path]) => String(path));

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockResolvedValue(history);
});

describe("collector history on a phone", () => {
  it("shows totals and one card per activity", async () => {
    render(<MemoryRouter><CollectorHistoryPage /></MemoryRouter>);
    const list = await screen.findByRole("list", { name: "Collection activity" });
    const cards = within(list).getAllByRole("button");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Juan Dela Cruz");
    expect(cards[0]).toHaveTextContent("Receipt: OR-77");
    expect(cards[1]).toHaveTextContent("Promised to pay on Friday");
    expect(cards[1]).toHaveTextContent("Attachment");
    // Collectors see their own work, so cards don't repeat "By ana".
    expect(cards[0]).not.toHaveTextContent("By ana");
    expect(screen.getByText("Total collected")).toBeInTheDocument();
  });

  it("switches between all activity, payments and remarks", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CollectorHistoryPage /></MemoryRouter>);
    await screen.findByRole("list", { name: "Collection activity" });
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Remarks" }));
    await waitFor(() => expect(requests().some(path => path.includes("type=remarks"))).toBe(true));
    expect(screen.getByRole("tab", { name: "Remarks" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the full detail with links to the loan and the attachment", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CollectorHistoryPage /></MemoryRouter>);
    const list = await screen.findByRole("list", { name: "Collection activity" });
    await user.click(within(list).getAllByRole("button")[1]);
    const dialog = screen.getByRole("dialog", { name: "Juan Dela Cruz" });
    expect(within(dialog).getByText("Promised to pay on Friday")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open loan" })).toHaveAttribute("href", "/loan-details/9");
    expect(within(dialog).getByRole("button", { name: /Download visit.jpg/ })).toBeInTheDocument();
  });
});
