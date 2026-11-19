import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let role = "admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/session-provider", () => ({
  useSession: () => ({ user: { id: 1, username: "demo", role } }),
}));

const ok = <D,>(data: D) => ({ data, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });
const failed = () => ({ data: undefined, isLoading: false, isFetching: false, isError: true, error: new Error("boom"), refetch: vi.fn() });

const SUMMARY = {
  inventory: {
    owned_quantity: "8172.000",
    operational_available_quantity: "8021.000",
    reserved_quantity: "6.000",
    expired_quantity: "140.000",
    near_expiry_quantity: "2980.000",
    in_transit_quantity: "5.000",
  },
  sales: { DRAFT: 1, CONFIRMED: 1, PICKING: 1, PACKING: 0, READY_TO_SHIP: 1, shipped_today: 2, attention_required: 0 },
  purchase_orders: { DRAFT: 1, CONFIRMED: 0, PARTIALLY_RECEIVED: 1, received_today: 2, pending_receiving: 1 },
  transfers: { DRAFT: 1, IN_TRANSIT: 1, PARTIALLY_RECEIVED: 1, completed_today: 1 },
  generated_at: "2026-11-19T15:30:14.819963+00:00",
  as_of_date: "2026-11-19",
};
const ATTENTION = {
  low_operational_stock: 3,
  expired_inventory_products: 1,
  near_expiry_products: 3,
  sales_blocked_by_expiry: 0,
  sales_awaiting_picking: 1,
  sales_awaiting_packing: 0,
  sales_ready_to_ship: 1,
  po_partially_received: 1,
  transfers_in_transit: 1,
  transfers_partially_received: 1,
  as_of_date: "2026-11-19",
};
const batch = (days_to_expiry: number, batch_id: number) => ({
  batch_id, product_id: 1, lot_no: `LOT-${batch_id}`, quantity: "1.000", expiry_date: "2027-01-01", days_to_expiry,
});
// d30: 0 and 25 · d60: 45 · d90: 75 · later: 220
const NEAR = { items: [batch(0, 1), batch(25, 2), batch(45, 3), batch(75, 4), batch(220, 5)] };
const EXPIRED = { items: [batch(-9, 6)] };

const ledgerRow = (over: Record<string, unknown>) => ({
  id: 1, product_id: 7, batch_id: 9, warehouse_id: 1, location_id: 1,
  movement_type: "PURCHASE_RECEIPT", quantity: "120.000", balance_before: "0.000", balance_after: "120.000",
  reference_type: "PURCHASE_ORDER", reference_id: 3, reference_number: "PO-2087", remark: null,
  created_by_user_id: 1, created_at: "2026-11-19T03:42:00", occurred_at: "2026-11-19T03:42:00Z",
  timestamp_verified: true, direction: "IN", is_transit_leg: false,
  product: { id: 7, sku: "WH-COFFEE-1KG", product_name: "Arabica Coffee 1kg", is_active: true },
  batch: { id: 9, lot_no: "LOT-C2409", expiry_date: "2027-03-01" },
  warehouse: { id: 1, warehouse_code: "MAIN", warehouse_name: "Main", is_active: true },
  location: { id: 1, location_code: "A-01", location_name: null, is_active: true },
  created_by: { id: 1, username: "demo" },
  source: { type: "PURCHASE_ORDER", id: 3, number: "PO-2087", receipt_number: null },
  adjustment: null,
  remark_redacted: false,
  ...over,
});
const LEDGER = [
  ledgerRow({}),
  ledgerRow({
    id: 2, movement_type: "STOCK_OUT_FEFO", quantity: "-36.000", direction: "OUT", batch: null, batch_id: null,
    occurred_at: null, timestamp_verified: false, created_at: "2026-11-18T10:05:00",
    product: { id: 8, sku: "WH-OAT-500G", product_name: "Rolled Oats 500g", is_active: true },
    source: { type: "STOCK_TRANSACTION", id: 55, number: "ST-000482", receipt_number: null },
  }),
];

