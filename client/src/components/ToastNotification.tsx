import { useEffect } from "react";
import { createPortal } from "react-dom";

export function ToastNotification({
  message,
  tone,
  onClose,
  duration = 3000
}: {
  message: string;
  tone: "success" | "error";
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onClose]);

  if (!message || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed right-4 top-4 z-[250] w-[calc(100%-2rem)] max-w-sm" role={tone === "error" ? "alert" : "status"}>
      <div className={`rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
        tone === "error"
          ? "border-red-200 bg-red-50/95 text-red-800"
          : "border-emerald-200 bg-emerald-50/95 text-emerald-800"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide">{tone === "error" ? "Unable to complete" : "Success"}</p>
            <p className="mt-1 break-words text-sm">{message}</p>
          </div>
          <button type="button" className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100" onClick={onClose} aria-label="Close notification">×</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
