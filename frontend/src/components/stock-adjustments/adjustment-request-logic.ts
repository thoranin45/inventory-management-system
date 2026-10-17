import {
  batchReasonError,
  compareQty,
  createAdjustmentRequestInput,
  isQty,
  qtyInputError,
  type ReasonCode,
} from "@/lib/api/schemas/stock-adjustment-requests";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { Warehouse } from "@/lib/api/schemas/warehouses";
import type { BalanceOption } from "./exact-balance-picker";

/**
 * Pure decision logic of the stock adjustment request form (R3 extraction).
 * Everything here is advisory: approval re-checks the live balance, the
 * reserved floor and the reason rules on the server regardless.
 */

/** The draft fields this logic reads (the form's persisted request line). */
export interface AdjustmentLine {
  productId: number;
  trackBatch: boolean;
  warehouseId: number | null;
  locationId: number | null;
  batchId: number | null;
  batchExpired: boolean;
  /** on-hand of the chosen lot when it was picked; absent on older drafts */
  pickedOnHand?: string | null;
  reserved: string;
  observed: string;
  requested: string;
  reasonCode: ReasonCode;
  notes: string;
}

export type SelectionState =
  | { kind: "checking" }
  | { kind: "error" }
  | { kind: "missing" }
  | { kind: "changed"; option: BalanceOption }
  | { kind: "ok"; option: BalanceOption };

/** A query as the verification sees it. */
export interface LoadState {
  isError: boolean;
  isFetching: boolean;
  /** data has arrived */
  loaded: boolean;
}

/**
 * A batch selection is only submittable while it is verified against the
 * LATEST successful balance + directory load: same product, warehouse,
 * location and batch, still operational, and unchanged since it was picked.
 * null when there is no batch selection to verify.
 */
export function verifyBatchSelection(
  line: AdjustmentLine | undefined,
  options: BalanceOption[],
  stock: LoadState,
  directory: LoadState,
): SelectionState | null {
  if (!line || !line.trackBatch || line.batchId == null) return null;
  if (stock.isError || directory.isError) return { kind: "error" };
  if (!stock.loaded || !directory.loaded || stock.isFetching || directory.isFetching) return { kind: "checking" };
  const option = options.find(
    (o) =>
      o.productId === line.productId &&
      o.warehouseId === line.warehouseId &&
      o.locationId === line.locationId &&
      o.batchId === line.batchId,
  );
  if (!option) return { kind: "missing" };
  if (
    compareQty(line.pickedOnHand ?? "", option.onHand) !== 0 ||
    compareQty(line.reserved, option.reserved) !== 0 ||
    line.batchExpired !== option.isExpired
  ) {
    return { kind: "changed", option };
  }
  return { kind: "ok", option };
}

export interface AdjustmentChecks {
  /** batch reason rule (decrease-only, expiry write-off) message */
  ruleError: string | null;
  /** requested is below the reserved quantity (blocks a batch request, warns otherwise) */
  belowReserved: boolean;
  observedError: string | null;
  requestedError: string | null;
  /** the request may be submitted */
  valid: boolean;
}

export function adjustmentChecks(line: AdjustmentLine | undefined, selection: SelectionState | null): AdjustmentChecks {
  const ruleError =
    line && line.trackBatch && line.batchId != null
      ? batchReasonError({
          reasonCode: line.reasonCode,
          observed: line.observed,
          requested: line.requested,
          isExpired: line.batchExpired,
        })
      : null;
  const belowReserved = !!line && isQty(line.requested) && compareQty(line.requested, line.reserved || "0") < 0;
  const observedError = line ? qtyInputError(line.observed) : null;
  const requestedError = line ? qtyInputError(line.requested) : null;

  let valid = false;
  if (line && !(line.trackBatch && (line.batchId == null || selection?.kind !== "ok" || ruleError || belowReserved))) {
    valid = createAdjustmentRequestInput.safeParse({
      product_id: line.productId,
      ...(line.trackBatch && line.batchId != null
        ? { warehouse_id: line.warehouseId ?? undefined, location_id: line.locationId ?? undefined, batch_id: line.batchId }
        : {}),
      observed_quantity: line.observed,
      requested_quantity: line.requested,
      reason_code: line.reasonCode,
      notes: line.notes || undefined,
    }).success;
  }
  return { ruleError, belowReserved, observedError, requestedError, valid };
}

/**
 * Non-batch prefill (B2): the ON-HAND of the unbatched MAIN/DEFAULT balance,
 * never the available quantity; an absent balance reads as 0.000, exactly as
 * approval treats it.
 */
export function defaultBalancePrefill(
  balances: StockBalanceRow[],
  directory: Warehouse[],
): { observed: string; reserved: string } {
  const main = directory.find((w) => w.warehouse_code === "MAIN");
  const defaultLocation = main?.locations.find((l) => l.location_code === "DEFAULT");
  const row = balances.find(
    (b) => b.batch_id === null && b.warehouse_id === main?.id && b.location_id === defaultLocation?.id,
  );
  return { observed: row?.on_hand_qty ?? "0.000", reserved: row?.reserved_qty ?? "0" };
}

/**
 * Choosing an exact lot balance: pins it, prefills observed from its ON-HAND
 * (B2, never available) and drops an expiry write-off a non-expired lot can't take.
 */
export function pickBalancePatch(option: BalanceOption, currentReason: ReasonCode | undefined) {
  return {
    warehouseId: option.warehouseId,
    locationId: option.locationId,
    batchId: option.batchId,
    batchExpired: option.isExpired,
    pickedOnHand: option.onHand,
    reserved: option.reserved,
    observed: option.onHand,
    reasonCode:
      currentReason === "EXPIRY_WRITE_OFF" && !option.isExpired ? ("CYCLE_COUNT_VARIANCE" as const) : currentReason,
  };
}
