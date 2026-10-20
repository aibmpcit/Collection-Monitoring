import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
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
  /**
   * A date filter: quick ranges, months and "Custom range" (which shows From/To dates).
   * Its choice is sent as dateFrom/dateTo (see applyFilters).
   */
  isDate?: boolean;
}

export type FilterValues = Record<string, string>;

const CUSTOM = "custom";

/** Filter icon beside a search box; its filters open in a modal and apply as they change. */
export function FilterButton({ fields, values, onChange }: {
  fields: FilterField[];
  values: FilterValues;
  onChange: (change: FilterValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = fields.filter(field => !field.isSort && values[field.key]).length;
  const hasChanges = fields.some(field => values[field.key]);

  useEscapeToClose(open, () => setOpen(false));

  function clearAll() {
    onChange({ ...Object.fromEntries(fields.map(field => [field.key, ""])), dateFrom: "", dateTo: "" });
  }

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
                <div key={field.key} className={`grid gap-2 ${field.isDate && values[field.key] === CUSTOM && fields.length > 3 ? "sm:col-span-2" : ""}`}>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    {field.label}
                    <select className="field" value={values[field.key] ?? ""}
                      onChange={event => onChange(field.isDate && event.target.value !== CUSTOM
                        ? { [field.key]: event.target.value, dateFrom: "", dateTo: "" }
                        : { [field.key]: event.target.value })}
                      aria-label={field.ariaLabel ?? `Filter by ${field.label.toLowerCase()}`}>
                      <option value="">{field.allLabel}</option>
                      {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      {field.isDate && <option value={CUSTOM}>Custom range...</option>}
                    </select>
                  </label>
                  {field.isDate && values[field.key] === CUSTOM && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        From
                        <input type="date" className="field" value={values.dateFrom ?? ""} max={values.dateTo || undefined}
                          onChange={event => onChange({ dateFrom: event.target.value })} aria-label={`${field.label} from`} />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        To
                        <input type="date" className="field" value={values.dateTo ?? ""} min={values.dateFrom || undefined}
                          onChange={event => onChange({ dateTo: event.target.value })} aria-label={`${field.label} to`} />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-muted" disabled={!hasChanges} onClick={clearAll}>Clear filters</button>
              <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </section>,
        document.body
      )}
    </>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const QUICK_DAYS: Record<string, number> = { today: 0, "7d": 6, "30d": 29, "90d": 89 };

/** First and last day ("YYYY-MM-DD") picked by a date filter's value, or null for "any date". */
export function dateRangeOf(values: FilterValues, key = "date", today = new Date()): { from: string; to: string } | null {
  const value = values[key];
  if (!value) return null;
  if (value === CUSTOM) {
    let from = values.dateFrom ?? "";
    let to = values.dateTo ?? "";
    if (!from && !to) return null;
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  if (value in QUICK_DAYS) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - QUICK_DAYS[value]);
    return { from: isoDate(start), to: isoDate(today) };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (!month) return null;
  const year = Number(month[1]);
  const index = Number(month[2]) - 1;
  return { from: isoDate(new Date(year, index, 1)), to: isoDate(new Date(year, index + 1, 0)) };
}

/** Adds each set filter to the request's query string; a date filter becomes dateFrom/dateTo. */
export function applyFilters(params: URLSearchParams, values: FilterValues, dateKey = "date") {
  for (const [key, value] of Object.entries(values)) {
    if (!value || key === dateKey || key === "dateFrom" || key === "dateTo") continue;
    params.set(key, value);
  }
  const range = dateRangeOf(values, dateKey);
  if (range?.from) params.set("dateFrom", range.from);
  if (range?.to) params.set("dateTo", range.to);
  return params;
}

/** Quick ranges, then the last 12 months by name (newest first), for a date filter. */
export function dateFilterOptions(today = new Date()): Array<readonly [string, string]> {
  const months = Array.from({ length: 12 }, (_, offset) => {
    const month = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    return [`${month.getFullYear()}-${pad(month.getMonth() + 1)}`, month.toLocaleDateString("en-US", { month: "long", year: "numeric" })] as const;
  });
  return [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ...months];
}

/** Plain words for a date filter's choice, for export headers. */
export function describeDate(values: FilterValues, key = "date") {
  const range = dateRangeOf(values, key);
  if (!range) return "";
  if (values[key] === CUSTOM) return range.from && range.to ? `${range.from} to ${range.to}` : range.from ? `from ${range.from}` : `until ${range.to}`;
  return dateFilterOptions().find(([value]) => value === values[key])?.[1] ?? `${range.from} to ${range.to}`;
}
