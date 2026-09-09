import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TransferReceiveLine, validateTransferReceiveLine } from "./transfer-receive-line";
import type { ProductLite } from "@/lib/query/sales";

const coffee: ProductLite = { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica", barcode: "b1", track_batch: true, track_expiry: true };

describe("validateTransferReceiveLine — never blocks an expired-in-transit batch", () => {
  it("empty = ok, rejects non-positive / over-precise / over-outstanding", () => {
    expect(validateTransferReceiveLine("", "5.000")).toBeNull();
    expect(validateTransferReceiveLine("0", "5.000")).toMatch(/greater than 0/);
    expect(validateTransferReceiveLine("1.2345", "5.000")).toMatch(/3 decimal/);
    expect(validateTransferReceiveLine("6", "5.000")).toMatch(/Only 5.000 still in transit/);
    expect(validateTransferReceiveLine("5.000", "5.000")).toBeNull();
  });
});

describe("TransferReceiveLine", () => {
  it("shows dispatched / received / outstanding and a live 'in transit after' figure", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TransferReceiveLine
        anchorId="trl-1"
        product={coffee}
        productId={1}
        batchId={1}
        dispatched="5.000"
        received="2.000"
        outstanding="3.000"
        quantity={undefined}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("5.00")).toBeInTheDocument(); // dispatched
    await user.type(screen.getByLabelText("Receive now"), "1");
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("a fully-received line shows the done state and no input", () => {
    render(
      <TransferReceiveLine
        anchorId="trl-2"
        product={coffee}
        productId={1}
        batchId={1}
        dispatched="5.000"
        received="5.000"
        outstanding="0.000"
        quantity={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/line fully received/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Receive now")).toBeNull();
  });

  it("flags an expired-in-transit batch but still allows receiving it", () => {
    render(
      <TransferReceiveLine
        anchorId="trl-3"
        product={coffee}
        productId={1}
        batchId={7}
        batchExpiry={{ expiry_date: "2020-01-01", days_to_expiry: -2000, is_expired: true }}
        dispatched="5.000"
        received="0.000"
        outstanding="5.000"
        quantity="5"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Expired in transit — receive required/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Receive now")).toBeEnabled();
    expect(screen.queryByText(/still in transit for this line/i)).toBeNull(); // "5" ≤ "5.000" is valid
  });
});
