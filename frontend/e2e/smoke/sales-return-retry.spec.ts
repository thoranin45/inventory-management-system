import { expect, test } from "@playwright/test";

import { createProduct, onHand, shippedSalesOrder, stockIn, token } from "./support/api";
import { env, STATE } from "./support/env";

test.use({ storageState: STATE.warehouse });

test("a sales return whose response is lost is retried with the same key and applied once", async ({ page }) => {
  const admin = await token(env.admin.username, env.admin.password);
  const warehouse = await token(env.warehouse.username, env.warehouse.password);
  const product = await createProduct(admin, { prefix: "RET", batch: false });
  await stockIn(warehouse, product.id, "10.000");
  const order = await shippedSalesOrder(admin, warehouse, product, "3.000");
  expect((await onHand(admin, product.id)).total).toBe(7);

  // The first return request REACHES the server and is recorded there, but its
  // response never gets back to the browser (a dropped connection).
  const keys: string[] = [];
  await page.route(`**/api/bff/sales-orders/${order.id}/return`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1) {
      const delivered = await route.fetch();
      expect(delivered.status()).toBe(200);
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  await page.goto("/sales");
  await page.getByRole("searchbox", { name: "Search sales orders" }).fill(order.soNumber);
  await page.getByRole("button", { name: new RegExp(`^${order.soNumber} `) }).click();
  await page.getByRole("dialog", { name: order.soNumber }).getByRole("button", { name: "Return items" }).click();

  const form = page.getByRole("dialog", { name: `Return items — ${order.soNumber}` });
  await form.getByRole("textbox", { name: /Return quantity/ }).fill("1");
  await form.getByRole("button", { name: "Record return" }).click();

  await expect(form.getByText("Outcome unknown — this return may or may not be recorded")).toBeVisible();
  // Editing and new returns stay blocked while the outcome is unknown.
  await expect(form.getByRole("button", { name: "Record return", exact: true })).toHaveCount(0);

  await form.getByRole("button", { name: "Retry: Record return" }).click();
  await expect(form).toContainText("returned 1.000 · total returned 1.000 · remaining 2.000");

  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe("");
  expect(keys[1]).toBe(keys[0]);
  // Applied exactly once: 10 in, 3 shipped, 1 returned.
  expect((await onHand(admin, product.id)).total).toBe(8);
});
