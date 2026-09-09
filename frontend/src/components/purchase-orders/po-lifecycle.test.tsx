import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { PurchaseOrderLifecycle } from "./po-lifecycle";

describe("PurchaseOrderLifecycle", () => {
  it("maps DONE / IN PROGRESS / NOT STARTED across the DRAFT→CONFIRMED→PARTIAL→RECEIVED pipeline", () => {
    render(<PurchaseOrderLifecycle status="PARTIALLY_RECEIVED" />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Done")).toBeInTheDocument(); // DRAFT
    expect(within(items[1]).getByText("Done")).toBeInTheDocument(); // CONFIRMED
    expect(within(items[2]).getByText("In progress")).toBeInTheDocument(); // PARTIALLY_RECEIVED
    expect(within(items[3]).getByText("Not started")).toBeInTheDocument(); // RECEIVED
  });

  it("is not colour-only — every node carries a state word", () => {
    render(<PurchaseOrderLifecycle status="CONFIRMED" />);
    expect(screen.getAllByText(/Done|In progress|Not started/).length).toBe(4);
  });

  it("renders a single terminal Cancelled node for a cancelled PO", () => {
    render(<PurchaseOrderLifecycle status="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Partially received")).toBeNull();
  });

  it("marks the current node blocked + aria-current when a blocked reason is given", () => {
    render(<PurchaseOrderLifecycle status="PARTIALLY_RECEIVED" blockedReason="stuck" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Partially received")).toHaveAttribute("aria-current", "step");
  });
});
