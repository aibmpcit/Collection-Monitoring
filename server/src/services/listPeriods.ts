import { z } from "zod";

// "Date" filters on list pages: today, or the last N days counting today (business time zone).
const PERIOD_DAYS = { today: 0, "7d": 6, "30d": 29, "90d": 89 } as const;

export const periodSchema = z.enum(["today", "7d", "30d", "90d"]);
export type Period = z.infer<typeof periodSchema>;

/** SQL condition keeping rows whose `column` falls in the period. `column` must be trusted SQL, never user input. */
export function periodCondition(column: string, period: Period) {
  return `${column} >= CURDATE() - INTERVAL ${PERIOD_DAYS[period]} DAY`;
}
