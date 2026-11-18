import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
 * R5.0 characterization — read-only packing slip / shipping label data
 * (previously untested). Asserts the DATA shown, not its layout, so it holds
 * across the R5 structured redesign (D-R5-8).
 */

let slip: { data?: unknown; isLoading: boolean; isError: boolean; error?: unknown };
let label: { data?: unknown; isLoading: boolean; isError: boolean; error?: unknown };
const refetch = vi.fn();
vi.mock("@/lib/query/sales", () => ({
  usePackingSlipData: () => ({ ...slip, refetch }),
  useShippingLabelData: () => ({ ...label, refetch }),
}));

import { PrintPreview } from "./print-preview";

const SLIP = {
  so_number: "SO-000007",
  status: "READY_TO_SHIP",
  created_at: "2026-10-01T03:00:00Z",
  shipment_number: null,
  customer: { id: 3, name: "Acme Foods", address: "1 Market Rd", phone: "0812345678" },
  items: [{ product_id: 5, quantity: "2.5", batch_allocations: [], fulfillment_allocations: [] }],
};
const LABEL = {
  so_number: "SO-000007",
  shipment_number: "SHIP-000007",
  status: "SHIPPED",
  shipped_at: "2026-10-03T03:00:00Z",
  ship_to: { name: "Acme Foods", address: "1 Market Rd", phone: "0812345678" },
  total_quantity: "2.5",
  order_barcode: "SO-000007",
};

beforeEach(() => {
  slip = { data: SLIP, isLoading: false, isError: false };
  label = { data: LABEL, isLoading: false, isError: false };
});

describe("PrintPreview — characterization (R5.0)", () => {
  it("shows the backend's slip and label data: order, shipment, customer and address", () => {
    render(<PrintPreview orderId={7} />);
    expect(screen.getAllByText(/SO-000007/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SHIP-000007/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Acme Foods/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 Market Rd/).length).toBeGreaterThan(0);
  });

  it("loading and failure states are honest, with a retry", () => {
    slip = { isLoading: true, isError: false };
    const { unmount } = render(<PrintPreview orderId={7} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();
    slip = { isLoading: false, isError: true, error: new Error("boom") };
    render(<PrintPreview orderId={7} />);
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("renders nothing when not enabled", () => {
    const { container } = render(<PrintPreview orderId={7} enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("never offers printing", () => {
    render(<PrintPreview orderId={7} />);
    expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
  });
});

describe("PrintPreview — structured documents (R5, D-R5-8)", () => {
  it("renders a packing slip and a shipping label as labelled documents, with 3-dp quantities", () => {
    render(<PrintPreview orderId={7} productName={(id) => (id === 5 ? "Jasmine Rice 5kg" : `#${id}`)} />);
    const slipDoc = screen.getByRole("article", { name: "Packing slip" });
    const labelDoc = screen.getByRole("article", { name: "Shipping label" });
    expect(slipDoc).toHaveTextContent("Jasmine Rice 5kg");
    expect(slipDoc).toHaveTextContent("2.500");
    expect(labelDoc).toHaveTextContent("Ship to");
    expect(labelDoc).toHaveTextContent("SHIP-000007");
    expect(labelDoc).toHaveTextContent("2.500");
  });

  it("a field the backend does not return reads as a dash — nothing is invented", () => {
    render(<PrintPreview orderId={7} />);
    const slipDoc = screen.getByRole("article", { name: "Packing slip" });
    // shipment_number is null on the slip
    expect(slipDoc).toHaveTextContent(/Shipment number\s*—/);
    // without a name resolver the line names the product id only
    expect(slipDoc).toHaveTextContent("Product #5");
  });

  it("is read-only: no print, download or label-generation control", () => {
    render(<PrintPreview orderId={7} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/print label|print slip|generate/i)).not.toBeInTheDocument();
  });
});
