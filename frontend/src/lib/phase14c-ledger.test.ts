import { describe, expect, it } from "vitest";

import { formatBusinessDateTime, formatSignedQty, formatStoredWallClock } from "./format";
import { isRedacted, ledgerEnvelope, ledgerTypeMeta, sourceLink, type LedgerItem } from "./api/schemas/inventory-movements";
import { MOVEMENT_TYPES } from "./api/schemas/reports";
import { warehouseListEnvelope } from "./api/schemas/warehouses";
import { pairsFromDirectory } from "@/components/transfers/create-transfer";
import { queryKeys } from "./query/keys";

describe("formatSignedQty — exact precision, explicit sign", () => {
  it.each([
    ["-0.005", "−0.005"],
    ["12.000", "+12.000"],
    ["1234567.250", "+1,234,567.250"],
    ["-1000.000", "−1,000.000"],
    ["0.000", "0.000"],
  ])("%s → %s", (raw, shown) => {
    expect(formatSignedQty(raw)).toBe(shown);
  });

  it("renders a dash for missing values", () => {
    expect(formatSignedQty(null)).toBe("—");
  });
});

describe("formatBusinessDateTime — Asia/Bangkok, explicit instants only", () => {
  it("converts UTC instants to the business clock, across midnight", () => {
    expect(formatBusinessDateTime("2026-10-09T16:59:59Z")).toBe("2026-10-09 23:59");
    expect(formatBusinessDateTime("2026-10-09T17:00:00Z")).toBe("2026-10-10 00:00");
    expect(formatBusinessDateTime("2026-10-10T00:00:00+07:00")).toBe("2026-10-10 00:00");
  });

  it("refuses offset-less (ambiguous) timestamps instead of guessing", () => {
    expect(formatBusinessDateTime("2026-10-09T17:00:00")).toBe("—");
    expect(formatBusinessDateTime(null)).toBe("—");
  });
});

const row = (over: Partial<LedgerItem>): LedgerItem =>
  ({
    movement_type: "STOCK_IN",
    remark_redacted: false,
    adjustment: null,
    source: { type: "STOCK_TRANSACTION", id: 9, number: null, receipt_number: null },
    ...over,
  }) as LedgerItem;

describe("formatStoredWallClock — unverified rows are shown as recorded", () => {
  it("never converts a naive value", () => {
    expect(formatStoredWallClock("2026-10-09T17:30:00")).toBe("2026-10-09 17:30");
    expect(formatStoredWallClock("2026-10-09T17:30:00.123456")).toBe("2026-10-09 17:30");
    expect(formatStoredWallClock(null)).toBe("—");
    expect(formatStoredWallClock("garbage")).toBe("—");
  });
});

describe("sourceLink (D6)", () => {
  it("links PO / SO / transfer numbers to their existing filtered list pages", () => {
    expect(sourceLink(row({ source: { type: "PURCHASE_ORDER", id: 1, number: "PO-000001", receipt_number: null } })))
      .toEqual({ kind: "list", href: "/purchase-orders?search=PO-000001", label: "PO-000001" });
    expect(sourceLink(row({ source: { type: "SALES_ORDER", id: 2, number: "SO-000002", receipt_number: null } })))
      .toEqual({ kind: "list", href: "/sales?search=SO-000002", label: "SO-000002" });
    expect(sourceLink(row({ source: { type: "INVENTORY_TRANSFER", id: 3, number: "TR 1", receipt_number: null } })))
      .toEqual({ kind: "list", href: "/transfers?search=TR%201", label: "TR 1" });
  });

  it("opens adjustment detail only when can_view_detail", () => {
    const adjustment = {
      linked: true, request_id: 41, reference_number: "ADJ-000041", reason_code: "DAMAGE", status: "APPROVED",
      requested_by: null, notes: null, can_view_detail: false, redacted: true,
    };
    const source = { type: "STOCK_ADJUSTMENT_REQUEST", id: 41, number: "ADJ-000041", receipt_number: null };
    expect(sourceLink(row({ source, adjustment }))).toEqual({ kind: "text", label: "ADJ-000041" });
    expect(sourceLink(row({ source, adjustment: { ...adjustment, can_view_detail: true, redacted: false } })))
      .toEqual({ kind: "adjustment", requestId: 41, label: "ADJ-000041" });
  });

  it("labels unlinked historical adjustments", () => {
    expect(sourceLink(row({ movement_type: "STOCK_ADJUST" }))).toEqual({ kind: "text", label: "Adjustment (unlinked)" });
    expect(sourceLink(row({}))).toEqual({ kind: "text", label: "TX-9" });
  });

  it("flags redaction from either the remark or the adjustment block", () => {
    expect(isRedacted(row({ remark_redacted: true }))).toBe(true);
    expect(isRedacted(row({}))).toBe(false);
  });
});

