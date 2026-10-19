import { describe, expect, it, vi } from "vitest";
import { buildPdf, describeFilters, exportToExcel, fetchAllPages, type ExportColumn } from "./tableExport";

const writeFile = vi.fn();
vi.mock("xlsx", async () => {
  const actual = await vi.importActual<typeof import("xlsx")>("xlsx");
  return { ...actual, writeFile: (...args: unknown[]) => writeFile(...args) };
});

interface Row { name: string; amount: number }
const columns: ExportColumn<Row>[] = [{ label: "Member", value: row => row.name, width: 2 }, { label: "Amount", value: row => row.amount, money: true }];
const table = (rows: Row[]) => ({ title: "Payments", fileBase: "payments", columns, rows, details: ["Filters: Payment type: Settled"] });

describe("table exports", () => {
  it("collects every page of a list", async () => {
    const load = vi.fn(async (path: string) => {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return { items: page < 3 ? Array.from({ length: 200 }, (_, i) => page * 1000 + i) : [3000], total: 401 };
    });
    const rows = await fetchAllPages(load, (page, size) => `/payments?page=${page}&pageSize=${size}`);
    expect(rows).toHaveLength(401);
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[0][0]).toBe("/payments?page=1&pageSize=200");
  });

  it("names the active filters in plain words", () => {
    const fields = [{ key: "parAge", label: "PAR age", allLabel: "All", options: [["31-60", "PAR 31-60"]] as const }];
    expect(describeFilters(fields, { parAge: "31-60" }, " ana ")).toBe('Search: "ana" · PAR age: PAR 31-60');
    expect(describeFilters(fields, {}, "")).toBe("No filters");
  });

  it("writes an Excel file with the filters, headers and numeric amounts", async () => {
    await exportToExcel(table([{ name: "Ana", amount: 1500.5 }]));
    const [workbook, fileName] = writeFile.mock.calls[0];
    expect(fileName).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const XLSX = await import("xlsx");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Payments, { header: 1 });
    expect(rows[0]).toEqual(["Payments"]);
    expect(rows[1]).toEqual(["Filters: Payment type: Settled"]);
    expect(rows).toContainEqual(["Member", "Amount"]);
    expect(rows).toContainEqual(["Ana", 1500.5]);
  });

  it("builds a PDF that runs onto more pages for long lists", async () => {
    const short = await buildPdf(table([{ name: "Ana", amount: 1 }]));
    expect(short.getNumberOfPages()).toBe(1);
    const long = await buildPdf(table(Array.from({ length: 80 }, (_, i) => ({ name: `Member ${i}`, amount: i }))));
    expect(long.getNumberOfPages()).toBeGreaterThan(2);
  });
});
