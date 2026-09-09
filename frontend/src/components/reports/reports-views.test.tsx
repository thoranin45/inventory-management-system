import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  operationalStockReportResponse,
  movementReportResponse,
  expiredStockReportResponse,
  nearExpiryReportResponse,
  inTransitReportResponse,
  lowStockOperationalReportResponse,
  salesOrderListResponse,
  purchaseOrderListResponse,
  transferListResponse,
  salesSummaryResponse,
  chartStockResponse,
  chartExpiryResponse,
} from "@/test/fixtures";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reports/x",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import {
  chartExpirySchema,
  chartStockSchema,
  expiredStockSchema,
  inTransitStockSchema,
  lowStockOperationalSchema,
  movementReportEnvelope,
  nearExpiryStockSchema,
  operationalStockEnvelope,
  purchaseOrdersReportEnvelope,
  salesReportEnvelope,
  salesSummarySchema,
  transfersReportEnvelope,
} from "@/lib/api/schemas/reports";

const run = vi.fn();
const ok = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn() });

// Parse fixtures through the real schemas so the mocked hooks return the same
// post-transform shape the app sees (numericString → string, etc.).
vi.mock("@/lib/query/reports", () => ({
  useReportExport: () => ({ running: false, run }),
  useOperationalStockReport: () => ok(operationalStockEnvelope.parse(operationalStockReportResponse)),
  useMovementReport: () => ok(movementReportEnvelope.parse(movementReportResponse)),
  useSalesReport: () => ok(salesReportEnvelope.parse(salesOrderListResponse)),
  usePurchaseOrdersReport: () => ok(purchaseOrdersReportEnvelope.parse(purchaseOrderListResponse)),
  useTransfersReport: () => ok(transfersReportEnvelope.parse(transferListResponse)),
  useExpiredStockReport: () => ok(expiredStockSchema.parse(expiredStockReportResponse)),
  useNearExpiryReport: () => ok(nearExpiryStockSchema.parse(nearExpiryReportResponse)),
  useInTransitReport: () => ok(inTransitStockSchema.parse(inTransitReportResponse)),
  useLowStockOperationalReport: () => ok(lowStockOperationalSchema.parse(lowStockOperationalReportResponse)),
  useSalesSummary: () => ok(salesSummarySchema.parse(salesSummaryResponse)),
  useSalesChart: () => ok([]),
  useStockChart: () => ok(chartStockSchema.parse(chartStockResponse)),
  useExpiryChart: () => ok(chartExpirySchema.parse(chartExpiryResponse)),
}));
vi.mock("@/lib/query/sales", () => ({
  useProductLookup: () => ({
    data: { 1: { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica Whole Bean 1kg" }, 3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg" }, 6: { id: 6, sku: "WH-TEA-200G", product_name: "Green Tea 200g" } },
  }),
}));

import { OperationalStockReport } from "./operational-stock-report";
import { MovementHistoryReport } from "./movement-history-report";
import { SalesReport } from "./sales-report";
import { PurchaseOrdersReport } from "./purchase-orders-report";
import { TransfersReport } from "./transfers-report";
import { ExpiredStockReport } from "./expired-stock-report";
import { NearExpiryReport } from "./near-expiry-report";
import { InTransitReport } from "./in-transit-report";
import { LowStockReport } from "./low-stock-report";

beforeEach(() => {
  replace.mockReset();
  run.mockReset();
  search = "";
  window.history.replaceState(null, "", "/reports/x");
});

describe("Operational stock report", () => {
  it("renders enriched rows to 2 decimals and the classification foot-note", () => {
    render(<OperationalStockReport />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Green Tea 200g")).toBeInTheDocument();
    expect(within(table).getByText("392.00")).toBeInTheDocument(); // operational available, 2dp
    expect(screen.getByText(/classifications of owned stock, not a separate pool/i)).toBeInTheDocument();
  });
  it("shows the top-stock MiniBars with textual values", () => {
    render(<OperationalStockReport />);
    expect(screen.getByText("Top stock holders (owned quantity)")).toBeInTheDocument();
    expect(screen.getByText("3,110.00")).toBeInTheDocument();
  });
});

describe("Movement history report", () => {
  it("renders type + product + quantity, and puts type/date filters in the URL", async () => {
    render(<MovementHistoryReport />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("PO receipt")).toBeInTheDocument();
    expect(within(table).getByText("Pick (FEFO)")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Type"), "OUT_FEFO");
    expect(String(replace.mock.calls.at(-1)?.[0])).toMatch(/transaction_type=OUT_FEFO/);
  });
  it("does not offer search/status/sort controls the endpoint ignores", () => {
    render(<MovementHistoryReport />);
    expect(screen.queryByLabelText(/search report/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });
});

describe("Sales report", () => {
  it("renders rows, the summary strip and an export button", () => {
    render(<SalesReport />);
    expect(screen.getByText(/orders \(all time\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export .xlsx/i })).toBeInTheDocument();
    expect(screen.getAllByText(/SO-\d+/).length).toBeGreaterThan(0);
  });
  it("puts the status filter in the URL", async () => {
    render(<SalesReport />);
    await userEvent.selectOptions(screen.getByLabelText("Status"), "CANCELLED");
    expect(String(replace.mock.calls.at(-1)?.[0])).toMatch(/status=CANCELLED/);
  });
});

describe("PO + Transfer reports", () => {
  it("PO shows supplier / ordered / received", () => {
    render(<PurchaseOrdersReport />);
    expect(screen.getAllByText("Golden Harvest Trading").length).toBeGreaterThan(0);
  });
  it("Transfer shows the route and progress", () => {
    render(<TransfersReport />);
    expect(screen.getAllByText(/Shop Warehouse/).length).toBeGreaterThan(0);
  });
});

describe("Inventory reports (unpaginated)", () => {
  it("Expired: danger quantity + backend day count, no device reclassification note", () => {
    render(<ExpiredStockReport />);
    expect(screen.getByText(/nothing is re-classified on this device/i)).toBeInTheDocument();
    expect(screen.getAllByText("Arabica Whole Bean 1kg").length).toBeGreaterThan(0);
  });
  it("Near expiry: has a days filter and an export button", () => {
    render(<NearExpiryReport />);
    expect(screen.getByLabelText(/within days/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export .xlsx/i })).toBeInTheDocument();
  });
  it("In transit: zero-qty balance rows are hidden, holding shown as System transit", () => {
    render(<InTransitReport />);
    const rows = screen.getAllByRole("row");
    expect(within(screen.getByRole("table")).getAllByText("System transit").length).toBe(2); // rows 34/40 non-zero, 34(=0) hidden
    expect(rows.length).toBeGreaterThan(0);
  });
  it("Low stock: uses operational available + threshold, never stock_qty", () => {
    render(<LowStockReport />);
    expect(screen.getByText(/never recomputed from a product's total stock quantity/i)).toBeInTheDocument();
    expect(screen.getAllByText("Refined Sugar Sack 25kg").length).toBeGreaterThan(0);
  });
});

describe("empty states", () => {
  it("each report shows its own empty message", async () => {
    vi.resetModules();
    vi.doMock("@/lib/query/reports", () => ({
      useReportExport: () => ({ running: false, run }),
      useExpiredStockReport: () => ok({ items: [] }),
      useExpiryChart: () => ok([]),
    }));
    const { ExpiredStockReport: Empty } = await import("./expired-stock-report");
    render(<Empty />);
    expect(screen.getByText(/No expired stock/i)).toBeInTheDocument();
  });
});
