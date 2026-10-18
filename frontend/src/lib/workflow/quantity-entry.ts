import { isApiError } from "@/lib/api/errors";

/**
 * R4-TQ — typed decimal quantity entry for Stock In / Stock Out, and the
 * attempt record that locks a session once a mutation may have reached the
 * server.
 *
 * Pure helpers only: no React, no network. The consoles own the wiring.
 */

/* --------------------------------------------------------------- modes --- */

/** How a session's quantity is produced. Absent on R4 drafts = "scan". */
export type EntryMode = "scan" | "typed";

/* ----------------------------------------------------- typed quantity --- */

/**
 * The backend contract (StockIn / StockOut / BatchCreate):
 * `Decimal(gt=0, max_digits=18, decimal_places=3)` — so at most 3 decimals and
 * at most 15 integer digits. Text is parsed as a string, never as a float.
 */
const MAX_INTEGER_DIGITS = 15;
const SCALE = 3;

export type TypedQuantity =
  /** nothing entered */
  | { status: "empty" }
  /** mid-typing ("1.", "-", "."): shown neutrally, never an error */
  | { status: "partial" }
  /** zero or negative */
  | { status: "not_positive" }
  /** more than three decimal places */
  | { status: "too_precise" }
  /** more than the backend's 15 integer digits */
  | { status: "too_large" }
  /** anything else that is not a plain decimal (1e3, NaN, 1,000, .5 …) */
  | { status: "invalid" }
  /** a submittable quantity; `canonical` always has exactly three decimals */
  | { status: "valid"; canonical: string };

/** Fixed three-decimal text of a valid digits/fraction pair (exact, no rounding). */
function canonicalOf(intPart: string, frac: string): string {
  const int = intPart.replace(/^0+(?=\d)/, "");
  return `${int}.${frac.padEnd(SCALE, "0")}`;
}

export function parseTypedQuantity(raw: string): TypedQuantity {
  const v = raw.trim();
  if (v === "") return { status: "empty" };
  if (v === "." || v === "-" || /^\d+\.$/.test(v)) return { status: "partial" };
  if (/^-\d+(\.\d+)?$/.test(v)) return { status: "not_positive" };
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return { status: "invalid" };
  const [, intPart, frac = ""] = m;
  if (frac.length > SCALE) return { status: "too_precise" };
  if (intPart.replace(/^0+(?=\d)/, "").length > MAX_INTEGER_DIGITS) return { status: "too_large" };
  if (/^0+$/.test(intPart) && /^0*$/.test(frac)) return { status: "not_positive" };
  return { status: "valid", canonical: canonicalOf(intPart, frac) };
}

/** Thousandths as a BigInt (input must be a canonical quantity). */
const toMilli = (canonical: string) => BigInt(canonical.replace(".", ""));
function fromMilli(milli: bigint): string {
  const s = milli.toString().padStart(SCALE + 1, "0");
  return `${s.slice(0, -SCALE)}.${s.slice(-SCALE)}`;
}

/**
 * The ±1 stepper (TQ-6), exact. Empty steps up to 1.000. Returns null when the
 * step is not allowed: partial / malformed text, a result that would not be
 * positive, or one beyond the backend limit.
 */
export function stepTypedQuantity(raw: string, delta: 1 | -1): string | null {
  const parsed = parseTypedQuantity(raw);
  let base: bigint;
  if (parsed.status === "empty") base = 0n;
  else if (parsed.status === "valid") base = toMilli(parsed.canonical);
  else return null;
  const next = base + BigInt(delta) * 1000n;
  if (next <= 0n) return null;
  const text = fromMilli(next);
  return parseTypedQuantity(text).status === "valid" ? text : null;
}

/* ------------------------------------------------- outcome of a request -- */

export type StockEndpoint = "stock/in" | "batches" | "stock/out-fifo" | "stock/out-fefo";
export type AttemptOutcome = "mismatch" | "definitive" | "uncertain";

/**
 * Rejections VERIFIED to mean "this request posted nothing" (R4-TQ review of
 * app/services/stock_service.py and batch_service.py at fd78313):
 *  - every one is an AppException raised by the service AFTER its
 *    Idempotency-Key replay check found no stored receipt and BEFORE any
 *    write is committed (stock services: inside UnitOfWork, which rolls back
 *    on exceptions; batch service: before its UnitOfWork opens);
 *  - "Validation error" (422) is FastAPI request validation, rejected before
 *    the endpoint runs — deterministic for an identical body;
 *  - the app's error handler returns `exc.message` verbatim, and the BFF only
 *    ever substitutes its own generic copy, so an exact (status, message)
 *    match cannot be produced by the BFF.
 * Anything else — other 4xx, unverified 409s, 408, 429, 5xx, network,
 * malformed responses — stays UNCERTAIN.
 */
