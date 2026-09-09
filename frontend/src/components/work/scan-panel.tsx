"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { ScanStatus } from "./scan-status";
import type { ScanState } from "./scan-machine";
import type { UseScannerResult } from "./use-scanner";
import { cn } from "@/lib/utils";

const BORDER: Record<ScanState, string> = {
  READY: "border-[var(--border-strong)]",
  SCANNING: "border-[var(--info)]",
  MATCHED: "border-[var(--success)]",
  AMBIGUOUS: "border-[color-mix(in_srgb,var(--warning)_55%,transparent)]",
  ERROR: "border-[var(--danger)]",
  COMPLETED: "border-[var(--accent)]",
};

/**
 * Presentational scan surface shared by the picking and packing consoles.
 * On desktop / iPad-landscape it is a bordered card inside the sticky work
 * side column; on phones the console drops it into a fixed bottom dock (the
 * `.wc-scan-dock` styling collapses the chrome to essentials).
 */
export function ScanPanel({
  scanState,
  message,
  scanner,
  onFocusChange,
  sound,
  disabled,
  hint,
}: {
  scanState: ScanState;
  message: string;
  scanner: UseScannerResult;
  onFocusChange?: (focused: boolean) => void;
  sound?: { enabled: boolean; setEnabled: (v: boolean) => void };
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  const soundId = React.useId();
  return (
    <div
      className={cn(
        "wc-scan-panel flex flex-col gap-3 rounded-[var(--r-lg)] border bg-[var(--surface)] p-4 transition-[border-color] duration-[var(--dur-2)]",
        BORDER[scanState],
      )}
    >
      <ScanStatus state={scanState} />
      <p className="wc-scan-msg min-h-[2.6em] text-[12.5px] text-[var(--muted)]">{message}</p>

      <div className="flex gap-2">
        <input
          {...scanner.inputProps}
          disabled={disabled}
          placeholder="Scan barcode…"
          aria-label="Barcode scan input"
          className="wc-scan-input h-11 min-w-0 flex-1 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-40"
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
        />
        <Button type="button" variant="secondary" onClick={scanner.submit} disabled={disabled}>
          Enter
        </Button>
      </div>

      <div className="wc-scan-focuslock flex items-center gap-[7px] text-[11px] text-[var(--faint)]">
        <span aria-hidden className="h-2 w-2 flex-none rounded-[2px] bg-[var(--success)]" />
        Focus stays here — hardware scanner ready
      </div>

      {sound ? (
        <label
          htmlFor={soundId}
          className="wc-scan-sound flex items-center gap-[6px] text-[11px] text-[var(--muted)]"
        >
          <input
            id={soundId}
            type="checkbox"
            checked={sound.enabled}
            onChange={(e) => sound.setEnabled(e.target.checked)}
          />
          audible scan feedback
        </label>
      ) : null}

      {hint ? <div className="wc-scan-hint text-[11px] leading-[1.7] text-[var(--faint)]">{hint}</div> : null}
    </div>
  );
}
