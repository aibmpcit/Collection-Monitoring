import { ADMIN, expect, signIn, test } from "./helpers";

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("an admin can sign in and open Collection Records", async ({ page }) => {
  await signIn(page);
  await page.goto("/loans");
  await expect(page.getByPlaceholder("Search loan records")).toBeVisible();
  // Admins get the Filters and Export buttons beside the search box.
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export loan records" })).toBeVisible();
});
