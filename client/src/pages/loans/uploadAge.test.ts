import { describe, expect, it } from "vitest";
import { daysSinceUpload, weeklyUploadWarning } from "./uploadAge";

const today = new Date(2026, 9, 17, 9, 0, 0);

describe("weekly upload age", () => {
  it("counts calendar days since the upload", () => {
    expect(daysSinceUpload("2026-10-17 08:00:00", today)).toBe(0);
    expect(daysSinceUpload("2026-10-10 23:59:00", today)).toBe(7);
    expect(daysSinceUpload("not a date", today)).toBeNull();
  });

  it("warns only once the list is more than a week old", () => {
    expect(weeklyUploadWarning("2026-10-10 08:00:00", today)).toBe("");
    expect(weeklyUploadWarning("2026-10-09 08:00:00", today)).toMatch(/^Last upload was 8 days ago/);
    expect(weeklyUploadWarning("", today)).toBe("");
  });
});
