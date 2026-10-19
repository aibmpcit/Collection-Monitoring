import { z } from "zod";

// "Date" filters on list pages: today, or the last N days counting today (business time zone).
const PERIOD_DAYS = { today: 0, "7d": 6, "30d": 29, "90d": 89 } as const;

export const periodSchema = z.enum(["today", "7d", "30d", "90d"]);
export type Period = z.infer<typeof periodSchema>;

/** SQL condition keeping rows whose `column` falls in the period. `column` must be trusted SQL, never user input. */
export function periodCondition(column: string, period: Period) {
  return `${column} >= CURDATE() - INTERVAL ${PERIOD_DAYS[period]} DAY`;
}

/** A calendar day, "YYYY-MM-DD", for dateFrom/dateTo filters (a month or a custom range). */
export const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)), "Invalid date").optional();

/**
 * Adds "column from dateFrom through dateTo" (whole days, either end optional) through the route's own
 * parameter helper. `column` must be trusted SQL, never user input.
 */
export function addDateRange(add: (expression: string, value: unknown) => void, column: string, from?: string, to?: string) {
  if (from) add(`${column} >= ?`, from);
  if (to) add(`${column} < DATE_ADD(?, INTERVAL 1 DAY)`, to);
}
