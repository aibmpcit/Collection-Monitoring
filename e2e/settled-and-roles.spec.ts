import { createAccount, importLoans, seedBranch } from "./data";
import { expect, signIn, test } from "./helpers";

test("a loan missing from the next upload moves to Settled Accounts", async ({ page, request }) => {
  const { tag, token, branch, loans } = await seedBranch(request);
  // The new list leaves out Cora's loan.
  const result = await importLoans(request, token, branch.id, loans.slice(0, 2), true);
  expect(result.closed).toBe(1);

  await signIn(page);
  await page.goto("/loans");
  await page.getByRole("tab", { name: "Settled Accounts" }).click();
  await page.getByLabel("Search settled accounts").fill(tag);
  await expect(page.getByText("1 settled account(s)")).toBeVisible();
  await expect(page.getByText(`Cora Santos ${tag}`).filter({ visible: true }).first()).toBeVisible();

  // It no longer appears in Loan Records.
  await page.getByRole("tab", { name: "Loan Records" }).click();
  await page.getByPlaceholder("Search loan records").fill(tag);
  await expect(page.getByText(`Ana Garcia ${tag}`).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(`Cora Santos ${tag}`)).toHaveCount(0);
});

for (const role of ["staff", "las"] as const) {
  test(`${role === "staff" ? "collectors" : "LAS"} get search but no filters or export`, async ({ page, request }) => {
    const { tag, token, branch } = await seedBranch(request);
    const account = await createAccount(request, token, branch.id, role, tag);
    await signIn(page, account);
    await page.goto("/loans");
    await page.getByPlaceholder("Search loan records").fill(tag);
    await expect(page.getByText(`Ana Garcia ${tag}`).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Export/ })).toHaveCount(0);
  });
}
