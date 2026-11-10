import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BookOpen,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Ellipsis,
  Factory,
  LayoutGrid,
  Layers,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  ScanLine,
  ScrollText,
  Send,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Truck,
  Users,
} from "lucide-react";

import type { MessageKey } from "@/lib/i18n/translate";

/** Concept B sidebar sections (Design Freeze §C "Navigation and role-based visibility"). */
export type NavGroupKey = "overview" | "tasks" | "inventory" | "orders" | "reports" | "master";

export const NAV_GROUPS: { key: NavGroupKey; labelKey: MessageKey }[] = [
  { key: "overview", labelKey: "groups.overview" },
  { key: "tasks", labelKey: "groups.tasks" },
  { key: "inventory", labelKey: "groups.inventory" },
  { key: "orders", labelKey: "groups.orders" },
  { key: "reports", labelKey: "groups.reports" },
  { key: "master", labelKey: "groups.master" },
];

export interface NavItem {
  key: string;
  /** R2: translated label (see lib/i18n/dictionaries). */
  labelKey: MessageKey;
  href: string;
  icon: LucideIcon;
  /** Concept B sidebar section; presentation only (destinations unchanged). */
  group: NavGroupKey;
  /** hide unless the signed-in user is an admin (backend still enforces) */
  adminOnly?: boolean;
}

/**
 * Primary navigation. Destinations, order and role flags are unchanged since
 * R1; the array order is kept for the command palette. The sidebar, iPad rail
 * and phone More sheet render these items grouped by `group`.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutGrid, group: "overview" },
  { key: "products", labelKey: "nav.products", href: "/products", icon: Boxes, group: "master" },
  { key: "categories", labelKey: "nav.categories", href: "/categories", icon: Tags, group: "master" },
  { key: "stock", labelKey: "nav.stock", href: "/stock", icon: Layers, group: "inventory" },
  { key: "inventory-ledger", labelKey: "nav.inventoryLedger", href: "/inventory/ledger", icon: BookOpen, group: "inventory" },
  { key: "stock-in", labelKey: "nav.stockIn", href: "/stock-in", icon: PackagePlus, group: "tasks" },
  { key: "stock-out", labelKey: "nav.stockOut", href: "/stock-out", icon: PackageMinus, group: "tasks" },
  { key: "stock-adjustments", labelKey: "nav.stockAdjustments", href: "/stock-adjustments/mine", icon: ClipboardList, group: "inventory" },
  { key: "stock-adjustment-approvals", labelKey: "nav.approvals", href: "/stock-adjustments/approvals", icon: ShieldCheck, group: "inventory", adminOnly: true },
  { key: "sales", labelKey: "nav.sales", href: "/sales", icon: ShoppingCart, group: "orders" },
  { key: "picking", labelKey: "nav.picking", href: "/picking", icon: PackageSearch, group: "tasks" },
  { key: "packing", labelKey: "nav.packing", href: "/packing", icon: ClipboardCheck, group: "tasks" },
  { key: "shipping", labelKey: "nav.shipping", href: "/shipping", icon: Send, group: "tasks" },
  { key: "purchase-orders", labelKey: "nav.purchaseOrders", href: "/purchase-orders", icon: Truck, group: "orders" },
  { key: "transfers", labelKey: "nav.transfers", href: "/transfers", icon: ArrowLeftRight, group: "inventory" },
  { key: "customers", labelKey: "nav.customers", href: "/customers", icon: Users, group: "master" },
  { key: "suppliers", labelKey: "nav.suppliers", href: "/suppliers", icon: Factory, group: "master" },
  { key: "reports", labelKey: "nav.reports", href: "/reports", icon: ClipboardCheck, group: "reports" },
  { key: "audit", labelKey: "nav.audit", href: "/audit", icon: ScrollText, group: "reports", adminOnly: true },
];

/** Items the signed-in user may see (presentation only; the backend enforces access). */
export function visibleNavItems(admin: boolean): NavItem[] {
  return NAV_ITEMS.filter((n) => !n.adminOnly || admin);
}

/** True when `pathname` is `href` or below it; the dashboard also owns "/". */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  return pathname === href || pathname.startsWith(href + "/");
}

export interface BottomNavItem {
  key: "home" | "tasks" | "stock" | "orders" | "more";
  labelKey: MessageKey;
  icon: LucideIcon;
  /** destination; absent for "More", which opens the sheet */
  href?: string;
  /** path prefixes that mark this tab current */
  activeFor?: string[];
}

/**
 * Concept B phone bottom bar (frozen showroom): Home, Tasks, Stock, Orders,
 * More. Destinations reuse existing routes (decision D5): Tasks opens the
 * Stock In task (the showroom's task target), Orders opens Picking (the
 * showroom's order-fulfilment screen). No new hub pages.
 */
export const BOTTOM_NAV: BottomNavItem[] = [
  { key: "home", labelKey: "bottom.home", href: "/dashboard", icon: LayoutGrid, activeFor: ["/dashboard"] },
  { key: "tasks", labelKey: "bottom.tasks", href: "/stock-in", icon: ScanLine, activeFor: ["/stock-in", "/stock-out"] },
  { key: "stock", labelKey: "bottom.stock", href: "/stock", icon: Layers, activeFor: ["/stock", "/stock-adjustments", "/inventory"] },
  {
    key: "orders",
    labelKey: "bottom.orders",
    href: "/picking",
    icon: ShoppingCart,
    activeFor: ["/picking", "/packing", "/shipping", "/sales", "/purchase-orders"],
  },
  { key: "more", labelKey: "bottom.more", icon: Ellipsis },
];

export function isBottomNavActive(pathname: string, item: BottomNavItem): boolean {
  return (item.activeFor ?? []).some((prefix) => isNavActive(pathname, prefix));
}
