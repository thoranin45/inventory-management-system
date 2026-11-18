/**
 * Runs once before the smoke specs: makes sure a WAREHOUSE user exists, then
 * signs both roles in THROUGH THE LOGIN PAGE and saves their sessions, so each
 * spec starts already signed in (and the login rate limit is hit only twice).
 */
import { expect, test as setup, type Page } from "@playwright/test";

import { call, token } from "./support/api";
import { env, STATE } from "./support/env";

async function signIn(page: Page, username: string, password: string) {
  await page.context().addCookies([{ name: "akk_lang", value: "en", url: env.baseURL }]);
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("button", { name: new RegExp(`Signed in as ${username}`) })).toBeVisible();
}

setup("warehouse user exists", async () => {
  const admin = await token(env.admin.username, env.admin.password);
  try {
    await call("POST", "/auth/register", admin, {
      username: env.warehouse.username,
      password: env.warehouse.password,
      role: "warehouse",
    });
  } catch (error) {
    // 409 = already there from an earlier run against the same database.
    if (!String(error).includes("HTTP 409")) throw error;
  }
});

setup("sign in as admin", async ({ page }) => {
  await signIn(page, env.admin.username, env.admin.password);
  await page.context().storageState({ path: STATE.admin });
});

setup("sign in as warehouse", async ({ page }) => {
  await signIn(page, env.warehouse.username, env.warehouse.password);
  await page.context().storageState({ path: STATE.warehouse });
});
