import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ExportChoiceDialog } from "./ExportChoiceDialog";
import { PaginationControls } from "./PaginationControls";

describe("PaginationControls", () => {
  it("shows the visible range and moves between pages", async () => {
    const onPageChange = vi.fn();
    render(<PaginationControls currentPage={2} totalPages={3} totalItems={35} pageSize={15} onPageChange={onPageChange} />);
    expect(screen.getByText("Showing 16-30 of 35")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange.mock.calls).toEqual([[3], [1]]);
  });

  it("disables buttons at the ends and hides itself when empty", () => {
    const { rerender, container } = render(<PaginationControls currentPage={1} totalPages={1} totalItems={4} pageSize={15} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    rerender(<PaginationControls currentPage={1} totalPages={1} totalItems={0} pageSize={15} onPageChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ExportChoiceDialog", () => {
  const props = () => ({ title: "Export report", description: "All dates", onExcel: vi.fn(), onPdf: vi.fn(), onClose: vi.fn() });

  it("renders nothing while closed", () => {
    const { container } = render(<ExportChoiceDialog open={false} {...props()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("runs the chosen export and closes", async () => {
    const handlers = props();
    render(<ExportChoiceDialog open {...handlers} />);
    expect(screen.getByRole("dialog", { name: "Export report" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /PDF/ }));
    expect(handlers.onPdf).toHaveBeenCalledTimes(1);
    expect(handlers.onExcel).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("closes on Escape and Cancel without exporting", async () => {
    const handlers = props();
    render(<ExportChoiceDialog open {...handlers} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
    expect(handlers.onExcel).not.toHaveBeenCalled();
    expect(handlers.onPdf).not.toHaveBeenCalled();
  });
});

describe("useDebouncedValue", () => {
  it("only reports a value after it stops changing", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: "a" } });
    rerender({ value: "ab" });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ value: "abc" });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe("abc");
    vi.useRealTimers();
  });
});
