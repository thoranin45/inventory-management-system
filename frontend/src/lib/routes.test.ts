import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BOTTOM_NAV, NAV_ITEMS, isBottomNavActive, isNavActive, visibleNavItems } from "./nav";
import { REGISTERED_ROUTE_EXAMPLES, resolveRoute } from "./routes";

/** Every page under app/(app), with dynamic segments filled in. */
function appPages(): string[] {
  const root = resolve(process.cwd(), "src/app/(app)");
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}/${name.startsWith("[") ? "1" : name}`);
      else if (name === "page.tsx") out.push(prefix || "/");
    }
  };
  walk(root, "");
  return out.sort();
}

describe("route registry (breadcrumbs)", () => {
  it("covers every page in the authenticated app — a new page cannot be forgotten", () => {
    const pages = appPages();
    expect(pages.length).toBeGreaterThan(30);
    for (const path of pages) expect(resolveRoute(path), path).not.toBeNull();
  });

  it("every registered example resolves", () => {
    for (const path of REGISTERED_ROUTE_EXAMPLES) expect(resolveRoute(path), path).not.toBeNull();
  });

  it("each nav destination is its own page with the nav item's section", () => {
    for (const n of NAV_ITEMS) {
      const trail = resolveRoute(n.href)!;
      expect(trail.page.key, n.href).toBe(n.key);
      expect(trail.group).toBe(n.group);
      expect(trail.leaf).toBeUndefined();
    }
  });

  it("nested routes add a leaf under their parent page", () => {
    expect(resolveRoute("/purchase-orders/42/receive")).toMatchObject({ page: { key: "purchase-orders" }, leaf: "routes.receive" });
    expect(resolveRoute("/transfers/9/receive")).toMatchObject({ page: { key: "transfers" }, leaf: "routes.receive" });
    expect(resolveRoute("/picking/12")).toMatchObject({ page: { key: "picking" }, group: "tasks", leaf: "routes.pick" });
    expect(resolveRoute("/stock-adjustments/new")).toMatchObject({ page: { key: "stock-adjustments" }, leaf: "routes.newRequest" });
    expect(resolveRoute("/reports/near-expiry")).toMatchObject({ page: { key: "reports" }, leaf: "routes.nearExpiry" });
  });

  it("tolerates a trailing slash and maps / to the dashboard; unknown paths give no trail", () => {
    expect(resolveRoute("/stock/")?.page.key).toBe("stock");
    expect(resolveRoute("/")?.page.key).toBe("dashboard");
    expect(resolveRoute("/reports/unknown-report")).toMatchObject({ page: { key: "reports" } });
    expect(resolveRoute("/reports/unknown-report")?.leaf).toBeUndefined();
    expect(resolveRoute("/login")).toBeNull();
    expect(resolveRoute("/purchase-orders/1/edit")).toBeNull();
  });
});

describe("navigation helpers", () => {
  it("role filtering hides exactly the admin-only items from warehouse users", () => {
    expect(visibleNavItems(true)).toHaveLength(NAV_ITEMS.length);
    const wh = visibleNavItems(false).map((n) => n.key);
    expect(wh).not.toContain("stock-adjustment-approvals");
    expect(wh).not.toContain("audit");
    expect(wh).toHaveLength(NAV_ITEMS.length - 2);
  });

  it("active matching is segment-aware", () => {
    expect(isNavActive("/stock", "/stock")).toBe(true);
    expect(isNavActive("/stock-in", "/stock")).toBe(false);
    expect(isNavActive("/", "/dashboard")).toBe(true);
    expect(isNavActive("/dashboards", "/dashboard")).toBe(false);
  });

  it("Concept B bottom bar: Home, Tasks, Stock, Orders, More on existing routes (D5)", () => {
    expect(BOTTOM_NAV.map((b) => [b.key, b.href])).toEqual([
      ["home", "/dashboard"],
      ["tasks", "/stock-in"],
      ["stock", "/stock"],
      ["orders", "/picking"],
      ["more", undefined],
    ]);
    // every destination is an existing page
    for (const b of BOTTOM_NAV) if (b.href) expect(resolveRoute(b.href), b.href).not.toBeNull();
  });

  it("bottom bar active state follows the task, stock and order flows", () => {
    const active = (path: string) => BOTTOM_NAV.filter((b) => isBottomNavActive(path, b)).map((b) => b.key);
    expect(active("/dashboard")).toEqual(["home"]);
    expect(active("/stock-out")).toEqual(["tasks"]);
    expect(active("/stock-in")).toEqual(["tasks"]);
    expect(active("/stock-adjustments/mine")).toEqual(["stock"]);
    expect(active("/inventory/ledger")).toEqual(["stock"]);
    expect(active("/packing/3")).toEqual(["orders"]);
    expect(active("/purchase-orders/1/receive")).toEqual(["orders"]);
    expect(active("/customers")).toEqual([]);
  });
});
