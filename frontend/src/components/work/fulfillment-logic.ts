import { compareDecimals, type DecimalString } from "@/lib/decimal";
import type { SalesOrderDetail } from "@/lib/api/schemas/sales";
import type { AmbiguityCandidate } from "./scan-machine";

/**
 * Pure helpers of the pick / pack console (R3 extraction). Nothing here talks
 * to the backend: every scan, undo and completion stays one authoritative
 * request in the console, and the backend chooses lots and allocations.
 */

/** Per allocation, the latest picked / packed figures the backend returned this session. */
export type LocalProgress = Record<number, { picked_quantity: DecimalString; packed_quantity: DecimalString }>;

/** Which allocation figure a mode counts. */
export type DoneField = "picked_quantity" | "packed_quantity";

/** One scan / undo response, as far as local progress is concerned. */
export interface ProgressResult {
  allocation_id: number;
  picked_quantity: DecimalString;
  packed_quantity: DecimalString;
}

/** merge the immediate scan response over the server detail (no optimism) */
export function allocationsWithLocal(detail: SalesOrderDetail, local: LocalProgress) {
  return detail.items.flatMap((it) =>
    it.fulfillment_allocations.map((a) => {
      const patch = local[a.id];
      return {
        ...a,
        product_id: it.product_id,
        item_quantity: it.quantity,
        picked_quantity: patch?.picked_quantity ?? a.picked_quantity,
        packed_quantity: patch?.packed_quantity ?? a.packed_quantity,
      };
    }),
  );
}

/** Record a backend scan / undo response for its allocation. */
export function mergeScanResult(local: LocalProgress, data: ProgressResult): LocalProgress {
  return {
    ...local,
    [data.allocation_id]: { picked_quantity: data.picked_quantity, packed_quantity: data.packed_quantity },
  };
}

/** Every allocation has reached its quantity in `field` (true for an empty list). */
export function everyAllocationDone(
  allocations: ({ quantity: DecimalString } & Record<DoneField, DecimalString>)[],
  field: DoneField,
): boolean {
  return allocations.every((a) => compareDecimals(a[field], a.quantity) >= 0);
}

/** The order line an allocation belongs to. */
export function findItemByAllocation(detail: SalesOrderDetail, allocationId: number) {
  return detail.items.find((it) => it.fulfillment_allocations.some((a) => a.id === allocationId));
}

/** The completion payload: every allocation with its full quantity, in order. */
export function buildCompletePayload(allocations: { id: number; quantity: DecimalString }[]) {
  return allocations.map((a) => ({ allocation_id: a.id, quantity: a.quantity }));
}

/** The lot metadata a barcode resolution offers (a bonus: absent when it failed). */
export interface ResolvedBatches {
  batches: {
    id: number;
    lot_no: string | null;
    expiry_date: string | null;
    days_to_expiry: number | null;
    is_expired: boolean;
    is_near_expiry: boolean;
  }[];
}

/**
 * The allocations an ambiguous scan could mean, for the operator to choose
 * (the console never guesses), with each one's progress and lot / expiry.
 */
export function buildAmbiguityCandidates(
  allocations: SalesOrderDetail["items"][number]["fulfillment_allocations"],
  resolved: ResolvedBatches | null,
  local: LocalProgress,
  field: DoneField,
): AmbiguityCandidate[] {
  return allocations.map((a) => {
    const b = a.batch_id != null ? resolved?.batches.find((x) => x.id === a.batch_id) : undefined;
    const patch = local[a.id];
    return {
      allocation_id: a.id,
      batch_id: a.batch_id,
      quantity: a.quantity,
      done: (patch?.[field] ?? a[field]) as string,
      lot_no: b?.lot_no ?? null,
      expiry_date: b?.expiry_date ?? null,
      days_to_expiry: b?.days_to_expiry ?? null,
      is_expired: b?.is_expired,
      is_near_expiry: b?.is_near_expiry,
    };
  });
}

/* ------------------------------------------- R5 (D-R5-5): uncertain outcomes */

/**
 * Scan / undo rejections VERIFIED to mean "nothing was counted"
 * (scan_fulfillment_service / undo_fulfillment_service at 7a2d9db): each is
 * raised before the counter is written, inside the order's transaction.
 */
const DEFINITIVE_FULFILLMENT_CODES = new Set([
  "BARCODE_NOT_FOUND",
  "PRODUCT_NOT_IN_ORDER",
  "ALLOCATION_IDENTIFICATION_REQUIRED",
  "ALLOCATION_SCAN_EXCEEDS_REMAINING",
  "ALLOCATION_NOT_IN_ORDER",
  "SCANNED_PRODUCT_MISMATCHES_LINE",
  "ALLOCATION_NOT_FULFILLABLE",
  "UNDO_BELOW_ZERO",
  "UNDO_BELOW_PACKED",
  "Validation error",
]);

/** The error shape this needs (an ApiError, without importing the class here). */
export interface FailureLike {
  kind?: string;
  status?: number;
  message?: string;
}

/**
 * Did a failed scan / undo certainly change nothing? Only a verified backend
 * rejection says so. A transport failure, timeout, 5xx, an unparseable body or
 * an unrecognised answer leaves the outcome UNKNOWN — the counter may or may
 * not have moved — and is never reported as "nothing counted".
 */
export function fulfillmentFailureIsDefinitive(error: FailureLike | null | undefined): boolean {
  if (!error || typeof error.status !== "number") return false;
  if (error.kind === "network" || error.kind === "parse") return false;
  if (error.status < 400 || error.status >= 500 || error.status === 408 || error.status === 429) return false;
  const message = error.message ?? "";
  return DEFINITIVE_FULFILLMENT_CODES.has(message) || /^Sales Order state conflict: /.test(message);
}

/** When each local overlay entry was recorded, by allocation (a monotonic sequence). */
export type LocalSeq = Record<number, number>;

/**
 * After a successful resync GET that started at `startSeq`, drop every local
 * overlay entry recorded at or before it, so the refreshed server detail wins
 * for those allocations. Entries recorded AFTER the GET started came from a
 * response newer than the snapshot and are kept — a stale refresh can never
 * overwrite newer authoritative progress.
 */
export function reconcileAfterResync(
  local: LocalProgress,
  seq: LocalSeq,
  startSeq: number,
): { local: LocalProgress; seq: LocalSeq } {
  const nextLocal: LocalProgress = {};
  const nextSeq: LocalSeq = {};
  for (const [id, patch] of Object.entries(local)) {
    const s = seq[Number(id)] ?? 0;
    if (s > startSeq) {
      nextLocal[Number(id)] = patch;
      nextSeq[Number(id)] = s;
    }
  }
  return { local: nextLocal, seq: nextSeq };
}

/** The sequence entries that survive a resync that started at `startSeq` (recorded after it). */
export function seqAfter(seq: LocalSeq, startSeq: number): LocalSeq {
  return Object.fromEntries(Object.entries(seq).filter(([, s]) => s > startSeq)) as LocalSeq;
}
