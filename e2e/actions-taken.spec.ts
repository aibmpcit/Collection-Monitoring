import { addActionTaken, loanIdFor, seedBranch } from "./data";
import { expect, signIn, test } from "./helpers";

test("hovering an Actions Taken row lists every action, and each opens its summary", async ({ page, request, isMobile }) => {
  test.skip(isMobile, "Hover only exists with a mouse (desktop table).");
  const { tag, token, loans } = await seedBranch(request);
  const loanId = await loanIdFor(request, token, loans[0].loanAccountNo);
  await addActionTaken(request, token, loanId, "Sent reminder letter", "others");
  await addActionTaken(request, token, loanId, "Promised to pay on Friday", "promised_to_pay");
  await addActionTaken(request, token, loanId, "Visited the house", "visited");

  await signIn(page);
  await page.goto("/loans");
  await page.getByRole("tab", { name: "Actions Taken" }).click();
  await page.getByPlaceholder("Search actions taken").fill(tag);
  // Wait for the search results to replace the full list; otherwise the row can move away mid-hover.
  await expect(page.getByText("Showing 1-1 of 1")).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: `Ana Garcia ${tag}` });
  await row.hover();
  const panel = page.getByRole("dialog", { name: `All actions taken on ${loans[0].loanAccountNo}` });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("3 action(s) taken")).toBeVisible();
  // The row itself only shows the two newest; the panel has the oldest too.
  await expect(panel.getByText("Sent reminder letter")).toBeVisible();

  await panel.getByRole("button", { name: /^Open Others/ }).click();
  const summary = page.getByRole("dialog", { name: "Others" });
  await expect(summary.getByText("Sent reminder letter")).toBeVisible();
  await summary.getByRole("button", { name: "Close" }).click();
  await expect(summary).toBeHidden();
});
