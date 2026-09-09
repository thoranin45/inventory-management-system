import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  Factory,
  LayoutGrid,
  Layers,
  PackageSearch,
  ScanLine,
  ScrollText,
  Send,
  ShoppingCart,
  Tags,
  Truck,
  Users,
} from "lucide-react";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** hide unless the signed-in user is an admin (backend still enforces) */
  adminOnly?: boolean;
}

/** Primary navigation — order and destinations match the approved prototype. */
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { key: "products", label: "Products", href: "/products", icon: Boxes },
  { key: "categories", label: "Categories", href: "/categories", icon: Tags },
  { key: "stock", label: "Stock", href: "/stock", icon: Layers },
  { key: "sales", label: "Sales", href: "/sales", icon: ShoppingCart },
  { key: "picking", label: "Picking", href: "/picking", icon: PackageSearch },
  { key: "packing", label: "Packing", href: "/packing", icon: ClipboardCheck },
  { key: "shipping", label: "Shipping", href: "/shipping", icon: Send },
  { key: "purchase-orders", label: "Purchase Orders", href: "/purchase-orders", icon: Truck },
  { key: "transfers", label: "Transfers", href: "/transfers", icon: ArrowLeftRight },
  { key: "customers", label: "Customers", href: "/customers", icon: Users },
  { key: "suppliers", label: "Suppliers", href: "/suppliers", icon: Factory },
  { key: "reports", label: "Reports", href: "/reports", icon: ClipboardCheck },
  { key: "audit", label: "Audit", href: "/audit", icon: ScrollText, adminOnly: true },
];

/** Compact bottom nav for iPhone — 4 primary + More. */
export const BOTTOM_NAV: { key: string; label: string; href?: string; icon: LucideIcon; action?: "more" }[] = [
  { key: "dashboard", label: "Home", href: "/dashboard", icon: LayoutGrid },
  { key: "stock", label: "Stock", href: "/stock", icon: Layers },
  { key: "sales", label: "Sales", href: "/sales", icon: ShoppingCart },
  { key: "picking", label: "Pick", href: "/picking", icon: ScanLine },
  { key: "more", label: "More", icon: Factory, action: "more" },
];
