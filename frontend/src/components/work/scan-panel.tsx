"use client";

import * as React from "react";
import { Camera, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScanStatus } from "./scan-status";
import type { ScanState } from "./scan-machine";
import type { UseScannerResult } from "./use-scanner";
import { useT } from "@/lib/i18n/client";
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
  onCameraOpen,
  targeting,
}: {
  scanState: ScanState;
  message: string;
  scanner: UseScannerResult;
  onFocusChange?: (focused: boolean) => void;
  sound?: { enabled: boolean; setEnabled: (v: boolean) => void };
  disabled?: boolean;
  hint?: React.ReactNode;
  /** when provided, a camera button appears next to Enter (additive; the
   *  camera decoder feeds the SAME onScan path as hardware / manual). */
  onCameraOpen?: () => void;
  /** a line was tapped for [Scan +1] — the next scan is attributed to it */
  targeting?: { label: string; onClear: () => void };
}) {
  const t = useT();
  const soundId = React.useId();
  return (
    <div
      className={cn(
        "wc-scan-panel flex flex-col gap-3 rounded-[var(--r-lg)] border bg-[var(--surface)] p-4 transition-[border-color] duration-[var(--dur-2)]",
        BORDER[scanState],
      )}
    >
      <ScanStatus state={scanState} />

      {targeting ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--r-sm)] border border-[var(--accent)] bg-[var(--accent-subtle)] px-3 py-2 text-[12px] font-medium text-[var(--accent)]">
          <span>{t("fulfil.targetWaiting", { label: targeting.label })}</span>
          <button
            type="button"
            aria-label={t("fulfil.cancelTarget")}
            onClick={targeting.onClear}
            className="grid h-11 w-11 flex-none place-items-center rounded-[var(--r-sm)] hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] min-[1024px]:h-6 min-[1024px]:w-6"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <p className="wc-scan-msg min-h-[2.6em] text-[13px] text-[var(--muted)]" aria-live="polite">{message}</p>

      <div className="flex gap-2">
        <input
          {...scanner.inputProps}
          disabled={disabled}
          placeholder={t("fulfil.scanPlaceholder")}
          aria-label={t("task.scanInput")}
          className="wc-scan-input h-11 min-w-0 flex-1 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:opacity-40"
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
        />
        <Button type="button" variant="secondary" onClick={scanner.submit} disabled={disabled}>
          {t("task.enter")}
        </Button>
        {onCameraOpen ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("task.scanWithCamera")}
            title={t("task.scanWithCameraTitle")}
            onClick={onCameraOpen}
            disabled={disabled}
          >
            <Camera aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="wc-scan-focuslock flex items-center gap-[7px] text-[12px] text-[var(--faint)]">
        <span aria-hidden className="h-2 w-2 flex-none rounded-[2px] bg-[var(--success)]" />
        {t("fulfil.focusHere")}
      </div>

      {sound ? (
        <label
          htmlFor={soundId}
          className="wc-scan-sound flex min-h-11 items-center gap-[6px] text-[12px] text-[var(--muted)] min-[1024px]:min-h-0"
        >
          <input
            id={soundId}
            type="checkbox"
            checked={sound.enabled}
            onChange={(e) => sound.setEnabled(e.target.checked)}
          />
          {t("fulfil.audible")}
        </label>
      ) : null}

      {hint ? <div className="wc-scan-hint text-[12px] leading-[1.7] text-[var(--faint)]">{hint}</div> : null}
    </div>
  );
}
