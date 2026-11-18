import { expect, test } from "@playwright/test";

import { createProduct, onHand, token } from "./support/api";
import { env, isoDate, STATE, uniq } from "./support/env";

test.use({ storageState: STATE.warehouse });

test("warehouse receives a new lot with a 3-decimal quantity", async ({ page }) => {
  const admin = await token(env.admin.username, env.admin.password);
  const product = await createProduct(admin, { prefix: "IN", batch: true });
  const lot = `LOT-IN-${uniq()}`;

  await page.goto("/stock-in");
  await page.getByRole("combobox", { name: "Search products" }).fill(product.sku);
  await page.getByRole("option", { name: new RegExp(product.sku) }).click();
  await page.getByLabel("Lot number").fill(lot);
  await page.getByLabel("Manufacturing date").fill(isoDate(-7));
  await page.getByLabel("Expiry date").fill(isoDate(180));
  await page.getByRole("button", { name: "Start scanning" }).click();

  await page.getByRole("radio", { name: "Enter Quantity" }).click();
  await page.getByRole("textbox", { name: "Quantity received" }).fill("2.125");
  await page.getByRole("button", { name: /Review stock in/ }).click();

  const review = page.getByRole("dialog", { name: "Confirm stock in" });
  await expect(review).toContainText("+2.125");
  await expect(review).toContainText(lot);
  await review.getByRole("button", { name: "Confirm +2.125" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Stock saved" })).toContainText(
    `lot ${lot} — added 2.125. On hand 2.125.`,
  );

  const balance = await onHand(admin, product.id);
  expect(balance.total).toBe(2.125);
  expect(balance.byLot[lot]).toBe(2.125);
});
