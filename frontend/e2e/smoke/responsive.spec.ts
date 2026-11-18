/**
 * Responsive matrix: 390 / 768 / 1280 px × light / dark × Thai / English on the
 * main screens. Each combination checks the page renders in the chosen language
 * and theme, has no horizontal page scroll, and shows the right navigation.
 */
import { expect, test } from "@playwright/test";

import { en } from "../../src/lib/i18n/dictionaries/en";
import { th } from "../../src/lib/i18n/dictionaries/th";
import { env, STATE } from "./support/env";

test.use({ storageState: STATE.admin });

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;
const THEMES = ["light", "dark"] as const;
const LOCALES = { th, en } as const;

const SCREENS = [
  { path: "/dashboard", heading: (d: typeof en) => d.dashboard.title },
  { path: "/stock", heading: (d: typeof en) => d.nav.stock },
  { path: "/stock-in", heading: (d: typeof en) => d.nav.stockIn },
  { path: "/sales", heading: (d: typeof en) => d.sales.title },
] as const;

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const [locale, dict] of Object.entries(LOCALES) as [keyof typeof LOCALES, typeof en][]) {
      test(`${vp.name} ${vp.width}px · ${theme} · ${locale}`, async ({ page, context }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await context.addCookies([{ name: "akk_lang", value: locale, url: env.baseURL }]);
        // next-themes reads its choice from localStorage["theme"] before first paint.
        await context.addInitScript((t) => window.localStorage.setItem("theme", t), theme);

        for (const screen of SCREENS) {
          await page.goto(screen.path);
          const html = page.locator("html");
          await expect(html, screen.path).toHaveAttribute("lang", locale);
          await expect(html, screen.path).toHaveAttribute("data-theme", theme);
          await expect(page.getByRole("heading", { level: 1 }), screen.path).toHaveText(screen.heading(dict));
          await page.waitForLoadState("networkidle");

          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${screen.path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);

          // Phones get the bottom tab bar; tablets and desktops get the side navigation.
          const bottomNav = page.getByRole("navigation", { name: dict.bottom.label });
          const sideNav = page.getByRole("navigation", { name: dict.nav.primary, exact: true });
          if (vp.width < 768) {
            await expect(bottomNav, screen.path).toBeVisible();
            await expect(sideNav, screen.path).toBeHidden();
          } else {
            await expect(bottomNav, screen.path).toBeHidden();
            await expect(sideNav, screen.path).toBeVisible();
          }
        }
      });
    }
  }
}
