import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/* R5.0 characterization — Purchase Order detail drawer (previously untested). */

let detail: unknown;
let detailState = { isLoading: false, isError: false, error: undefined as unknown };
vi.mock("@/lib/query/purchase-orders", () => ({
  usePurchaseOrder: () => ({ data: detail, ...detailState, refetch: vi.fn() }),
}));
vi.mock("@/lib/query/sales", () => ({
  useProductLookup: () => ({
    data: {
      1: { id: 1, sku: "WH-CF", product_name: "Arabica 1kg", barcode: "b1", track_batch: true, track_expiry: true },
      3: { id: 3, sku: "WH-SUGAR", product_name: "Sugar 25kg", barcode: "b3", track_batch: false, track_expiry: false },
    },
  }),
}));
vi.mock("./po-actions", () => ({
  PurchaseOrderActions: (p: { id: number; status: string; poNumber: string | null; role: string }) => (
    <div data-testid="actions" data-id={p.id} data-status={p.status} data-po={p.poNumber ?? ""} data-role={p.role} />
  ),
}));

import { PurchaseOrderDetailDrawer } from "./po-detail";

const ROW = {
  id: 1,
  po_number: "PO-000001",
  supplier_id: 2,
  supplier_name: "Bean Co",
  status: "PARTIALLY_RECEIVED",
  ordered_quantity: "15.000",
  received_quantity: "5.000",
  remaining_quantity: "10.000",
  receiving_pct: 33.3,
  total_amount: "900.00",
  created_at: "2026-10-01T03:00:00Z",
  last_receipt_at: "2026-10-02T03:00:00Z",
  receipt_count: 1,
};
const DETAIL = {
  id: 1,
  po_number: "PO-000001",
  supplier_id: 2,
  status: "PARTIALLY_RECEIVED",
  total_amount: "900.00",
  created_at: "2026-10-01T03:00:00Z",
  items: [
    { id: 11, product_id: 1, quantity: "5.000", received_quantity: "5.000", remaining_quantity: "0.000", unit_price: "100.00", total_price: "500.00" },
    { id: 12, product_id: 3, quantity: "10.000", received_quantity: "0.000", remaining_quantity: "10.000", unit_price: "40.00", total_price: "400.00" },
  ],
};

beforeEach(() => {
  detail = DETAIL;
  detailState = { isLoading: false, isError: false, error: undefined };
});

const open = (role: "admin" | "warehouse" = "admin") =>
  render(<PurchaseOrderDetailDrawer row={ROW} open onOpenChange={() => {}} role={role} />);

describe("PurchaseOrderDetailDrawer — characterization (R5.0)", () => {
  it("shows identity, supplier and the total at two decimals", () => {
    open();
    expect(screen.getAllByText("PO-000001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bean Co").length).toBeGreaterThan(0);
    expect(screen.getAllByText("฿900.00").length).toBeGreaterThan(0);
  });

  it("lists every line by product name with ordered / received / remaining at three decimals", () => {
    open();
    expect(screen.getByText("Arabica 1kg")).toBeInTheDocument();
    expect(screen.getByText("Sugar 25kg")).toBeInTheDocument();
    expect(screen.getAllByText("10.000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.000").length).toBeGreaterThan(0);
  });

  it("states each line's tracking requirement from the product master", () => {
    open();
    expect(screen.getByText(/lot \+ manufacturing \+ expiry date required/i)).toBeInTheDocument();
    expect(screen.getByText(/non-batch — no lot or date entry/i)).toBeInTheDocument();
  });

  it("says plainly that individual historical receipts are not retrievable", () => {
    open();
    expect(screen.getByText(/individual historical receipts are not\s+retrievable/i)).toBeInTheDocument();
  });

  it("passes id, status, PO number and role to the actions", () => {
    open("warehouse");
    const a = screen.getByTestId("actions");
    expect(a).toHaveAttribute("data-id", "1");
    expect(a).toHaveAttribute("data-status", "PARTIALLY_RECEIVED");
    expect(a).toHaveAttribute("data-po", "PO-000001");
    expect(a).toHaveAttribute("data-role", "warehouse");
  });

  it("a failed detail load offers a retry", () => {
    detail = undefined;
    detailState = { isLoading: false, isError: true, error: new Error("boom") };
    open();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});