let sources: Record<string, unknown>;

vi.mock("@/lib/query/hooks", () => ({
  RECENT_ACTIVITY_LIMIT: 8,
  useDashboardSummary: () => sources.summary,
  useAttentionSummary: () => sources.attention,
  useProducts: () => sources.products,
  useRecentActivity: () => sources.ledger,
}));
vi.mock("@/lib/query/reports", () => ({
  useNearExpiryReport: () => sources.near,
  useExpiredStockReport: () => sources.expired,
}));
vi.mock("@/lib/query/stock-adjustment-requests", () => ({
  useStockAdjustmentRequests: () => sources.pending,
}));

import { DashboardView } from "./dashboard-view";
import { DASHBOARD_QUERY_KEYS } from "./quick-actions";
import { LanguageProvider } from "@/lib/i18n/client";
import { queryKeys } from "@/lib/query/keys";

function renderDashboard(locale: "en" | "th" = "en", client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider initialLocale={locale}>
        <DashboardView />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const kpis = () => within(screen.getByRole("region", { name: "Key figures" })).getAllByRole("link");

beforeEach(() => {
  role = "admin";
  // 2026-11-19 11:00 in Bangkok; only Date is faked
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T04:00:00Z"));
  sources = {
    summary: ok(SUMMARY),
    attention: ok(ATTENTION),
    products: ok({ items: [], pagination: { page: 1, page_size: 1, total_items: 128, total_pages: 128 } }),
    ledger: ok(LEDGER),
    near: ok(NEAR),
    expired: ok(EXPIRED),
    pending: ok({ items: [], pagination: { page: 1, page_size: 1, total_items: 4, total_pages: 4 } }),
  };
});
afterEach(() => vi.useRealTimers());

describe("DashboardView — UI-1 KPI strip", () => {
  it("admin sees the design's six counts, in order, each linking to the list it counts", () => {
    renderDashboard();
    expect(kpis().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Below reorder point 3", "/reports/low-stock"],
      ["Lots expiring in 90 days 4", "/reports/near-expiry?days=90"],
      ["Expired lots on hand 1", "/reports/expired"],
      ["Awaiting approval 4", "/stock-adjustments/approvals"],
      ["Orders to pick 2", "/picking"],
      ["Active SKUs 128", "/products"],
    ]);
  });

  it("warehouse sees receiving and its own open requests instead of approvals and the catalogue", () => {
    role = "warehouse";
    renderDashboard();
    expect(kpis().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Below reorder point 3", "/reports/low-stock"],
      ["Lots expiring in 90 days 4", "/reports/near-expiry?days=90"],
      ["Expired lots on hand 1", "/reports/expired"],
      ["Orders to pick 2", "/picking"],
      ["POs awaiting receipt 1", "/purchase-orders"],
      ["My open requests 4", "/stock-adjustments/mine?status=PENDING"],
    ]);
  });

  it("a failed source shows a dash with a spoken reason; the other tiles still show", () => {
    sources.pending = failed();
    renderDashboard();
    const approvals = kpis()[3];
    expect(approvals).toHaveTextContent("Awaiting approval —This figure could not be loaded");
    expect(kpis()[0]).toHaveTextContent("Below reorder point 3");
  });
});

