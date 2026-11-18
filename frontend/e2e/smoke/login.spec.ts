import { expect, test } from "@playwright/test";

import { env } from "./support/env";

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "akk_lang", value: "en", url: env.baseURL }]);
});

test("a protected page sends a signed-out visitor to the login page", async ({ page }) => {
  await page.goto("/stock");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a wrong password is refused and no session cookie is set", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(env.admin.username);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // The backend's refusal is shown as-is (with its request id for support).
  await expect(page.getByRole("alert").filter({ hasText: "Invalid username or password" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect((await context.cookies()).some((c) => c.name === "wc_session")).toBe(false);
});

test("the admin signs in through the BFF, sees the dashboard, and signs out", async ({ page, context }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => apiCalls.push(new URL(r.url()).origin));

  await page.goto("/login");
  await page.getByLabel("Username").fill(env.admin.username);
  await page.getByLabel("Password").fill(env.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  const session = (await context.cookies()).find((c) => c.name === "wc_session");
  expect(session?.httpOnly).toBe(true);
  // The browser only ever talks to the Next.js origin, never to FastAPI.
  expect(new Set(apiCalls)).toEqual(new Set([env.baseURL]));

  await page.getByRole("button", { name: new RegExp(`Signed in as ${env.admin.username}`) }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
