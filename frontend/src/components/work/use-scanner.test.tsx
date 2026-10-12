import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DEFAULT_SCANNER_TIMING, useScanner } from "./use-scanner";

// The dedupe window is measured against a real `Date.now()`. Under parallel
// Vitest worker load the wall-clock gap between two `user.type()` bursts can
// exceed `dedupeMs`, making the dedupe assertion flake. The dedupe test freezes
// `Date.now()` so elapsed time is deterministic (fake timers deadlock with
// userEvent + RTL, so a plain spy is used instead).
afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({ onScan }: { onScan: (c: string) => void }) {
  const s = useScanner({ onScan, timing: { dedupeMs: 200, minChars: 3 } });
  return (
    <div>
      <input aria-label="scan" {...s.inputProps} />
      <input aria-label="other" />
      <button onClick={s.submit}>Enter</button>
    </div>
  );
}

describe("useScanner", () => {
  it("submits the buffered barcode on a trailing Enter and clears the field", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    const input = screen.getByLabelText("scan");
    await user.type(input, "885000000001{Enter}");
    expect(onScan).toHaveBeenCalledExactlyOnceWith("885000000001");
    expect(input).toHaveValue("");
  });

  it("de-dupes an immediate repeat of the same code (double Enter / bounce)", async () => {
    // Freeze the clock so the two bursts are unambiguously inside dedupeMs,
    // regardless of how slow the worker is.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    const input = screen.getByLabelText("scan");
    await user.type(input, "ABCDEF{Enter}");
    await user.type(input, "ABCDEF{Enter}"); // Date.now() frozen → within dedupeMs
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  describe("default 120 ms dedupe window (controlled clock)", () => {
    // The consoles use DEFAULT_SCANNER_TIMING, so exercise the real default
    // window. Date.now() only moves when the test advances `clock`.
    let clock = 0;
    function DefaultHarness({ onScan }: { onScan: (c: string) => void }) {
      const s = useScanner({ onScan });
      return <input aria-label="scan" {...s.inputProps} />;
    }
    function setup() {
      clock = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
      const user = userEvent.setup();
      const onScan = vi.fn();
      render(<DefaultHarness onScan={onScan} />);
      return { user, onScan, input: screen.getByLabelText("scan") };
    }

    it("is 120 ms", () => {
      expect(DEFAULT_SCANNER_TIMING.dedupeMs).toBe(120);
    });

    it("drops a repeat of the same code 1 ms inside the window", async () => {
      const { user, onScan, input } = setup();
      await user.type(input, "ABCDEF{Enter}");
      clock += DEFAULT_SCANNER_TIMING.dedupeMs - 1;
      await user.type(input, "ABCDEF{Enter}");
      expect(onScan).toHaveBeenCalledExactlyOnceWith("ABCDEF");
    });

    it("accepts a repeat of the same code once the window has elapsed", async () => {
      const { user, onScan, input } = setup();
      await user.type(input, "ABCDEF{Enter}");
      clock += DEFAULT_SCANNER_TIMING.dedupeMs;
      await user.type(input, "ABCDEF{Enter}");
      expect(onScan).toHaveBeenCalledTimes(2);
      expect(onScan).toHaveBeenNthCalledWith(2, "ABCDEF");
    });

    it("measures the window from the last accepted scan, not from a dropped bounce", async () => {
      const { user, onScan, input } = setup();
      await user.type(input, "ABCDEF{Enter}"); // t0 accepted
      clock += 100;
      await user.type(input, "ABCDEF{Enter}"); // t0+100 dropped
      clock += 30;
      await user.type(input, "ABCDEF{Enter}"); // t0+130 ≥ 120 from t0 → accepted
      expect(onScan).toHaveBeenCalledTimes(2);
    });

    it("never de-dupes a different code, even at the same instant", async () => {
      const { user, onScan, input } = setup();
      await user.type(input, "ABCDEF{Enter}");
      await user.type(input, "GHIJKL{Enter}");
      expect(onScan).toHaveBeenNthCalledWith(1, "ABCDEF");
      expect(onScan).toHaveBeenNthCalledWith(2, "GHIJKL");
    });
  });

  it("does not submit strings shorter than minChars", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    await user.type(screen.getByLabelText("scan"), "ab{Enter}");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("does not capture keys globally — typing in another field never scans", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    await user.type(screen.getByLabelText("other"), "885000000001{Enter}");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("the Enter button submits whatever is in the buffer", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    await user.type(screen.getByLabelText("scan"), "XYZ123");
    await user.click(screen.getByRole("button", { name: "Enter" }));
    expect(onScan).toHaveBeenCalledExactlyOnceWith("XYZ123");
  });
});
