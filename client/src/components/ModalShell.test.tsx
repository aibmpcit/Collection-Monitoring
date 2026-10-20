import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModalShell } from "./ModalShell";

describe("ModalShell", () => {
  it("is announced as a dialog and closes on Escape, but not on an outside click (forms)", async () => {
    const onClose = vi.fn();
    render(<ModalShell labelledBy="t" onClose={onClose}><div className="modal-card"><h3 id="t">Add Loan</h3></div></ModalShell>);
    const dialog = screen.getByRole("dialog", { name: "Add Loan" });
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while busy, and closes on outside click when allowed", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<ModalShell labelledBy="t" onClose={onClose} busy><h3 id="t">Import</h3></ModalShell>);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    rerender(<ModalShell labelledBy="t" onClose={onClose} closeOnBackdrop><h3 id="t">Import</h3></ModalShell>);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only the topmost popup: a confirmation over a form", async () => {
    const closeForm = vi.fn();
    const cancelConfirm = vi.fn();
    render(<>
      <ModalShell labelledBy="t" onClose={closeForm}><h3 id="t">Loan Actions Taken</h3></ModalShell>
      <ConfirmDialog open title="Delete this action taken?" onConfirm={vi.fn()} onCancel={cancelConfirm} />
    </>);
    await userEvent.keyboard("{Escape}");
    expect(cancelConfirm).toHaveBeenCalledTimes(1);
    expect(closeForm).not.toHaveBeenCalled();
  });
});