describe("schemas", () => {
  it("parses a ledger page with nullable location names and redacted adjustment fields", () => {
    const parsed = ledgerEnvelope.parse({
      success: true,
      data: {
        items: [
          {
            id: 1, product_id: 1, batch_id: null, warehouse_id: 1, location_id: 1, movement_type: "STOCK_ADJUST",
            quantity: "-2.000", balance_before: "5.000", balance_after: "3.000",
            reference_type: "STOCK_TRANSACTION", reference_id: 4, reference_number: null, remark: null,
            created_by_user_id: 1, created_at: "2026-01-01T00:00:00", occurred_at: null, timestamp_verified: false,
            direction: "OUT", is_transit_leg: false,
            product: { id: 1, sku: null, product_name: "P", is_active: false },
            batch: null,
            warehouse: { id: 1, warehouse_code: "W", warehouse_name: "W", is_active: false },
            location: { id: 1, location_code: "L", location_name: null, is_active: true },
            created_by: null,
            source: { type: "STOCK_TRANSACTION", id: 4, number: null, receipt_number: null },
            adjustment: {
              linked: false, request_id: null, reference_number: null, reason_code: null, status: null,
              requested_by: null, notes: null, can_view_detail: false, redacted: true,
            },
            remark_redacted: true,
          },
        ],
        pagination: { page: 1, page_size: 50, total_items: 1, total_pages: 1 },
      },
    });
    expect(parsed.data.items[0].location.location_name).toBeNull();
  });

  it("accepts a warehouse directory location without a name", () => {
    const parsed = warehouseListEnvelope.parse({
      data: [{ id: 1, warehouse_code: "W", warehouse_name: "W", warehouse_type: null, is_active: true,
        locations: [{ id: 2, location_code: "A1", location_name: null, location_type: null, is_active: true }] }],
    });
    expect(parsed.data[0].locations[0].location_name).toBeNull();
  });

  it("transaction-summary filter offers exactly the StockTransaction vocabulary", () => {
    expect([...MOVEMENT_TYPES].sort()).toEqual(
      ["ADJUST", "IN", "IN_BATCH", "IN_PO", "OUT_FEFO", "OUT_FIFO", "SALE_RETURN", "SALE_SHIPMENT"],
    );
  });

  it("maps every ledger movement type to a readable label", () => {
    expect(ledgerTypeMeta("TRANSFER_TRANSIT_IN").label).toBe("Into transit");
    expect(ledgerTypeMeta("SOMETHING_NEW").label).toBe("something new");
  });
});

describe("ledger query key (D10)", () => {
  it("includes the viewer id so per-user redacted responses never share a cache entry", () => {
    const a = queryKeys.inventoryLedger.list(1, { page: 1 });
    const b = queryKeys.inventoryLedger.list(2, { page: 1 });
    expect(a).not.toEqual(b);
    expect(a[0]).toBe("inventory-movements");
  });
});

describe("pairsFromDirectory — new transfer options", () => {
  it("includes empty active locations, excludes inactive warehouses and locations", () => {
    const pairs = pairsFromDirectory([
      { id: 1, warehouse_code: "MAIN", warehouse_name: "Main", warehouse_type: "MAIN", is_active: true, locations: [
        { id: 10, location_code: "A", location_name: "Aisle A", location_type: null, is_active: true },
        { id: 11, location_code: "B", location_name: null, location_type: null, is_active: false },
      ] },
      { id: 2, warehouse_code: "OLD", warehouse_name: "Old", warehouse_type: null, is_active: false, locations: [
        { id: 20, location_code: "Z", location_name: null, location_type: null, is_active: true },
      ] },
      { id: 3, warehouse_code: "SHOP", warehouse_name: "Shop", warehouse_type: null, is_active: true, locations: [
        { id: 30, location_code: "FRONT", location_name: null, location_type: null, is_active: true },
      ] },
    ]);
    expect(pairs.map((p) => p.key)).toEqual(["1:10", "3:30"]);
    expect(pairs.map((p) => p.label)).toEqual(["Main (MAIN) · Aisle A", "Shop (SHOP) · FRONT"]);
  });
});
