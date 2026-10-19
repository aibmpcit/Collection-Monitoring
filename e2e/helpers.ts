import { test as base, expect, type Page } from "@playwright/test";

// The administrator created in the test database (see e2e/README.md).
export const ADMIN = { username: "e2eadmin", password: "E2e-Admin-123" };

/**
 * Use this `test` instead of Playwright's: it fails any test whose page talks to the dev API on
 * port 4000, which is connected to the main database. Tests must only reach the test API.
 */
export const test = base.extend<{ guardTestApi: void }>({
  guardTestApi: [async ({ page }, use) => {
    const strays: string[] = [];
    page.on("request", request => { if (new URL(request.url()).port === "4000") strays.push(request.url()); });
    await use();
    expect(strays, "requests sent to the dev API (port 4000) instead of the test API").toEqual([]);
  }, { auto: true }]
});

export { expect };

export async function signIn(page: Page, account = ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(account.username);
  // exact: the eye button beside the field is labelled "Show password".
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
