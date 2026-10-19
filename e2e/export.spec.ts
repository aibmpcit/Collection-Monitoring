import fs from "node:fs";
import * as XLSX from "xlsx";
import { seedBranch } from "./data";
import { expect, signIn, test } from "./helpers";

test("exports the filtered loan records to Excel and PDF", async ({ page, request }) => {
  const { tag } = await seedBranch(request);
  await signIn(page);
  await page.goto("/loans");
  await page.getByPlaceholder("Search loan records").fill(tag);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Filter by loan type").selectOption("Salary Loan");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`Cora Santos ${tag}`)).toHaveCount(0);

  // Excel: the file holds the two Salary Loan accounts and names the filters used.
  const excelDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export loan records" }).click();
  await page.getByRole("button", { name: /Excel/ }).click();
  const excel = await excelDownload;
  expect(excel.suggestedFilename()).toMatch(/^loan-records-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const workbook = XLSX.read(fs.readFileSync(await excel.path()));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
  const text = rows.map(row => row.join(" | "));
  expect(text.some(line => line.includes(`Search: "${tag}"`) && line.includes("Loan type: Salary Loan"))).toBe(true);
  expect(text.some(line => line.includes(`Ana Garcia ${tag}`))).toBe(true);
  expect(text.some(line => line.includes(`Ben Reyes ${tag}`))).toBe(true);
  expect(text.some(line => line.includes(`Cora Santos ${tag}`))).toBe(false);
  await expect(page.getByText("Exported 2 loan records.")).toBeVisible();

  // PDF of the same list.
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export loan records" }).click();
  await page.getByRole("button", { name: /PDF/ }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/^loan-records-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(fs.readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe("%PDF-");
});
