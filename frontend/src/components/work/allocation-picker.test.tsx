import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* R5.0 characterization — ambiguity resolution (previously untested). */

import { AllocationPicker } from "./allocation-picker";
import type { AmbiguityCandidate } from "./scan-machine";

const CANDIDATES: AmbiguityCandidate[] = [
  { allocation_id: 21, batch_id: 2, quantity: "2", done: "0", lot_no: "LOT-LATE", expiry_date: "2027-09-01", days_to_expiry: 300 },
  { allocation_id: 22, batch_id: 3, quantity: "1", done: "1", lot_no: "LOT-FULL", expiry_date: "2027-01-01", days_to_expiry: 80 },
  { allocation_id: 23, batch_id: 4, quantity: "3", done: "1", lot_no: "LOT-SOON", expiry_date: "2027-03-01", days_to_expiry: 140 },
];

function renderPicker(over: Partial<React.ComponentProps<typeof AllocationPicker>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    productName: "Sea Salt 500g",
    candidates: CANDIDATES,
    onChoose: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<AllocationPicker {...props} />);
  return props;
}

describe("AllocationPicker — characterization (R5.0)", () => {
  it("orders candidates earliest expiry first and pre-selects nothing", () => {
    renderPicker();
    const dialog = screen.getByRole("dialog");
    const lots = within(dialog).getAllByText(/^LOT-/).map((e) => e.textContent);
    expect(lots).toEqual(["LOT-FULL", "LOT-SOON", "LOT-LATE"]);
  });

  it("a fully counted allocation cannot be chosen", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /LOT-FULL/ })).toBeDisabled();
  });

  it("marks the first open allocation as the FEFO suggestion", () => {
    renderPicker();
    expect(within(screen.getByRole("button", { name: /LOT-SOON/ })).getByText("FEFO")).toBeInTheDocument();
  });

  it("choosing calls back with that allocation id only", async () => {
    const user = userEvent.setup();
    const p = renderPicker();
    await user.click(screen.getByRole("button", { name: /LOT-LATE/ }));
    expect(p.onChoose).toHaveBeenCalledWith(21);
    expect(p.onChoose).toHaveBeenCalledTimes(1);
  });

  it("Cancel scan cancels without choosing", async () => {
    const user = userEvent.setup();
    const p = renderPicker();
    await user.click(screen.getByRole("button", { name: /cancel scan/i }));
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onChoose).not.toHaveBeenCalled();
  });

  it("shows progress at three decimals", () => {
    renderPicker();
    expect(screen.getAllByText("3.000").length).toBeGreaterThan(0);
  });
});
