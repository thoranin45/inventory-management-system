import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Boxes,
  CalendarClock,
  ClipboardList,
  PackageX,
  ShoppingCart,
  Truck,
  TrendingDown,
  Warehouse,
} from "lucide-react";

export type ReportGroup = "Inventory" | "Orders";

export interface ReportDef {
  slug: string;
  title: string;
  /** one line for the landing card + the report header */
  blurb: string;
  group: ReportGroup;
  icon: LucideIcon;
  /** the backend endpoint is unpaginated → the screen shows all rows at once */
  unpaginated?: boolean;
}

export const REPORTS: ReportDef[] = [
  {
    slug: "operational-stock",
    title: "Operational stock",
    blurb: "Owned vs operational-available vs expired / near-expiry / transit, per product.",
    group: "Inventory",
    icon: Warehouse,
  },
  {
    slug: "expired",
    title: "Expired inventory",
    blurb: "Batches whose expiry date has passed — still owned, operationally ineligible.",
    group: "Inventory",
    icon: PackageX,
    unpaginated: true,
  },
  {
    slug: "near-expiry",
    title: "Near expiry",
    blurb: "In-date batches expiring within a chosen window.",
    group: "Inventory",
    icon: CalendarClock,
    unpaginated: true,
  },
  {
    slug: "in-transit",
    title: "In transit",
    blurb: "Stock currently held in the system transit warehouse.",
    group: "Inventory",
    icon: Truck,
    unpaginated: true,
  },
  {
    slug: "low-stock",
    title: "Low stock",
    blurb: "Products below their operational low-stock threshold (safety → minimum → default 10).",
    group: "Inventory",
    icon: TrendingDown,
    unpaginated: true,
  },
  {
    slug: "movements",
    title: "Movement history",
    blurb: "Bounded stock-transaction history with type and date filters.",
    group: "Inventory",
    icon: ClipboardList,
  },
  {
    slug: "sales",
    title: "Sales",
    blurb: "Sales orders — number, customer, status, quantity, amount, dates.",
    group: "Orders",
    icon: ShoppingCart,
  },
  {
    slug: "purchase-orders",
    title: "Purchase orders",
    blurb: "POs — supplier, status, ordered / received / remaining, total, last receipt.",
    group: "Orders",
    icon: Boxes,
  },
  {
    slug: "transfers",
    title: "Transfers",
    blurb: "Transfers — route, status, dispatched / received / outstanding, progress.",
    group: "Orders",
    icon: ArrowLeftRight,
  },
];

export const REPORTS_BY_SLUG: Record<string, ReportDef> = Object.fromEntries(REPORTS.map((r) => [r.slug, r]));

export const REPORT_GROUPS: ReportGroup[] = ["Inventory", "Orders"];
