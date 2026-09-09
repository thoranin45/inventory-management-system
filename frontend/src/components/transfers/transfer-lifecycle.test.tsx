import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { TransferLifecycle } from "./transfer-lifecycle";

describe("TransferLifecycle", () => {
  it("maps Done / In progress / Not started across DRAFT→IN_TRANSIT→PARTIAL→COMPLETED", () => {
    render(<TransferLifecycle status="PARTIALLY_RECEIVED" />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Done")).toBeInTheDocument();
    expect(within(items[1]).getByText("Done")).toBeInTheDocument();
    expect(within(items[2]).getByText("In progress")).toBeInTheDocument();
    expect(within(items[3]).getByText("Not started")).toBeInTheDocument();
  });

  it("is not colour-only — a state word on every node", () => {
    render(<TransferLifecycle status="IN_TRANSIT" />);
    expect(screen.getAllByText(/Done|In progress|Not started/).length).toBe(4);
  });

  it("renders a single Cancelled node for a cancelled draft", () => {
    render(<TransferLifecycle status="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText("In transit")).toBeNull();
  });

  it("renders a distinct legacy-completed node with no pipeline", () => {
    render(<TransferLifecycle status="COMPLETED" legacyCompleted />);
    expect(screen.getByText(/legacy completed transfer/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("marks the current node blocked + aria-current when a reason is given", () => {
    render(<TransferLifecycle status="IN_TRANSIT" blockedReason="expired" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("In transit")).toHaveAttribute("aria-current", "step");
  });
});
