import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface FilterField {
  key: string;
  label: string;
  /** Text of the empty choice, e.g. "All loan types". */
  allLabel: string;
  options: ReadonlyArray<readonly [string, string]>;
  /** Defaults to "Filter by <label>". */
  ariaLabel?: string;
  /** Sorting changes the order, not what's shown, so it isn't counted as an active filter. */
  isSort?: boolean;
}

export type FilterValues = Record<string, string>;

/** Filter icon beside a search box; its filters open in a modal and apply as they change. */
export function FilterButton({ fields, values, onChange }: {
  fields: FilterField[];
  values: FilterValues;
  onChange: (change: FilterValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = fields.filter(field => !field.isSort && values[field.key]).length;
  const hasChanges = fields.some(field => values[field.key]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700"
        aria-label={active ? `Filters (${active} active)` : "Filters"}
        title="Filters"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        {active > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white">{active}</span>
        )}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <section className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="filters-title"
          onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className={`modal-card max-h-[90vh] overflow-y-auto ${fields.length > 3 ? "max-w-2xl" : "max-w-md"}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 id="filters-title" className="text-lg font-semibold">Filters</h2>
              <button type="button" className="btn-muted" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className={`mt-4 grid gap-3 ${fields.length > 3 ? "sm:grid-cols-2" : ""}`}>
              {fields.map(field => (
                <label key={field.key} className="grid gap-1 text-sm font-medium text-slate-700">
                  {field.label}
                  <select className="field" value={values[field.key] ?? ""} onChange={event => onChange({ [field.key]: event.target.value })}
                    aria-label={field.ariaLabel ?? `Filter by ${field.label.toLowerCase()}`}>
                    <option value="">{field.allLabel}</option>
                    {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-muted" disabled={!hasChanges}
                onClick={() => onChange(Object.fromEntries(fields.map(field => [field.key, ""])))}>Clear filters</button>
              <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </section>,
        document.body
      )}
    </>
  );
}

/** Adds each set filter to the request's query string. */
export function applyFilters(params: URLSearchParams, values: FilterValues) {
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params;
}

export const PERIOD_OPTIONS = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]] as const;
