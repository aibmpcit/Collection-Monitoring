import { describe, expect, it } from "vitest";
import { applyFilters, dateFilterOptions, dateRangeOf } from "./FilterButton";

const today = new Date(2026, 9, 19); // 19 Oct 2026

describe("date filters", () => {
  it("turns a month, a quick range or a custom range into whole days", () => {
    expect(dateRangeOf({ date: "2026-09" }, "date", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(dateRangeOf({ date: "2026-02" }, "date", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(dateRangeOf({ date: "today" }, "date", today)).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(dateRangeOf({ date: "7d" }, "date", today)).toEqual({ from: "2026-10-13", to: "2026-10-19" });
    expect(dateRangeOf({ date: "custom", dateFrom: "2026-09-15", dateTo: "2026-09-01" }, "date", today))
      .toEqual({ from: "2026-09-01", to: "2026-09-15" });
    expect(dateRangeOf({ date: "custom", dateFrom: "2026-09-15" }, "date", today)).toEqual({ from: "2026-09-15", to: "" });
    expect(dateRangeOf({ date: "custom" }, "date", today)).toBeNull();
    expect(dateRangeOf({ date: "" }, "date", today)).toBeNull();
  });

  it("lists the quick ranges, then the last 12 months newest first", () => {
    const options = dateFilterOptions(today);
    expect(options.slice(0, 4)).toEqual([["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["2026-10", "October 2026"]]);
    expect(options.at(-1)).toEqual(["2025-11", "November 2025"]);
    expect(options).toHaveLength(15);
  });

  it("sends the date as dateFrom/dateTo alongside the other filters", () => {
    const params = applyFilters(new URLSearchParams(), { date: "2026-09", parAge: "31-60", dateFrom: "", loanType: "" });
    expect(params.toString()).toBe("parAge=31-60&dateFrom=2026-09-01&dateTo=2026-09-30");
  });
});
