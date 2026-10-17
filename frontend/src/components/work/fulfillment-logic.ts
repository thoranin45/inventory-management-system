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
