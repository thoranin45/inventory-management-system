import { describe, expect, it, vi } from "vitest";

import { DEFAULT_LOCALE, LANG_COOKIE, LOCALES, isLocale } from "./config";
import { en } from "./dictionaries/en";
import { th } from "./dictionaries/th";
import { DICTIONARIES, translate } from "./translate";

const cookieJar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}));

import { getLocale } from "./server";

/** Values that are legitimately the same in both languages. */
// "SKU" is a frozen term used verbatim in Thai copy too (it is also on the ratchet allow-list)
const SAME_IN_BOTH = new Set(["shell.homeLink", "product.sku", "lookup.skuLabel"]);

describe("i18n dictionaries", () => {
  it("Thai and English have exactly the same namespaces and keys", () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort());
    for (const ns of Object.keys(en) as (keyof typeof en)[]) {
      expect(Object.keys(th[ns]).sort(), ns).toEqual(Object.keys(en[ns]).sort());
    }
  });

  it("every message is a non-empty string and Thai is actually translated", () => {
    for (const ns of Object.keys(en) as (keyof typeof en)[]) {
      for (const key of Object.keys(en[ns])) {
        const enValue = (en[ns] as Record<string, string>)[key];
        const thValue = (th[ns] as Record<string, string>)[key];
        expect(enValue.trim(), `${ns}.${key}`).not.toBe("");
        expect(thValue.trim(), `${ns}.${key}`).not.toBe("");
        if (!SAME_IN_BOTH.has(`${ns}.${key}`)) expect(thValue, `${ns}.${key} untranslated`).not.toBe(enValue);
      }
    }
  });

  it("placeholders match between languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const ns of Object.keys(en) as (keyof typeof en)[]) {
      for (const key of Object.keys(en[ns])) {
        expect(vars((th[ns] as Record<string, string>)[key]), `${ns}.${key}`)
          .toEqual(vars((en[ns] as Record<string, string>)[key]));
      }
    }
  });

  it("uses the frozen terminology for the core warehouse terms", () => {
    expect(th.nav.stockIn).toBe("รับสินค้าเข้า");
    expect(th.nav.stockOut).toBe("เบิกสินค้าออก");
    expect(th.nav.inventoryLedger).toBe("ประวัติความเคลื่อนไหว");
    expect(th.nav.transfers).toBe("โอนย้ายสินค้า");
    expect(th.status.READY_TO_SHIP).toBe("พร้อมส่ง");
    expect(th.status.IN_TRANSIT).toBe("ระหว่างขนส่ง");
    expect(th.status.DRAFT).toBe("ฉบับร่าง");
  });
});

describe("translate", () => {
  it("looks up namespaced keys in the chosen dictionary", () => {
    expect(translate(DICTIONARIES.en, "nav.stock")).toBe("Stock");
    expect(translate(DICTIONARIES.th, "nav.stock")).toBe("สต็อกสินค้า");
  });

  it("interpolates placeholders and leaves unknown ones visible", () => {
    expect(translate(DICTIONARIES.en, "shell.signedInAs", { name: "wc_admin" })).toBe("Signed in as wc_admin — sign out");
    expect(translate(DICTIONARIES.th, "palette.noMatchesFor", { query: "LOT-1" })).toBe("ไม่พบผลลัพธ์สำหรับ “LOT-1”");
    expect(translate(DICTIONARIES.en, "palette.noMatchesFor")).toBe("No matches for “{query}”.");
  });
});

describe("locale config and server resolution", () => {
  it("supports exactly Thai and English, Thai first-visit default, akk_lang cookie", () => {
    expect([...LOCALES]).toEqual(["th", "en"]);
    expect(DEFAULT_LOCALE).toBe("th");
    expect(LANG_COOKIE).toBe("akk_lang");
    expect(isLocale("th") && isLocale("en")).toBe(true);
    for (const bad of ["TH", "en-US", "", null, undefined, 1, {}]) expect(isLocale(bad)).toBe(false);
  });

  it("no cookie -> Thai; valid cookie -> its value; invalid cookie -> Thai", async () => {
    cookieJar.clear();
    expect(await getLocale()).toBe("th");
    cookieJar.set("akk_lang", "en");
    expect(await getLocale()).toBe("en");
    cookieJar.set("akk_lang", "fr");
    expect(await getLocale()).toBe("th");
    cookieJar.set("akk_lang", "<script>");
    expect(await getLocale()).toBe("th");
  });
});
