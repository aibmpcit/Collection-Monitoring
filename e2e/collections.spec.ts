import { seedBranch } from "./data";
import { expect, signIn, test } from "./helpers";

test("search and filters narrow Collection Records", async ({ page, request }) => {
  const { tag } = await seedBranch(request);
  await signIn(page);
  await page.goto("/loans");

  // Search by the tag: only this test's three loans.
  await page.getByPlaceholder("Search loan records").fill(tag);
  for (const name of ["Ana Garcia", "Ben Reyes", "Cora Santos"]) {
    await expect(page.getByText(`${name} ${tag}`).filter({ visible: true }).first()).toBeVisible();
  }

  // PAR 31-60 leaves only Ana (PAR 45).
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Filter by PAR age").selectOption("31-60");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible();
  await expect(page.getByText(`Ana Garcia ${tag}`).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(`Ben Reyes ${tag}`)).toHaveCount(0);
  await expect(page.getByText(`Cora Santos ${tag}`)).toHaveCount(0);

  // Swap to "Total due over ₱50,000": only Ben (₱62,000).
  await page.getByRole("button", { name: "Filters (1 active)" }).click();
  await page.getByLabel("Filter by PAR age").selectOption("");
  await page.getByLabel("Filter by total due").selectOption("over-50k");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`Ben Reyes ${tag}`).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(`Ana Garcia ${tag}`)).toHaveCount(0);

  // Clearing brings all three back.
  await page.getByRole("button", { name: "Filters (1 active)" }).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`Cora Santos ${tag}`).filter({ visible: true }).first()).toBeVisible();
});
