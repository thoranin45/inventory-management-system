import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The transfer /complete endpoint is RETIRED (backend returns 409). The
 * frontend must never call it in normal UI. This guards that:
 *   - no transfer component / query module references `/complete`
 *   - the BFF allow-list has no `inventory-transfers/{id}/complete` route
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..");

describe("retired /inventory-transfers/{id}/complete is unreachable from the UI", () => {
  it("no transfer source file mentions '/complete'", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(here)) {
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
      // strip comments so a doc line explaining the rule isn't a false positive
      const body = readFileSync(join(here, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/\/complete\b/.test(body)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("lib/query/transfers.ts has no dispatch to a /complete path", () => {
    expect(readFileSync(join(src, "lib", "query", "transfers.ts"), "utf8")).not.toMatch(/\/complete/);
  });

  it("the BFF allow-list does not permit inventory-transfers/{id}/complete", () => {
    const route = readFileSync(join(src, "app", "api", "bff", "[...path]", "route.ts"), "utf8");
    expect(route).toMatch(/inventory-transfers/); // transfers ARE allow-listed
    expect(route).not.toMatch(/inventory-transfers[^\n]*complete/);
  });
});
