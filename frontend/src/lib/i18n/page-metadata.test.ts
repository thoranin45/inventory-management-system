import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}));

import { LANG_COOKIE } from "./config";
import { pageMetadata } from "./server";
import { DICTIONARIES } from "./translate";

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? pages(p) : name === "page.tsx" ? [p] : [];
  });
}

describe("page titles follow the UI language", () => {
  it("pageMetadata returns the title in the cookie's language", async () => {
    cookieJar.set(LANG_COOKIE, "en");
    expect(await pageMetadata("pageTitle.sales")).toEqual({ title: "Sales" });
    cookieJar.set(LANG_COOKIE, "th");
    expect(await pageMetadata("pageTitle.sales")).toEqual({ title: DICTIONARIES.th.pageTitle.sales });
  });

  it("no app page has a hard-coded English metadata title", () => {
    const files = pages(resolve(process.cwd(), "src/app/(app)"));
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/export const metadata/);
      const m = /pageMetadata\("([a-zA-Z.]+)"\)/.exec(src);
      expect(m, f).not.toBeNull();
      const name = m![1].split(".")[1] as keyof typeof DICTIONARIES.en.pageTitle;
      expect(DICTIONARIES.en.pageTitle[name], f).toBeTruthy();
    }
  });
});
