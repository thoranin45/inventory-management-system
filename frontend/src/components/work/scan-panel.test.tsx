import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

/* R5.0 characterization — the shared pick/pack scan surface (previously untested). */

import { ScanPanel } from "./scan-panel";
import type { UseScannerResult } from "./use-scanner";

function fakeScanner(): UseScannerResult {
  return {
    inputProps: {
      ref: React.createRef<HTMLInputElement>(),
      value: "",
      onChange: vi.fn(),
      onKeyDown: vi.fn(),
      inputMode: "text",
      autoComplete: "off",
      autoCorrect: "off",
      spellCheck: false,
    },
    value: "",
    submit: vi.fn(),
    focus: vi.fn(),
    clear: vi.fn(),
    isLikelyScan: false,
  } as unknown as UseScannerResult;
}

describe("ScanPanel — characterization (R5.0)", () => {
  it("shows the scan state word and the operator message", () => {
    render(<ScanPanel scanState="ERROR" message="That product isn’t on this order." scanner={fakeScanner()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/error/i);
    expect(screen.getByText("That product isn’t on this order.")).toBeInTheDocument();
  });

  it("Enter submits through the scanner hook (the same path as a hardware scan)", async () => {
    const user = userEvent.setup();
    const scanner = fakeScanner();
    render(<ScanPanel scanState="READY" message="" scanner={scanner} />);
    await user.click(screen.getByRole("button", { name: "Enter" }));
    expect(scanner.submit).toHaveBeenCalledTimes(1);
  });

  it("disabled blocks the input, Enter and the camera", () => {
    render(<ScanPanel scanState="SCANNING" message="" scanner={fakeScanner()} disabled onCameraOpen={vi.fn()} />);
    expect(screen.getByLabelText("Barcode scan input")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enter" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scan with camera" })).toBeDisabled();
  });

  it("a targeted line can be cleared", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ScanPanel scanState="READY" message="" scanner={fakeScanner()} targeting={{ label: "Scan Sea Salt", onClear }} />);
    expect(screen.getByText(/Scan Sea Salt/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel targeted scan" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("the sound toggle reflects and changes the setting", async () => {
    const user = userEvent.setup();
    const setEnabled = vi.fn();
    render(<ScanPanel scanState="READY" message="" scanner={fakeScanner()} sound={{ enabled: true, setEnabled }} />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    await user.click(box);
    expect(setEnabled).toHaveBeenCalledWith(false);
  });
});
