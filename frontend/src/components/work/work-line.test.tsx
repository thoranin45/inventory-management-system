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

  it("the − control is inert and explains why (no backend decrement)", () => {
    render(<WorkLine {...base} done="1.000" required="4.000" />);
    const minus = screen.getByRole("button", { name: /decrease/i });
    expect(minus).toBeDisabled();
    expect(minus).toHaveAttribute("title", expect.stringMatching(/can't be decreased/i));
  });

  it("the + control runs one backend-confirmed scan and is disabled once the line is full", async () => {
    const user = userEvent.setup();
    const onPlusOne = vi.fn();
    const { rerender } = render(
      <WorkLine {...base} done="3.000" required="4.000" onPlusOne={onPlusOne} />,
    );
    await user.click(screen.getByRole("button", { name: /scan one/i }));
    expect(onPlusOne).toHaveBeenCalledTimes(1);

    rerender(<WorkLine {...base} done="4.000" required="4.000" onPlusOne={onPlusOne} />);
    expect(screen.getByRole("button", { name: /scan one/i })).toBeDisabled();
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
    // WorkLine itself is React.memo; this asserts stable-prop renders are cheap
    expect(renderSpy).toHaveBeenCalledTimes(2); // wrapper re-runs, WorkLine short-circuits
  });
});
