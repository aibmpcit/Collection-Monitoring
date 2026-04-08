import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

type ConfirmTone = "danger" | "warning";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  disabled = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const isDanger = tone === "danger";
  const Icon = isDanger ? AlertTriangle : ShieldAlert;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !disabled) {
        onCancel();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disabled, onCancel, open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.section
          className="fixed inset-0 z-[130] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !disabled) {
              onCancel();
            }
          }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            className={`relative w-full max-w-md overflow-hidden rounded-3xl border ${
              isDanger ? "border-rose-200/80" : "border-amber-200/80"
            } bg-white p-0 shadow-[0_28px_80px_rgba(2,6,23,0.26)]`}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 270, damping: 26 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={`absolute inset-x-0 top-0 h-1.5 ${
                isDanger ? "bg-gradient-to-r from-rose-500 via-orange-500 to-rose-500" : "bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-500"
              }`}
            />
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    isDanger ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  <Icon size={20} />
                </span>
                <div>
                  <h3 id={titleId} className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                    {title}
                  </h3>
                  {description && (
                    <p id={descId} className="mt-1 text-sm leading-relaxed text-slate-600">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-muted" onClick={onCancel} disabled={disabled}>
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  className={isDanger ? "btn-danger" : "btn-primary"}
                  onClick={onConfirm}
                  disabled={disabled}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.section>
      )}
    </AnimatePresence>,
    document.body
  );
}
