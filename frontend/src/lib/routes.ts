import type { MessageKey } from "@/lib/i18n/translate";
import { NAV_ITEMS, type NavGroupKey, type NavItem } from "@/lib/nav";

/**
 * Central route registry for breadcrumbs (Concept B R2). Each app route maps
 * to its navigation entry; the section comes from that entry's group, so the
 * trail can never disagree with the sidebar. Nested routes add a leaf below a
 * linked parent page. Purely presentational — never fetches data.
 */
export interface RouteTrail {
  group: NavGroupKey;
  page: NavItem;
  /** set for detail/sub routes: the page above becomes a link */
  leaf?: MessageKey;
}

const NAV = new Map(NAV_ITEMS.map((n) => [n.key, n]));

const REPORT_LEAF: Record<string, MessageKey> = {
  "operational-stock": "routes.operationalStock",
  expired: "routes.expired",
  "near-expiry": "routes.nearExpiry",
  "in-transit": "routes.inTransit",
  "low-stock": "routes.lowStock",
  movements: "routes.movements",
  sales: "routes.salesReport",
  "purchase-orders": "routes.purchaseOrdersReport",
  transfers: "routes.transfersReport",
};

type Leaf = MessageKey | ((m: RegExpMatchArray) => MessageKey | undefined);

/** [pattern, nav key, leaf] — first match wins; ids are matched, never displayed. */
const RULES: [RegExp, string, Leaf?][] = [
  [/^\/(dashboard)?$/, "dashboard"],
  [/^\/products$/, "products"],
  [/^\/categories$/, "categories"],
  [/^\/customers$/, "customers"],
  [/^\/suppliers$/, "suppliers"],
  [/^\/stock$/, "stock"],
  [/^\/inventory\/ledger$/, "inventory-ledger"],
  [/^\/stock-in$/, "stock-in"],
  [/^\/stock-out$/, "stock-out"],
  [/^\/stock-adjustments\/mine$/, "stock-adjustments"],
  [/^\/stock-adjustments\/new$/, "stock-adjustments", "routes.newRequest"],
  [/^\/stock-adjustments\/approvals$/, "stock-adjustment-approvals"],
  [/^\/sales$/, "sales"],
  [/^\/picking$/, "picking"],
  [/^\/picking\/[^/]+$/, "picking", "routes.pick"],
  [/^\/packing$/, "packing"],
  [/^\/packing\/[^/]+$/, "packing", "routes.pack"],
  [/^\/shipping$/, "shipping"],
  [/^\/purchase-orders$/, "purchase-orders"],
  [/^\/purchase-orders\/[^/]+\/receive$/, "purchase-orders", "routes.receive"],
  [/^\/transfers$/, "transfers"],
  [/^\/transfers\/[^/]+\/receive$/, "transfers", "routes.receive"],
  [/^\/reports$/, "reports"],
  [/^\/reports\/([^/]+)$/, "reports", (m) => REPORT_LEAF[m[1]]],
  [/^\/audit$/, "audit"],
];

/** Trail for a pathname, or null for routes outside the registry. */
export function resolveRoute(pathname: string): RouteTrail | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [pattern, navKey, leaf] of RULES) {
    const match = path.match(pattern);
    if (!match) continue;
    const page = NAV.get(navKey);
    if (!page) return null;
    const leafKey = typeof leaf === "function" ? leaf(match) : leaf;
    if (typeof leaf === "function" && !leafKey) return { group: page.group, page };
    return { group: page.group, page, ...(leafKey ? { leaf: leafKey } : {}) };
  }
  return null;
}

/** Every concrete route the registry covers (used by tests). */
export const REGISTERED_ROUTE_EXAMPLES = [
  "/", "/dashboard", "/products", "/categories", "/customers", "/suppliers", "/stock", "/inventory/ledger",
  "/stock-in", "/stock-out", "/stock-adjustments/mine", "/stock-adjustments/new", "/stock-adjustments/approvals",
  "/sales", "/picking", "/picking/12", "/packing", "/packing/12", "/shipping", "/purchase-orders",
  "/purchase-orders/7/receive", "/transfers", "/transfers/3/receive", "/reports", "/audit",
  ...Object.keys(REPORT_LEAF).map((slug) => `/reports/${slug}`),
];
