import { expect, test } from "@playwright/test";

import { createProduct, onHand, receiveBatch, token } from "./support/api";
import { env, isoDate, STATE, uniq } from "./support/env";

test.use({ storageState: STATE.warehouse });

test("FEFO stock-out issues the earliest-expiring lot first (server-selected)", async ({ page }) => {
  const admin = await token(env.admin.username, env.admin.password);
  const warehouse = await token(env.warehouse.username, env.warehouse.password);
  const product = await createProduct(admin, { prefix: "FEFO", batch: true });
  const tag = uniq();
  // The LATER-expiring lot is received FIRST, so FEFO and "oldest received"
  // disagree: only a real expiry-ordered selection passes this test.
  const late = `LOT-LATE-${tag}`;
  const early = `LOT-EARLY-${tag}`;
  await receiveBatch(warehouse, product.id, late, "5.000", isoDate(-10), isoDate(200));
  await receiveBatch(warehouse, product.id, early, "3.000", isoDate(-10), isoDate(40));

  await page.goto("/stock-out");
  await page.getByRole("combobox", { name: "Search products" }).fill(product.sku);
  await page.getByRole("option", { name: new RegExp(product.sku) }).click();

  await expect(page.getByRole("button", { name: /^FEFO/ })).toHaveAttribute("aria-pressed", "true");
  const preview = page.getByRole("listitem").filter({ hasText: tag });
  await expect(preview.first()).toContainText(early);
  await expect(preview.nth(1)).toContainText(late);

  await page.getByRole("button", { name: "Start scanning" }).click();
  await page.getByRole("radio", { name: "Enter Quantity" }).click();
  await page.getByRole("textbox", { name: "Quantity to issue" }).fill("4");
  await page.getByRole("button", { name: /Review stock out/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Confirm/ }).click();

  await expect(page.getByRole("status").filter({ hasText: "Stock issued" })).toContainText(
    "issued −4.000. On hand 4.000.",
  );

  // Authoritative result: the early lot is used up first, then 1 from the late lot.
  const balance = await onHand(admin, product.id);
  expect(balance.byLot[early]).toBe(0);
  expect(balance.byLot[late]).toBe(4);
  expect(balance.total).toBe(4);
});

test("the server refuses a stock-out larger than the stock and nothing is deducted", async ({ page }) => {
  const admin = await token(env.admin.username, env.admin.password);
  const warehouse = await token(env.warehouse.username, env.warehouse.password);
  const product = await createProduct(admin, { prefix: "NEG", batch: true });
  await receiveBatch(warehouse, product.id, `LOT-NEG-${uniq()}`, "2.000", isoDate(-10), isoDate(90));

  await page.goto("/stock-out");
  await page.getByRole("combobox", { name: "Search products" }).fill(product.sku);
  await page.getByRole("option", { name: new RegExp(product.sku) }).click();
  await page.getByRole("button", { name: "Start scanning" }).click();
  await page.getByRole("radio", { name: "Enter Quantity" }).click();
  await page.getByRole("textbox", { name: "Quantity to issue" }).fill("2.001");

  // The browser only warns; the backend is the authority and must refuse.
  await expect(page.getByText(/Over the last-known available quantity/)).toBeVisible();
  await page.getByRole("button", { name: /Review stock out/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Confirm/ }).click();

  await expect(page.getByRole("region", { name: /Notifications/ })).toContainText(
    "There isn't enough stock on hand for that quantity. Nothing was deducted.",
  );
  await expect(page.getByRole("status").filter({ hasText: "Stock issued" })).toHaveCount(0);
  expect((await onHand(admin, product.id)).total).toBe(2);
});
