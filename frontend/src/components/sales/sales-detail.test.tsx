import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/* R5.0 characterization — Sales Order detail drawer (previously untested). */

let detail: unknown;
let detailState = { isLoading: false, isError: false, error: undefined as unknown };
const refetch = vi.fn();
vi.mock("@/lib/query/sales", () => ({
  useSalesOrder: () => ({ data: detail, ...detailState, refetch }),
  useProductLookup: () => ({
    data: { 5: { id: 5, sku: "WH-SALT", product_name: "Sea Salt 500g", barcode: "880", track_batch: false, track_expiry: false } },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// actions + documents have their own suites; here only what the drawer passes them
vi.mock("./sales-actions", () => ({
  SalesActions: (p: { id: number; status: string; soNumber: string | null; role: string }) => (
    <div data-testid="actions" data-id={p.id} data-status={p.status} data-so={p.soNumber ?? ""} data-role={p.role} />
  ),
}));
vi.mock("./sales-documents", () => ({ SalesDocuments: ({ orderId }: { orderId: number }) => <div data-testid="documents" data-order={orderId} /> }));

import { SalesDetailDrawer } from "./sales-detail";

const ROW = {
  id: 7,
  so_number: "SO-000007",
  customer_id: 3,
  customer_name: "Acme Foods",
  status: "PACKING",
  item_count: 1,
  total_quantity: "2.500",
  total_amount: "1250.00",
  created_at: "2026-10-01T03:00:00Z",
  last_activity_at: "2026-10-02T03:00:00Z",
  picked_pct: 100,
  packed_pct: 40,
  attention_reason: null as string | null,
};
const DETAIL = {
  id: 7,
  so_number: "SO-000007",
  customer_id: 3,
  status: "PACKING",
  total_amount: "1250",
  created_at: "2026-10-01T03:00:00Z",
  items: [
    {
      id: 70,
      sales_order_id: 7,
      product_id: 5,
      quantity: "2.5",
      unit_price: "500",
      total_price: "1250",
      batch_allocations: [{ id: 1, batch_id: 9, quantity: "2.5" }],
      fulfillment_allocations: [
        { id: 8, batch_id: 9, stock_balance_id: 4, quantity: "2.5", picked_quantity: "2.5", packed_quantity: "1" },
      ],
    },
  ],
  picked_at: "2026-10-02T03:00:00Z",
  picked_by_user_id: 4,
  packed_at: null,
  packed_by_user_id: null,
  shipped_at: null,
  shipped_by_user_id: null,
  shipment_number: null,
};

beforeEach(() => {
  detail = DETAIL;
  detailState = { isLoading: false, isError: false, error: undefined };
});

const open = (row = ROW, role: "admin" | "warehouse" = "admin") =>
  render(<SalesDetailDrawer row={row} open onOpenChange={() => {}} role={role} />);

describe("SalesDetailDrawer — characterization (R5.0)", () => {
  it("shows the order identity, customer and money at two decimals", () => {
    open();
    expect(screen.getAllByText("SO-000007").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Acme Foods").length).toBeGreaterThan(0);
    expect(screen.getAllByText("฿1,250.00").length).toBeGreaterThan(0);
  });

  it("shows line and allocation quantities at three decimals (never rounded)", () => {
    open();
    expect(screen.getAllByText("2.500").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.000").length).toBeGreaterThan(0); // packed 1
  });

  it("passes id, live status, SO number and role to the actions", () => {
    open(ROW, "warehouse");
    const a = screen.getByTestId("actions");
    expect(a).toHaveAttribute("data-id", "7");
    expect(a).toHaveAttribute("data-status", "PACKING");
    expect(a).toHaveAttribute("data-so", "SO-000007");
    expect(a).toHaveAttribute("data-role", "warehouse");
  });

  it("documents appear only from READY_TO_SHIP on", () => {
    const { unmount } = open();
    expect(screen.queryByTestId("documents")).toBeNull();
    unmount();
    detail = { ...DETAIL, status: "READY_TO_SHIP" };
    open({ ...ROW, status: "READY_TO_SHIP" });
    expect(screen.getByTestId("documents")).toHaveAttribute("data-order", "7");
  });

  it("an attention reason is shown as an alert with the mapped copy", () => {
    open({ ...ROW, attention_reason: "expired_allocation" });
    expect(screen.getByRole("alert")).toHaveTextContent(/allocated batch has expired/i);
  });

  it("a failed detail load offers a retry", () => {
    detail = undefined;
    detailState = { isLoading: false, isError: true, error: new Error("boom") };
    open();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("the shipment number is shown once the backend has one", () => {
    detail = { ...DETAIL, status: "SHIPPED", shipped_at: "2026-10-03T03:00:00Z", shipment_number: "SHIP-000007" };
    open({ ...ROW, status: "SHIPPED" });
    expect(screen.getByText("SHIP-000007")).toBeInTheDocument();
  });
});
