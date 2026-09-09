import { describe, expect, it } from "vitest";

import {
  chartExpirySchema,
  chartSalesSchema,
  chartStockSchema,
  EXPORT_ROW_CAP_RE,
  expiredStockSchema,
  inTransitStockSchema,
  lowStockOperationalSchema,
  movementReportEnvelope,
  movementTypeLabel,
  nearExpiryStockSchema,
  numericString,
  operationalStockEnvelope,
  purchaseOrdersReportEnvelope,
  reportErrorCopy,
  REPORT_EXPORTS,
  salesReportEnvelope,
  salesSummarySchema,
  transfersReportEnvelope,
} from "./reports";
import {
  chartExpiryResponse,
  chartSalesResponse,
  chartStockResponse,
  expiredStockReportResponse,
  inTransitReportResponse,
  lowStockOperationalReportResponse,
  movementReportResponse,
  nearExpiryReportResponse,
  operationalStockReportResponse,
  purchaseOrderListResponse,
  salesOrderListResponse,
  salesSummaryResponse,
  transferListResponse,
} from "@/test/fixtures";

describe("numericString", () => {
  it("accepts a fixed-scale string and a bare number, normalising to string", () => {
    expect(numericString.parse("452.000")).toBe("452.000");
    expect(numericString.parse(3110)).toBe("3110");
    expect(numericString.parse(41409)).toBe("41409");
    expect(numericString.parse(12.5)).toBe("12.5");
  });
  it("rejects non-numeric", () => {
    expect(numericString.safeParse("abc").success).toBe(false);
  });
});

describe("report response schemas parse the live shapes", () => {
  it("operational-stock (enveloped, enriched product rows)", () => {
    const p = operationalStockEnvelope.parse(operationalStockReportResponse);
    expect(p.data.items[0].operational_available_quantity).toBe("392.000");
  });
  it("stock-movement (enveloped, paginated)", () => {
    const p = movementReportEnvelope.parse(movementReportResponse);
    expect(p.data.pagination.total_items).toBe(34);
    expect(p.data.items[1].remark).toBeNull();
  });
  it("expired-stock (bare {items}, quantity as number)", () => {
    const p = expiredStockSchema.parse(expiredStockReportResponse);
    expect(p.items[0].quantity).toBe("1");
    expect(p.items[0].days_to_expiry).toBe(-2443);
  });
  it("near-expiry-stock", () => {
    expect(nearExpiryStockSchema.parse(nearExpiryReportResponse).items).toHaveLength(2);
  });
  it("in-transit-stock (nullable batch, numeric qty)", () => {
    const p = inTransitStockSchema.parse(inTransitReportResponse);
    expect(p.items[0].batch_id).toBeNull();
    expect(p.items[0].on_hand_qty).toBe("50");
  });
  it("low-stock-operational (sku + name + numeric threshold)", () => {
    const p = lowStockOperationalSchema.parse(lowStockOperationalReportResponse);
    expect(p.items[0].threshold).toBe("10");
    expect(p.items[0].sku).toBe("WH-SUGAR-25KG");
  });
  it("sales / purchase-orders / transfers reports reuse the phase 3/5/6 envelopes", () => {
    expect(salesReportEnvelope.parse(salesOrderListResponse).data.items.length).toBeGreaterThan(0);
    expect(purchaseOrdersReportEnvelope.parse(purchaseOrderListResponse).data.items.length).toBeGreaterThan(0);
    expect(transfersReportEnvelope.parse(transferListResponse).data.items.length).toBeGreaterThan(0);
  });
  it("charts + sales-summary", () => {
    expect(salesSummarySchema.parse(salesSummaryResponse).total_sales_amount).toBe("41409");
    expect(chartSalesSchema.parse(chartSalesResponse)[0].sales).toBe("5000");
    expect(chartStockSchema.parse(chartStockResponse)[0].stock_qty).toBe("3110");
    const ex = chartExpirySchema.parse(chartExpiryResponse);
    expect(ex.map((r) => r.series)).toEqual(["expired", "near_expiry", "eligible"]);
  });
});

describe("movementTypeLabel", () => {
  it("maps known types and falls back readably", () => {
    expect(movementTypeLabel("IN_PO")).toBe("PO receipt");
    expect(movementTypeLabel("OUT_FEFO")).toBe("Pick (FEFO)");
    expect(movementTypeLabel("SOMETHING_NEW")).toBe("something new");
  });
});

describe("reportErrorCopy + EXPORT_ROW_CAP_RE", () => {
  it("recognises the dynamic export row-cap message", () => {
    const msg = "Export too large (73210 rows > 50000); narrow the filters and retry";
    expect(EXPORT_ROW_CAP_RE.test(msg)).toBe(true);
    expect(reportErrorCopy(msg)).toMatch(/too large.*narrow the filters/i);
  });
  it("maps the unknown-sort-field message", () => {
    expect(reportErrorCopy("Unknown sort field: bogus")).toMatch(/can't be sorted/i);
  });
  it("returns undefined for anything else", () => {
    expect(reportErrorCopy("Validation error")).toBeUndefined();
  });
});

describe("REPORT_EXPORTS descriptors", () => {
  it("are exactly the four backend exports, all through the BFF", () => {
    expect(REPORT_EXPORTS.map((e) => e.key).sort()).toEqual(["expiring", "low-stock", "sales", "stock"]);
    for (const e of REPORT_EXPORTS) expect(e.path.startsWith("/api/bff/reports/export/")).toBe(true);
    expect(REPORT_EXPORTS.find((e) => e.key === "low-stock")?.params?.[0].name).toBe("threshold");
    expect(REPORT_EXPORTS.find((e) => e.key === "expiring")?.params?.[0].name).toBe("days");
  });
});
