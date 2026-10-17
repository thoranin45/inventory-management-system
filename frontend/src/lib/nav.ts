import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BookOpen,
  Boxes,
  ClipboardCheck,
  ClipboardList,
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

/** Concept B sidebar sections (Design Freeze §C "Navigation and role-based visibility"). */
export type NavGroupKey = "overview" | "tasks" | "inventory" | "orders" | "reports" | "master";

export const NAV_GROUPS: { key: NavGroupKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Warehouse tasks" },
  { key: "inventory", label: "Inventory" },
  { key: "orders", label: "Orders" },
  { key: "reports", label: "Reports & audit" },
  { key: "master", label: "Master data" },
];

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Concept B sidebar section; presentation only (destinations unchanged). */
  group: NavGroupKey;
  /** hide unless the signed-in user is an admin (backend still enforces) */
  adminOnly?: boolean;
}

/**
 * Primary navigation. Destinations, labels and role flags are unchanged; the
 * array order is kept for the command palette. The sidebar renders these
 * items grouped by `group` in NAV_GROUPS order.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutGrid, group: "overview" },
  { key: "products", label: "Products", href: "/products", icon: Boxes, group: "master" },
  { key: "categories", label: "Categories", href: "/categories", icon: Tags, group: "master" },
  { key: "stock", label: "Stock", href: "/stock", icon: Layers, group: "inventory" },
  { key: "inventory-ledger", label: "Inventory Ledger", href: "/inventory/ledger", icon: BookOpen, group: "inventory" },
  { key: "stock-in", label: "Stock In", href: "/stock-in", icon: PackagePlus, group: "tasks" },
  { key: "stock-out", label: "Stock Out", href: "/stock-out", icon: PackageMinus, group: "tasks" },
  { key: "stock-adjustments", label: "Stock Adjustments", href: "/stock-adjustments/mine", icon: ClipboardList, group: "inventory" },
  { key: "stock-adjustment-approvals", label: "Approvals", href: "/stock-adjustments/approvals", icon: ShieldCheck, group: "inventory", adminOnly: true },
  { key: "sales", label: "Sales", href: "/sales", icon: ShoppingCart, group: "orders" },
  { key: "picking", label: "Picking", href: "/picking", icon: PackageSearch, group: "tasks" },
  { key: "packing", label: "Packing", href: "/packing", icon: ClipboardCheck, group: "tasks" },
  { key: "shipping", label: "Shipping", href: "/shipping", icon: Send, group: "tasks" },
  { key: "purchase-orders", label: "Purchase Orders", href: "/purchase-orders", icon: Truck, group: "orders" },
  { key: "transfers", label: "Transfers", href: "/transfers", icon: ArrowLeftRight, group: "inventory" },
  { key: "customers", label: "Customers", href: "/customers", icon: Users, group: "master" },
  { key: "suppliers", label: "Suppliers", href: "/suppliers", icon: Factory, group: "master" },
  { key: "reports", label: "Reports", href: "/reports", icon: ClipboardCheck, group: "reports" },
  { key: "audit", label: "Audit", href: "/audit", icon: ScrollText, group: "reports", adminOnly: true },
];

/** Compact bottom nav for iPhone — 4 primary + More. */
export const BOTTOM_NAV: { key: string; label: string; href?: string; icon: LucideIcon; action?: "more" }[] = [
  { key: "dashboard", label: "Home", href: "/dashboard", icon: LayoutGrid },
  { key: "stock", label: "Stock", href: "/stock", icon: Layers },
  { key: "sales", label: "Sales", href: "/sales", icon: ShoppingCart },
  { key: "picking", label: "Pick", href: "/picking", icon: ScanLine },
  { key: "more", label: "More", icon: Factory, action: "more" },
];
