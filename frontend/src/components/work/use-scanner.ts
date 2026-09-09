"use client";

import * as React from "react";

/**
 * Hardware-wedge scanner input hook.
 *
 * A wedge scanner behaves like a very fast keyboard that "types" the barcode
 * into the focused field and finishes with Enter. This hook:
 *   - owns ONE input (never a document-level key listener), so typing in any
 *     other field is unaffected;
 *   - treats a trailing Enter as "scan complete";
 *   - de-dupes a double Enter / repeated identical code inside `dedupeMs`;
 *   - tracks inter-key timing so the console can tell a scan burst from slow
 *     human typing (`isLikelyScan`) — but submission is always Enter-driven;
 *   - exposes `focus()` so the console can return focus after a scan without a
 *     re-render that would move the scroll position.
 *
 * All timings are configurable — no magic constants buried in components.
 */
export interface ScannerTiming {
  /** keys arriving faster than this (ms apart) look like a scanner, not a human */
  interKeyMs: number;
  /** ignore a repeat of the same code within this window (duplicate Enter) */
  dedupeMs: number;
  /** shortest string we will submit as a scan */
  minChars: number;
}

export const DEFAULT_SCANNER_TIMING: ScannerTiming = {
  interKeyMs: 35,
  // Short enough not to block deliberately scanning the same SKU repeatedly,
  // long enough to swallow a wedge scanner's double-fire / a bounced Enter.
  dedupeMs: 120,
  minChars: 3,
};

export interface UseScannerOptions {
  onScan: (code: string) => void;
  timing?: Partial<ScannerTiming>;
  disabled?: boolean;
}

export interface UseScannerResult {
  inputProps: {
    ref: React.RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    inputMode: "text";
    autoComplete: "off";
    autoCorrect: "off";
    spellCheck: false;
  };
  /** current field contents */
  value: string;
  setValue: (v: string) => void;
  /** programmatically submit whatever is in the buffer (the "Enter" button) */
  submit: () => void;
  /** focus the scan field (call after a successful scan) */
  focus: () => void;
  /** true when the last few keys arrived at scanner speed */
  isLikelyScan: boolean;
}

export function useScanner({ onScan, timing, disabled }: UseScannerOptions): UseScannerResult {
  const t = { ...DEFAULT_SCANNER_TIMING, ...timing };
  const ref = React.useRef<HTMLInputElement | null>(null);
  const [value, setValue] = React.useState("");
  const [isLikelyScan, setIsLikelyScan] = React.useState(false);

  const lastKeyAt = React.useRef(0);
  const fastKeys = React.useRef(0);
  const lastSubmit = React.useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const onScanRef = React.useRef(onScan);
  React.useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const focus = React.useCallback(() => {
    // rAF so focus lands after any pending DOM patch, without forcing a re-render
    requestAnimationFrame(() => ref.current?.focus());
  }, []);

  const submitCode = React.useCallback(
    (raw: string) => {
      const code = raw.trim();
      setValue("");
      setIsLikelyScan(false);
      fastKeys.current = 0;
      if (disabled) return;
      if (code.length < t.minChars) return;
      const now = Date.now();
      if (code === lastSubmit.current.code && now - lastSubmit.current.at < t.dedupeMs) {
        return; // duplicate Enter / bounce
      }
      lastSubmit.current = { code, at: now };
      onScanRef.current(code);
    },
    [disabled, t.minChars, t.dedupeMs],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitCode((e.currentTarget as HTMLInputElement).value);
        return;
      }
      if (e.key.length === 1) {
        const now = Date.now();
        const delta = now - lastKeyAt.current;
        lastKeyAt.current = now;
        if (delta <= t.interKeyMs) {
          fastKeys.current += 1;
          if (fastKeys.current >= 3 && !isLikelyScan) setIsLikelyScan(true);
        } else {
          fastKeys.current = 0;
          if (isLikelyScan) setIsLikelyScan(false);
        }
      }
    },
    [submitCode, t.interKeyMs, isLikelyScan],
  );

  const onChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  }, []);

  const submit = React.useCallback(() => submitCode(ref.current?.value ?? value), [submitCode, value]);

  return {
    inputProps: {
      ref,
      value,
      onChange,
      onKeyDown,
      inputMode: "text",
      autoComplete: "off",
      autoCorrect: "off",
      spellCheck: false,
    },
    value,
    setValue,
    submit,
    focus,
    isLikelyScan,
  };
}
