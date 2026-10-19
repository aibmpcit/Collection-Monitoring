import { loanIdFor, seedBranch } from "./data";
import { expect, signIn, test } from "./helpers";

// The phone's location for "Add current location" (Culasi, Antique).
test.use({ geolocation: { latitude: 11.4272, longitude: 122.0563, accuracy: 8 }, permissions: ["geolocation"] });

test("a payment needs proof and location, then sets the loan's status", async ({ page, request }) => {
  const { tag, token, loans } = await seedBranch(request);
  const loanId = await loanIdFor(request, token, loans[0].loanAccountNo);
  await signIn(page);
  await page.goto(`/loan-details/${loanId}`);

  await page.getByRole("tab", { name: "Payments" }).click();
  await page.getByRole("button", { name: "Add Payment" }).click();
  const form = page.getByRole("dialog", { name: "Add Payment" });
  await form.getByLabel("Amount").fill("1500");
  await form.getByLabel("Payment Type").selectOption("partial");

  // Proof is required: saving without it is refused.
  await form.getByRole("button", { name: "Save Payment" }).click();
  await expect(form).toBeVisible();

  await form.getByLabel("Attach File").setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test receipt") });
  await form.getByRole("button", { name: "Add current location" }).click();
  // The place lookup is off in tests, so the coordinates are shown instead of a barangay.
  await expect(form.getByText(/11\.4272/)).toBeVisible();
  await form.getByRole("button", { name: "Save Payment" }).click();
  await expect(form).toBeHidden();

  await expect(page.getByText("Partially Paid").filter({ visible: true }).first()).toBeVisible();

  // Collection Records shows the new status for this loan.
  await page.goto("/loans");
  await page.getByPlaceholder("Search loan records").fill(loans[0].loanAccountNo);
  await expect(page.getByText(`Ana Garcia ${tag}`).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Partially Paid").filter({ visible: true }).first()).toBeVisible();
});
