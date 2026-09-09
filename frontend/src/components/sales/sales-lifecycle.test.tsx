import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SalesLifecycle } from "./sales-lifecycle";

describe("SalesLifecycle", () => {
  it("marks steps before the current status Done, the current one In progress, later ones Not started", () => {
    render(<SalesLifecycle status="PICKING" />);
    const items = screen.getAllByRole("listitem");
    // DRAFT, CONFIRMED done · PICKING current · PACKING… not started
    expect(within(items[0]).getByText("Done")).toBeInTheDocument();
    expect(within(items[1]).getByText("Done")).toBeInTheDocument();
    expect(within(items[2]).getByText("In progress")).toBeInTheDocument();
    expect(within(items[3]).getByText("Not started")).toBeInTheDocument();
  });

  it("does not rely on colour alone — every node has a text state word", () => {
    render(<SalesLifecycle status="CONFIRMED" />);
    expect(screen.getAllByText(/Done|In progress|Not started/).length).toBeGreaterThanOrEqual(7);
  });

  it("shows the current step as Blocked when an attention_reason is present", () => {
    render(<SalesLifecycle status="CONFIRMED" attentionReason="expired_allocation" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    // the blocked node is the current step and carries aria-current
    expect(screen.getByText("Confirmed")).toHaveAttribute("aria-current", "step");
  });

  it("renders a single terminal Cancelled node (not the pipeline) for a cancelled order", () => {
    render(<SalesLifecycle status="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Picking")).toBeNull();
    expect(screen.queryByText("In progress")).toBeNull();
  });
});
