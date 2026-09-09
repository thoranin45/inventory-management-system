/**
 * Reusable scan state machine for the picking / packing consoles.
 *
 * Pure and framework-free so it can be unit-tested in isolation. The console
 * component owns the side effects (calling the backend, refocusing the input,
 * beeping); this only tracks *what the operator should see*.
 *
 * States are never colour-only — each carries a `label` and the console pairs
 * it with a distinct icon.
 */
export type ScanState = "READY" | "SCANNING" | "MATCHED" | "AMBIGUOUS" | "ERROR" | "COMPLETED";

export interface AmbiguityCandidate {
  allocation_id: number;
  batch_id: number | null;
  /** required quantity for this allocation */
  quantity: string;
  /** progress so far on the active field (picked_quantity or packed_quantity) */
  done: string;
  lot_no?: string | null;
  expiry_date?: string | null;
  days_to_expiry?: number | null;
  is_expired?: boolean;
  is_near_expiry?: boolean;
}

export interface ScanContext {
  state: ScanState;
  /** operator-facing message for the current state */
  message: string;
  /** the barcode currently being processed / last processed */
  code: string | null;
  /** candidates to disambiguate between (AMBIGUOUS only) */
  candidates: AmbiguityCandidate[];
  /** machine-readable backend code for the last error, when there was one */
  errorCode: string | null;
}

export type ScanEvent =
  | { type: "SUBMIT"; code: string }
  | { type: "MATCH"; message: string }
  | { type: "ERROR"; message: string; code?: string | null }
  | { type: "AMBIGUOUS"; message: string; candidates: AmbiguityCandidate[] }
  | { type: "AMBIGUITY_CANCELLED" }
  | { type: "COMPLETE"; message: string }
  | { type: "RESET"; message?: string };

export const READY_MESSAGE =
  "Scan or type a barcode. Focus stays on the scan field for the hardware scanner.";

export const initialScanContext: ScanContext = {
  state: "READY",
  message: READY_MESSAGE,
  code: null,
  candidates: [],
  errorCode: null,
};

export function scanReducer(ctx: ScanContext, event: ScanEvent): ScanContext {
  switch (event.type) {
    case "SUBMIT": {
      const code = event.code.trim();
      if (!code) return ctx; // ignore empty (duplicate Enter, stray key)
      return { state: "SCANNING", message: `Checking ${code}…`, code, candidates: [], errorCode: null };
    }
    case "MATCH":
      return { ...ctx, state: "MATCHED", message: event.message, candidates: [], errorCode: null };
    case "ERROR":
      return {
        ...ctx,
        state: "ERROR",
        message: event.message,
        candidates: [],
        errorCode: event.code ?? null,
      };
    case "AMBIGUOUS":
      return {
        ...ctx,
        state: "AMBIGUOUS",
        message: event.message,
        candidates: event.candidates,
        errorCode: "ALLOCATION_IDENTIFICATION_REQUIRED",
      };
    case "AMBIGUITY_CANCELLED":
      return { ...ctx, state: "READY", message: "Cancelled — scan again.", candidates: [], errorCode: null };
    case "COMPLETE":
      return { ...ctx, state: "COMPLETED", message: event.message, candidates: [], errorCode: null };
    case "RESET":
      return { ...initialScanContext, message: event.message ?? READY_MESSAGE };
    default:
      return ctx;
  }
}

/** FEFO order: earliest expiry first, nulls (no expiry) last, then allocation id. */
export function sortFefo(candidates: AmbiguityCandidate[]): AmbiguityCandidate[] {
  return [...candidates].sort((a, b) => {
    const ax = a.expiry_date ?? null;
    const bx = b.expiry_date ?? null;
    if (ax !== bx) {
      if (ax === null) return 1;
      if (bx === null) return -1;
      return ax < bx ? -1 : 1;
    }
    return a.allocation_id - b.allocation_id;
  });
}

export const SCAN_STATE_LABEL: Record<ScanState, string> = {
  READY: "Ready",
  SCANNING: "Scanning",
  MATCHED: "Matched",
  AMBIGUOUS: "Choose allocation",
  ERROR: "Error",
  COMPLETED: "Completed",
};