const COMMON: ReadonlyArray<readonly [number, string]> = [
  [404, "Product not found"],
  [422, "Validation error"],
];
const DEFINITIVE: Record<StockEndpoint, ReadonlyArray<readonly [number, string]>> = {
  "stock/in": [
    ...COMMON,
    [409, "Batch-tracked products must be received with a lot number via POST /batches, not direct stock in"],
  ],
  batches: [
    ...COMMON,
    [409, "This product is not batch-tracked — add stock directly via POST /stock/in, not as a batch"],
    [409, "Lot number already exists"],
    [422, "Expiry-tracked product requires manufacturing and expiry dates"],
    [400, "Supply both manufacturing and expiry dates, or neither"],
    [400, "Expiry date must be after manufacturing date"],
  ],
  "stock/out-fifo": [...COMMON, [409, "Not enough stock"], [409, "Not enough batch stock"]],
  "stock/out-fefo": [...COMMON, [409, "Not enough stock"], [409, "Not enough batch stock"]],
};

export function classifyAttemptOutcome(
  error: unknown,
  endpoint: StockEndpoint,
  isMismatch: (error: unknown) => boolean,
): AttemptOutcome {
  if (isMismatch(error)) return "mismatch";
  if (!isApiError(error) || error.kind === "network" || error.kind === "parse") return "uncertain";
  const verified = DEFINITIVE[endpoint].some(([status, message]) => error.status === status && error.message === message);
  return verified ? "definitive" : "uncertain";
}

/* ------------------------------------------------------ attempt record --- */

/**
 * The immutable identity of a request that may have reached the server. It is
 * persisted BEFORE the mutation is sent; while it exists the session is locked
 * (no mode switch, no quantity or payload change) and the only ways forward
 * are retrying this exact body with this exact key, or an explicit abandon.
 */
export interface AttemptRecord<Body> {
  v: 1;
  draftId: string;
  idempotencyKey: string;
  mode: EntryMode;
  /** the request quantity exactly as sent */
  quantity: string;
  /** the request body exactly as sent — a retry resends this, never a rebuilt one */
  body: Body;
  /** in flight now, or sent with an unknown outcome */
  status: "inflight" | "uncertain";
  /** an earlier send of this key had an unknown outcome */
  priorUncertain: boolean;
  /** ISO time of the latest send */
  at: string;
  lastError: { status: number; message: string; requestId?: string } | null;
}

export const ATTEMPT_SCOPE = {
  stockIn: "stock-in:attempt",
  stockOut: "stock-out:attempt",
} as const;

const attemptKey = (scope: string, draftId: string) => `${scope}:${draftId}`;

/**
 * Persist and verify by reading back. `false` means the record could not be
 * stored: the caller must NOT send the mutation.
 */
export function writeAttempt<Body>(store: Storage | null, scope: string, record: AttemptRecord<Body>): boolean {
  if (!store) return false;
  try {
    const text = JSON.stringify(record);
    store.setItem(attemptKey(scope, record.draftId), text);
    return store.getItem(attemptKey(scope, record.draftId)) === text;
  } catch {
    return false;
  }
}

/**
 * This draft's attempt, if any. A record that cannot be trusted (corrupt, or
 * a key that is not the draft's) still locks the session as uncertain —
 * evidence of a possible earlier request is never silently dropped.
 */
export function readAttempt<Body>(
  store: Storage | null,
  scope: string,
  draftId: string,
  idempotencyKey: string,
): AttemptRecord<Body> | null {
  if (!store) return null;
  let text: string | null;
  try {
    text = store.getItem(attemptKey(scope, draftId));
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const r = JSON.parse(text) as AttemptRecord<Body>;
    const wellFormed =
      r && r.v === 1 && r.draftId === draftId && typeof r.idempotencyKey === "string" && typeof r.quantity === "string" && r.body != null;
    if (wellFormed && r.idempotencyKey === idempotencyKey) return r;
    if (wellFormed) return { ...r, status: "uncertain" };
  } catch {
    /* corrupt — fall through */
  }
  return {
    v: 1,
    draftId,
    idempotencyKey,
    mode: "scan",
    quantity: "",
    body: null as unknown as Body,
    status: "uncertain",
    priorUncertain: true,
    at: "",
    lastError: null,
  };
}

export function clearAttempt(store: Storage | null, scope: string, draftId: string): void {
  try {
    store?.removeItem(attemptKey(scope, draftId));
  } catch {
    /* ignore */
  }
}

/** A record found on load was never answered in this page: its outcome is unknown. */
export function recoverAfterReload<Body>(record: AttemptRecord<Body>): AttemptRecord<Body> {
  return record.status === "inflight" ? { ...record, status: "uncertain" } : record;
}

/** A retry can be sent only for a trustworthy record of this draft's key. */
export function canRetry<Body>(record: AttemptRecord<Body> | null, idempotencyKey: string): boolean {
  return !!record && record.body != null && record.quantity !== "" && record.idempotencyKey === idempotencyKey;
}
