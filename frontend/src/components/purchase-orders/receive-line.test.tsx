import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReceiveLine, validateReceiveLine } from "./receive-line";
import type { ProductLite } from "@/lib/query/sales";

const batchExpiry: ProductLite = { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica", barcode: "b1", track_batch: true, track_expiry: true };
const batchOnly: ProductLite = { id: 9, sku: "WH-OIL", product_name: "Oil", barcode: "b9", track_batch: true, track_expiry: false };
const nonBatch: ProductLite = { id: 3, sku: "WH-SUGAR-25KG", product_name: "Sugar", barcode: "b3", track_batch: false, track_expiry: false };

describe("validateReceiveLine — mirrors backend rules but NEVER blocks an allowed date", () => {
  it("empty line = no error (not part of the receipt)", () => {
    expect(validateReceiveLine(nonBatch, {}, "10.000")).toBeNull();
  });
  it("rejects non-positive / over-precise / over-remaining quantities", () => {
    expect(validateReceiveLine(nonBatch, { quantity: "0" }, "10.000")).toMatch(/greater than 0/);
    expect(validateReceiveLine(nonBatch, { quantity: "1.2345" }, "10.000")).toMatch(/3 decimal/);
    expect(validateReceiveLine(nonBatch, { quantity: "11" }, "10.000")).toMatch(/Only 10.000 remaining/);
  });
  it("batch product requires a lot; expiry-tracked requires both dates; expiry must beat mfg", () => {
    expect(validateReceiveLine(batchExpiry, { quantity: "1" }, "10.000")).toMatch(/Lot number is required/);
    expect(validateReceiveLine(batchExpiry, { quantity: "1", lot_no: "L" }, "10.000")).toMatch(/Manufacturing and expiry/);
    expect(
      validateReceiveLine(batchExpiry, { quantity: "1", lot_no: "L", mfg_date: "2027-01-01", expiry_date: "2026-01-01" }, "10.000"),
    ).toMatch(/after the manufacturing date/);
    expect(validateReceiveLine(batchOnly, { quantity: "1", lot_no: "L" }, "10.000")).toBeNull(); // dates optional
  });
  it("non-batch product must NOT carry lot/date metadata", () => {
    expect(validateReceiveLine(nonBatch, { quantity: "1", lot_no: "NOPE" }, "10.000")).toMatch(/not batch-tracked/);
  });
  it("an ALREADY-EXPIRED expiry date is accepted (no error) — Phase 7 allows it inbound", () => {
    expect(
      validateReceiveLine(
        batchExpiry,
        { quantity: "1", lot_no: "L", mfg_date: "2019-01-01", expiry_date: "2020-01-01" },
        "10.000",
      ),
    ).toBeNull();
  });
});

describe("ReceiveLine rendering", () => {
  it("shows ordered / received / remaining and a live 'remaining after' figure", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReceiveLine
        anchorId="rl-1"
        product={nonBatch}
        productId={3}
        ordered="20.000"
        receivedToDate="5.000"
        remaining="15.000"
        line={{}}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("20.00")).toBeInTheDocument(); // ordered (2dp display)
    await user.type(screen.getByLabelText("Receive now"), "4");
    expect(onChange).toHaveBeenCalledWith({ quantity: "4" });
  });

  it("a fully received line shows 'line fully received' and no inputs", () => {
    render(
      <ReceiveLine
        anchorId="rl-2"
        product={nonBatch}
        productId={3}
        ordered="20.000"
        receivedToDate="20.000"
        remaining="0.000"
        line={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/line fully received/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Receive now")).toBeNull();
  });

  it("flags an entered expired date without blocking it", () => {
    render(
      <ReceiveLine
        anchorId="rl-3"
        product={batchExpiry}
        productId={1}
        ordered="10.000"
        receivedToDate="0.000"
        remaining="10.000"
        line={{ quantity: "1", lot_no: "L", mfg_date: "2019-01-01", expiry_date: "2020-01-01" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/accepted inbound/i)).toBeInTheDocument();
    expect(screen.queryByText(/after the manufacturing date/i)).toBeNull();
  });
});
