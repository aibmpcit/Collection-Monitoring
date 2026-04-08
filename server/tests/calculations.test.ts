import { describe, expect, it } from "vitest";
import {
  calculateCollectionEfficiency,
  calculateOutstanding,
  calculateOverdueRate
} from "../src/services/calculations.js";

describe("collection calculations", () => {
  it("computes outstanding balance", () => {
    expect(calculateOutstanding(1000, 100, 50)).toBe(1150);
  });

  it("handles overdue rate and protects division by zero", () => {
    expect(calculateOverdueRate(5, 20)).toBe(25);
    expect(calculateOverdueRate(1, 0)).toBe(0);
  });

  it("handles collection efficiency", () => {
    expect(calculateCollectionEfficiency(500, 1000)).toBe(50);
    expect(calculateCollectionEfficiency(1, 0)).toBe(100);
  });
});