import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RemarkSummaryModal } from "../../components/RemarkSummaryModal";
import { ToastNotification } from "../../components/ToastNotification";
import { getRemarkCategoryLabel } from "../../constants/remarkCategories";
import { apiDownload, apiRequest } from "../../services/api";
import type { LoanRemark } from "../../types/models";
import { plainDateTime } from "../../services/tableExport";

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 150;
const PANEL_WIDTH = 420;
const PANEL_MAX_HEIGHT = 340;

interface LoanInfo { loanId: number; loanAccountNo: string; memberName: string; loanType?: string | null; cifKey?: string | null }
interface HoverTarget extends LoanInfo { rect: DOMRect }

/**
 * Hovering (or focusing) an Actions Taken row shows every action taken on that loan.
 * Lists load once per loan and are kept while the page is open; the panel stays open while hovered,
 * scrolls on its own, and clicking an action opens its summary.
 */
export function useActionHistoryHover() {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const [lists, setLists] = useState<Record<number, LoanRemark[] | "error">>({});
  const [selected, setSelected] = useState<{ loan: LoanInfo; remark: LoanRemark } | null>(null);
  const [error, setError] = useState("");
  const requested = useRef(new Set<number>());
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();

  useEffect(() => () => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!target) return;
    // Scrolling the page moves the row away, so close; scrolling the list inside the panel doesn't.
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-action-history]")) return;
      setTarget(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [target]);

  function load(loanId: number) {
    if (requested.current.has(loanId)) return;
    requested.current.add(loanId);
    apiRequest<LoanRemark[]>(`/loans/${loanId}/remarks`)
      .then(items => setLists(current => ({ ...current, [loanId]: items })))
      .catch(() => { requested.current.delete(loanId); setLists(current => ({ ...current, [loanId]: "error" })); });
  }

  function show(element: HTMLElement, loan: LoanInfo, immediately = false) {
    if (!loan.loanId) return;
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    const open = () => { load(loan.loanId); setTarget({ ...loan, rect: element.getBoundingClientRect() }); };
    if (immediately) open(); else openTimer.current = window.setTimeout(open, OPEN_DELAY_MS);
  }

  function hide() {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setTarget(null), CLOSE_DELAY_MS);
  }

  /** Props for a table row. */
  function rowProps(loan: LoanInfo) {
    return {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => show(event.currentTarget, loan),
      onMouseLeave: hide,
      onFocus: (event: React.FocusEvent<HTMLElement>) => { if (event.target === event.currentTarget) show(event.currentTarget, loan, true); },
      onBlur: hide
    };
  }

  /** Forget cached lists (after actions are added or deleted). */
  function reset() {
    requested.current.clear();
    setLists({});
  }

  function openSummary(remark: LoanRemark) {
    if (!target) return;
    const { rect: _rect, ...loan } = target;
    window.clearTimeout(closeTimer.current);
    setTarget(null);
    setSelected({ loan, remark });
  }

  const summary = selected && (() => {
    const { loan, remark } = selected;
    const base = `/loans/${loan.loanId}/remarks/${remark.id}`;
    return <RemarkSummaryModal open remark={remark.remark} category={remark.remarkCategory} createdAt={remark.createdAt} createdBy={remark.createdBy}
      member={{ name: loan.memberName, cifKey: loan.cifKey ?? undefined }}
      loan={{ accountNo: loan.loanAccountNo, type: loan.loanType ?? undefined }}
      attachmentName={remark.attachmentName} photo={remark.photo} photoPath={`${base}/photo`}
      onDownload={remark.attachmentName ? () => void apiDownload(`${base}/attachment`, remark.attachmentName || "attachment")
        .catch(e => setError(e instanceof Error ? e.message : "Unable to download attachment")) : undefined}
      onClose={() => setSelected(null)} />;
  })();

  const panel = typeof document === "undefined" ? null : <>
    {target && createPortal(
      <ActionHistoryPanel target={target} items={lists[target.loanId]} onSelect={openSummary}
        onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={hide} />,
      document.body
    )}
    {summary}
    {error && <ToastNotification message={error} tone="error" onClose={() => setError("")} />}
  </>;

  return { rowProps, panel, reset };
}

function ActionHistoryPanel({ target, items, onSelect, onMouseEnter, onMouseLeave }: {
  target: HoverTarget;
  items: LoanRemark[] | "error" | undefined;
  onSelect: (remark: LoanRemark) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // Below the row when there's room, otherwise above it; kept inside the window.
  const below = window.innerHeight - target.rect.bottom >= PANEL_MAX_HEIGHT + 12 || target.rect.top < PANEL_MAX_HEIGHT + 12;
  const left = Math.max(8, Math.min(target.rect.left + target.rect.width / 2 - PANEL_WIDTH / 2, window.innerWidth - PANEL_WIDTH - 8));
  const style: React.CSSProperties = below
    ? { top: target.rect.bottom + 6, left, width: PANEL_WIDTH }
    : { bottom: window.innerHeight - target.rect.top + 6, left, width: PANEL_WIDTH };

  return (
    <div role="dialog" aria-label={`All actions taken on ${target.loanAccountNo}`} style={style} data-action-history
      className="fixed z-[150] rounded-xl border border-slate-200 bg-white shadow-2xl"
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-slate-900">{target.memberName}</p>
        <p className="text-xs text-slate-500">
          {target.loanAccountNo} · {Array.isArray(items) ? `${items.length} action(s) taken` : "All actions taken"}
        </p>
      </div>
      <div className="overflow-y-auto overscroll-contain px-2 py-1.5" style={{ maxHeight: PANEL_MAX_HEIGHT - 60 }}>
        {items === undefined && <p className="py-2 text-sm text-slate-500">Loading...</p>}
        {items === "error" && <p className="py-2 text-sm text-red-700">Couldn't load the actions taken.</p>}
        {Array.isArray(items) && !items.length && <p className="py-2 text-sm text-slate-500">No actions taken yet.</p>}
        {Array.isArray(items) && items.length > 0 && (
          <ol className="divide-y divide-slate-100">
            {items.map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => onSelect(item)}
                  aria-label={`Open ${getRemarkCategoryLabel(item.remarkCategory)} from ${plainDateTime(item.createdAt)}`}
                  className="block w-full rounded-lg px-2 py-2 text-left transition hover:bg-brand-50/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">{getRemarkCategoryLabel(item.remarkCategory)}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{plainDateTime(item.createdAt)}</span>
                  </span>
                  {item.remark && <span className="mt-0.5 block whitespace-pre-line break-words text-sm text-slate-800">{item.remark}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-500">By {item.createdBy || "System"}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