describe("DashboardView — UI-1 quick actions", () => {
  it("admin: Stock in, Stock out and Review approvals with the pending count", () => {
    renderDashboard();
    expect(screen.getAllByRole("link", { name: /Stock In/ }).map((a) => a.getAttribute("href"))).toEqual(["/stock-in", "/stock-in"]);
    expect(screen.getAllByRole("link", { name: /Stock Out/ }).map((a) => a.getAttribute("href"))).toEqual(["/stock-out", "/stock-out"]);
    expect(screen.getByRole("link", { name: "Review approvals · 4" })).toHaveAttribute("href", "/stock-adjustments/approvals");
    expect(screen.queryByRole("link", { name: /Pick orders/ })).toBeNull();
  });

  it("warehouse: the primary action is the picking queue with its count", () => {
    role = "warehouse";
    renderDashboard();
    expect(screen.getByRole("link", { name: "Pick orders · 2" })).toHaveAttribute("href", "/picking");
    expect(screen.queryByRole("link", { name: /Review approvals/ })).toBeNull();
  });

  it("shows when the figures were taken, on the Bangkok clock", () => {
    renderDashboard();
    expect(screen.getByText("Updated 22:30")).toBeInTheDocument();
  });

  it("Refresh re-fetches every dashboard source", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderDashboard("en", client);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(spy.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey)).toEqual([...DASHBOARD_QUERY_KEYS]);
    expect(DASHBOARD_QUERY_KEYS).toContain(queryKeys.recentActivity);
  });
});

describe("DashboardView — UI-1 expiry horizon", () => {
  it("counts lots per bucket and in total", () => {
    renderDashboard();
    const list = screen.getByRole("list", { name: "Expiry horizon" });
    const counts = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(counts).toEqual(["Expired1", "Within 30 days2", "31–60 days1", "61–90 days1", "Over 90 days1"]);
    expect(screen.getByText("6 lots")).toBeInTheDocument();
  });

  it("a failed report shows the error instead of zeros", () => {
    sources.near = failed();
    renderDashboard();
    expect(screen.queryByRole("list", { name: "Expiry horizon" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /try again/i }).length).toBeGreaterThan(0);
  });
});

describe("DashboardView — UI-1 recent activity", () => {
  it("lists ledger rows with time, movement, product, lot, signed quantity and source", () => {
    renderDashboard();
    const table = screen.getByRole("table");
    const [, first, second] = within(table).getAllByRole("row");
    // verified, today in Bangkok → time only
    expect(within(first).getByText("10:42")).toBeInTheDocument();
    expect(within(first).getByText("PO receipt")).toBeInTheDocument();
    expect(within(first).getByText("Arabica Coffee 1kg")).toBeInTheDocument();
    expect(within(first).getByText("LOT-C2409")).toBeInTheDocument();
    expect(within(first).getByText("+120.000")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "PO-2087" })).toHaveAttribute("href", "/purchase-orders?search=PO-2087");
    // unverified → stored wall clock, dated and labelled, never converted
    expect(within(second).getByText("10:05")).toBeInTheDocument();
    expect(within(second).getByText("18 Nov 2026")).toBeInTheDocument();
    expect(within(second).getByText("zone unverified")).toBeInTheDocument();
    expect(within(second).getByText("−36.000")).toBeInTheDocument();
    expect(within(second).getByText("ST-000482")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open ledger/ })).toHaveAttribute("href", "/inventory/ledger");
  });

  it("no longer shows the old English relative day labels", () => {
    renderDashboard("th");
    expect(screen.queryByText("today")).toBeNull();
    expect(screen.queryByText(/\dd ago/)).toBeNull();
  });
});

describe("DashboardView — UI-1 Thai", () => {
  it("is translated, with the as-of date in the Buddhist era", () => {
    renderDashboard("th");
    expect(screen.getByRole("heading", { level: 1, name: "แดชบอร์ด" })).toBeInTheDocument();
    expect(screen.getByText(/ข้อมูล ณ 19 พ\.ย\. 2569/)).toBeInTheDocument();
    expect(screen.getByText("อัปเดต 22:30")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ตรวจคำขออนุมัติ · 4" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "ตัวเลขสำคัญ" })).getAllByRole("link")[1]).toHaveTextContent("ล็อตหมดอายุใน 90 วัน 4");
    expect(screen.getByRole("list", { name: "ช่วงวันหมดอายุ" })).toBeInTheDocument();
    expect(screen.getByText("18 พ.ย. 2569")).toBeInTheDocument();
    expect(screen.getAllByText("รับจากใบสั่งซื้อ").length).toBeGreaterThan(0);
  });
});
