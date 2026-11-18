import { expect, test } from "@playwright/test";

import { createProduct, onHand, stockIn, token } from "./support/api";
import { env, STATE } from "./support/env";

test("warehouse requests an adjustment, nothing moves until the admin approves it", async ({ browser }) => {
  const admin = await token(env.admin.username, env.admin.password);
  const warehouse = await token(env.warehouse.username, env.warehouse.password);
  const product = await createProduct(admin, { prefix: "ADJ", batch: false });
  await stockIn(warehouse, product.id, "10.000");

  // 1. Warehouse user submits the request.
  const whContext = await browser.newContext({ storageState: STATE.warehouse });
  const wh = await whContext.newPage();
  await wh.goto("/stock-adjustments/new");
  await wh.getByRole("combobox", { name: "Search products" }).fill(product.sku);
  await wh.getByRole("option", { name: new RegExp(product.sku) }).click();
  await expect(wh.getByLabel("Observed quantity")).toHaveValue("10.000");
  await wh.getByLabel("Requested (corrected) quantity").fill("7.5");
  await wh.getByLabel("Note (optional)").fill("e2e cycle count");
  await wh.getByRole("button", { name: "Submit request" }).click();

  const submitted = wh.getByText(/ADJ-\d+ is Pending\. No stock has changed/);
  await expect(submitted).toBeVisible();
  const reference = (await submitted.textContent())!.match(/ADJ-\d+/)![0];
  await whContext.close();

  expect((await onHand(admin, product.id)).total).toBe(10);

  // 2. Admin approves it.
  const adminContext = await browser.newContext({ storageState: STATE.admin });
  const ad = await adminContext.newPage();
  await ad.goto("/stock-adjustments/approvals");
  await ad.getByRole("button", { name: new RegExp(`^${reference} Pending`) }).click();
  const detail = ad.getByRole("dialog", { name: reference });
  await expect(detail).toContainText(product.sku);
  await expect(detail).toContainText(/10\.000\s*becomes\s*7\.500\s*\(−2\.500\)/);
  await detail.getByRole("button", { name: "Approve" }).click();
  await ad.getByRole("dialog", { name: `Approve ${reference}?` }).getByRole("button", { name: "Approve" }).click();

  await expect(detail).toContainText("Approved");
  await expect(detail).toContainText(new RegExp(`Reviewed by\\s*${env.admin.username}`));
  await adminContext.close();

  expect((await onHand(admin, product.id)).total).toBe(7.5);
});
