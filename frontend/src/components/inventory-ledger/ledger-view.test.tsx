import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const replace = vi.fn();
let search = "";
let role = "warehouse";
const ledgerQueries: Record<string, unknown>[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/inventory/ledger",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { id: 7, role } }) }));
vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [] }, isFetching: false }),
}));
vi.mock("@/lib/query/warehouses", () => ({
  useWarehouses: () => ({
    data: [
      { id: 1, warehouse_code: "MAIN", warehouse_name: "Main", warehouse_type: "MAIN", is_active: true,
        locations: [{ id: 11, location_code: "DEFAULT", location_name: null, location_type: null, is_active: true }] },
      { id: 2, warehouse_code: "OLD", warehouse_name: "Closed depot", warehouse_type: null, is_active: false,
        locations: [] },
    ],
  }),
}));
vi.mock("@/components/stock-adjustments/request-detail", () => ({
  StockAdjustmentRequestDetailBody: ({ id }: { id: number }) => <div>request-detail-{id}</div>,
}));

const base = {
  product_id: 5, batch_id: null, warehouse_id: 1, location_id: 11,
  balance_before: "10.000", balance_after: "9.995", remark: null, created_by_user_id: 3,
  created_at: "2026-10-09T17:30:00", occurred_at: "2026-10-09T17:30:00Z", is_transit_leg: false,
  product: { id: 5, sku: "SKU-5", product_name: "Arabica 1kg", is_active: true },
  batch: null,
  warehouse: { id: 1, warehouse_code: "MAIN", warehouse_name: "Main", is_active: true },
  location: { id: 11, location_code: "DEFAULT", location_name: null, is_active: true },
  created_by: { id: 3, username: "admin_a" },
  remark_redacted: false,
};

const ROWS = [
  {
    ...base, id: 1, movement_type: "STOCK_OUT_FIFO", quantity: "-0.005", direction: "OUT",
    reference_type: "STOCK_TRANSACTION", reference_id: 90, reference_number: null,
    source: { type: "STOCK_TRANSACTION", id: 90, number: null, receipt_number: null }, adjustment: null,
  },
  {
    ...base, id: 2, movement_type: "PURCHASE_RECEIPT", quantity: "12.000", direction: "IN",
    reference_type: "PURCHASE_ORDER", reference_id: 4, reference_number: "PO-000004",
    source: { type: "PURCHASE_ORDER", id: 4, number: "PO-000004", receipt_number: "POR-abc" }, adjustment: null,
  },
  {
    ...base, id: 3, movement_type: "STOCK_ADJUST", quantity: "-2.000", direction: "OUT",
    reference_type: "STOCK_ADJUSTMENT_REQUEST", reference_id: 41, reference_number: "ADJ-000041",
    remark: "ADJ-000041: DAMAGE", remark_redacted: true,
    source: { type: "STOCK_ADJUSTMENT_REQUEST", id: 41, number: "ADJ-000041", receipt_number: null },
    adjustment: { linked: true, request_id: 41, reference_number: "ADJ-000041", reason_code: "DAMAGE",
      status: "APPROVED", requested_by: null, notes: null, can_view_detail: false, redacted: true },
  },
  {
    ...base, id: 4, movement_type: "STOCK_ADJUST", quantity: "3.000", direction: "IN",
    reference_type: "STOCK_ADJUSTMENT_REQUEST", reference_id: 42, reference_number: "ADJ-000042",
    remark: "ADJ-000042: DAMAGE",
    source: { type: "STOCK_ADJUSTMENT_REQUEST", id: 42, number: "ADJ-000042", receipt_number: null },
    adjustment: { linked: true, request_id: 42, reference_number: "ADJ-000042", reason_code: "DAMAGE",
      status: "APPROVED", requested_by: { id: 7, username: "me" }, notes: "my note",
      can_view_detail: true, redacted: false },
  },
];

vi.mock("@/lib/query/inventory-movements", () => ({
  useInventoryLedger: (query: Record<string, unknown>) => {
    ledgerQueries.push(query);
    return {
      data: { items: ROWS, pagination: { page: 1, page_size: 25, total_items: 60, total_pages: 3 } },
      isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn(),
    };
  },
}));

import { InventoryLedgerView } from "./ledger-view";

function setViewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Infinity);
    return {
      matches: width <= max, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

function lastReplaceQuery(): URLSearchParams {
  const url = String(replace.mock.calls.at(-1)?.[0] ?? "");
  return new URLSearchParams(url.split("?")[1] ?? "");
}

beforeEach(() => {
  replace.mockReset();
  ledgerQueries.length = 0;
  search = "";
  role = "warehouse";
  setViewport(1440);
  window.history.replaceState(null, "", "/inventory/ledger");
});

describe("InventoryLedgerView — desktop", () => {
  it("renders signed quantities at full precision and Bangkok time", () => {
    render(<InventoryLedgerView />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("−0.005")).toBeInTheDocument(); // never rounded away
    expect(screen.getByText("+12.000")).toBeInTheDocument();
    expect(screen.getAllByText("2026-10-10 00:30").length).toBeGreaterThan(0); // 17:30Z → 00:30 Bangkok
    expect(screen.getByText("Stock out (FIFO)")).toBeInTheDocument();
  });

  it("links PO references to the existing filtered list page", () => {
    render(<InventoryLedgerView />);
    expect(screen.getByRole("link", { name: "PO-000004" })).toHaveAttribute("href", "/purchase-orders?search=PO-000004");
  });

  it("opens adjustment detail only when the backend allows it, and marks redaction", () => {
    render(<InventoryLedgerView />);
    // Not viewable: plain text, no button, explicit indicator.
    expect(screen.queryByRole("button", { name: "ADJ-000041" })).not.toBeInTheDocument();
    expect(screen.getByText("ADJ-000041")).toBeInTheDocument();
    expect(screen.getAllByText("Private details hidden").length).toBe(1);
    // Viewable: opens the request drawer in place.
    fireEvent.click(screen.getByRole("button", { name: "ADJ-000042" }));
    expect(screen.getByText("request-detail-42")).toBeInTheDocument();
  });

  it("sends include_transit=false by default and true only when toggled", () => {
    render(<InventoryLedgerView />);
    expect(ledgerQueries.at(-1)?.include_transit).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /show in-transit legs/i }));
    expect(lastReplaceQuery().get("include_transit")).toBe("true");
  });

  it("restores filters from the URL and only sends a complete business-day range", () => {
    search = "warehouse_id=1&movement_group=ADJUSTMENT&from_date=2026-10-01&page=2";
    window.history.replaceState(null, "", `/inventory/ledger?${search}`);
    render(<InventoryLedgerView />);
    const q = ledgerQueries.at(-1)!;
    expect(q.warehouse_id).toBe("1");
    expect(q.movement_group).toBe("ADJUSTMENT");
    expect(q.page).toBe(2);
    expect(q.from_date).toBeUndefined(); // to_date missing → not sent
    expect(screen.getByRole("status")).toHaveTextContent(/both a From and a To date/i);
    expect((screen.getByLabelText("Warehouse") as HTMLSelectElement).value).toBe("1");
  });

  it("writes filter changes to the URL, resets page, and clears them", () => {
    search = "page=3&movement_group=IN";
    window.history.replaceState(null, "", `/inventory/ledger?${search}`);
    render(<InventoryLedgerView />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "TRANSFER" } });
    const q = lastReplaceQuery();
    expect(q.get("movement_group")).toBe("TRANSFER");
    expect(q.get("page")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(lastReplaceQuery().get("movement_group")).toBeNull();
  });

  it("labels inactive warehouses in the filter instead of hiding them", () => {
    render(<InventoryLedgerView />);
    const options = within(screen.getByLabelText("Warehouse")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("OLD · Closed depot (inactive)");
  });

  it("paginates through the URL", () => {
    render(<InventoryLedgerView />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(lastReplaceQuery().get("page")).toBe("2");
  });

  it("shows the actor filter to admins only", () => {
    render(<InventoryLedgerView />);
    expect(screen.queryByLabelText(/operator username/i)).not.toBeInTheDocument();
    role = "admin";
    search = "actor=alice";
    render(<InventoryLedgerView />);
    expect(screen.getByLabelText(/operator username/i)).toBeInTheDocument();
    expect(ledgerQueries.at(-1)?.actor).toBe("alice");
  });

  it("never forwards actor for a warehouse viewer even if it is in the URL", () => {
    search = "actor=alice";
    render(<InventoryLedgerView />);
    expect(ledgerQueries.at(-1)?.actor).toBeUndefined();
  });
});

describe("InventoryLedgerView — iPad and iPhone", () => {
  it("iPad landscape keeps the table but drops secondary columns", () => {
    setViewport(1100);
    render(<InventoryLedgerView />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Balance" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Quantity" })).toBeInTheDocument();
  });

  it("iPhone renders movement cards and collapses filters behind a toggle", () => {
    setViewport(390);
    render(<InventoryLedgerView />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByText("Arabica 1kg").length).toBe(ROWS.length);
    expect(screen.getByText("−0.005")).toBeInTheDocument();
    expect(screen.queryByLabelText("Warehouse")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByLabelText("Warehouse")).toBeInTheDocument();
  });
});
