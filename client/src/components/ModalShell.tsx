import type { ReactNode } from "react";
import { useEscapeToClose } from "../hooks/useEscapeToClose";

/**
 * The shared modal backdrop (`.modal-shell`): announced as a dialog, closes on Escape (not while
 * `busy`). Forms leave `closeOnBackdrop` off so a stray click outside can't discard what was typed.
 * Render it through createPortal(…, document.body) so nothing on the page can clip or offset it.
 */
export function ModalShell({ labelledBy, onClose, busy = false, closeOnBackdrop = false, className = "", children }: {
  /** id of the modal's title. */
  labelledBy: string;
  onClose: () => void;
  busy?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  useEscapeToClose(true, onClose, busy);
  return (
    <section className={`modal-shell ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
      onMouseDown={event => { if (closeOnBackdrop && !busy && event.target === event.currentTarget) onClose(); }}>
      {children}
    </section>
  );
}
