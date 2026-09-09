import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TransferRoute } from "./transfer-route";

describe("TransferRoute", () => {
  it("renders SOURCE → TRANSIT → DESTINATION with decimal figures and the system-controlled note", () => {
    render(
      <TransferRoute
        sourceLabel="Main Warehouse"
        destinationLabel="Shop Warehouse"
        total="9.000"
        dispatched="9.000"
        inTransit="6.000"
        received="3.000"
      />,
    );
    expect(screen.getByText("Main Warehouse")).toBeInTheDocument();
    expect(screen.getByText("System transit")).toBeInTheDocument();
    expect(screen.getByText("Shop Warehouse")).toBeInTheDocument();
    // 2dp display of the decimal strings
    expect(screen.getAllByText("9.00").length).toBeGreaterThanOrEqual(1); // dispatched
    expect(screen.getByText("6.00")).toBeInTheDocument(); // in transit
    expect(screen.getByText("3.00")).toBeInTheDocument(); // received
    expect(screen.getByText(/system holding area/i)).toBeInTheDocument();
    expect(screen.getByText(/never selectable/i)).toBeInTheDocument();
  });
});
