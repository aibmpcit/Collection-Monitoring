import "./env.js";

// Every stored date/time is wall-clock time in the business timezone (Philippines by default).
// MySQL sessions use the same offset, so CURRENT_DATE, NOW() and TIMESTAMP columns agree with it.
const DEFAULT_OFFSET = "+08:00";
const configured = (process.env.APP_TIME_OFFSET ?? DEFAULT_OFFSET).trim();

export const APP_TIME_OFFSET = /^[+-](0\d|1[0-4]):[0-5]\d$/.test(configured) ? configured : DEFAULT_OFFSET;

const sign = APP_TIME_OFFSET.startsWith("-") ? -1 : 1;
const [hours, minutes] = APP_TIME_OFFSET.slice(1).split(":").map(Number);
const offsetMs = sign * (hours * 60 + minutes) * 60_000;

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/;

/**
 * Converts a client date/time into a MySQL DATETIME string in business time.
 * Values without a timezone (e.g. from <input type="datetime-local">) are already business
 * wall-clock time and are kept as typed; values with Z or an offset are converted.
 * Returns null when the value cannot be parsed.
 */
export function toBusinessDateTime(value?: string | null): string | null {
  const raw = (value ?? "").trim();
  const wallClock = raw.match(WALL_CLOCK);
  if (wallClock) {
    const result = `${wallClock[1]} ${wallClock[2]}${wallClock[3] ?? ":00"}`;
    return Number.isNaN(new Date(`${result.replace(" ", "T")}Z`).getTime()) ? null : result;
  }
  const instant = raw ? new Date(raw) : new Date();
  if (Number.isNaN(instant.getTime())) return null;
  return new Date(instant.getTime() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}
