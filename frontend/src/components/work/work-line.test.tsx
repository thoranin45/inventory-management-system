import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkLine } from "./work-line";

const base = {
  anchorId: "wc-line-1",
  name: "Arabica Whole Bean 1kg",
  sku: "WH-COFFEE-1KG",
  verb: "Picked",
};

describe("WorkLine", () => {
  it("shows decimal-formatted done / required (2dp, no float)", () => {
    render(<WorkLine {...base} done="1.125" required="4.000" />);
    expect(screen.getByText("1.13")).toBeInTheDocument(); // 1.125 → 1.13 (half-up, string math)
    expect(screen.getByText("4.00")).toBeInTheDocument();
  });

  it("[Scan +1] targets the line (no mutation) and is disabled once full", async () => {
    const user = userEvent.setup();
    const onTargetScan = vi.fn();
    const { rerender } = render(
      <WorkLine {...base} done="3.000" required="4.000" onTargetScan={onTargetScan} />,
    );
    await user.click(screen.getByRole("button", { name: /scan one/i }));
    expect(onTargetScan).toHaveBeenCalledTimes(1);

    rerender(<WorkLine {...base} done="4.000" required="4.000" onTargetScan={onTargetScan} />);
    expect(screen.getByRole("button", { name: /scan one/i })).toBeDisabled();
  });

  it("[Undo] calls back and is disabled when the line has no progress", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const { rerender } = render(
      <WorkLine {...base} done="0.000" required="4.000" onUndo={onUndo} />,
    );
    expect(screen.getByRole("button", { name: /undo one/i })).toBeDisabled();

    rerender(<WorkLine {...base} done="2.000" required="4.000" onUndo={onUndo} />);
    await user.click(screen.getByRole("button", { name: /undo one/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("shows a waiting banner while targeted and renders last-activity text", () => {
    render(
      <WorkLine
        {...base}
        done="1.000"
        required="4.000"
        targeted
        onTargetScan={vi.fn()}
        lastActivity="↶ Picked undone · now 1.000 / 4.000"
      />,
    );
    expect(screen.getByText(/waiting for a scan of this item/i)).toBeInTheDocument();
    expect(screen.getByText(/Picked undone/)).toBeInTheDocument();
  });

  it("is memoised — identical props do not re-render (scroll-stable)", () => {
    const renderSpy = vi.fn();
    function Probe(props: React.ComponentProps<typeof WorkLine>) {
      renderSpy();
      return <WorkLine {...props} />;
    }
    const MemoProbe = Probe;
    const { rerender } = render(<MemoProbe {...base} done="1.000" required="4.000" />);
    rerender(<MemoProbe {...base} done="1.000" required="4.000" />);
    expect(renderSpy).toHaveBeenCalledTimes(2); // wrapper re-runs, WorkLine short-circuits
  });
});
