import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useScanner } from "./use-scanner";

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
