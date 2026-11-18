/**
 * R5 (D-R5-4) — honest progress percentages for order lists.
 *
 * The backend sends picked_pct / packed_pct / receiving_pct on a 0–100 scale,
 * quantized to 0.1 (`_pct` in sales_order_service, receiving_pct in
 * purchase_order_service). So:
 *   - 1.0 means 1 %, never "100 %" (the earlier 0–1 guess turned 1 % into 100 %);
 *   - 100.0 does NOT prove completion (99.96 % rounds to 100.0) — 100 % is shown
 *     only when the caller establishes completion from the lifecycle;
 *   - positive progress under 1 % is "<1%", never a misleading "0%".
 * Progress below 0.05 % already arrives as 0.0 and cannot be told apart from
 * none — a backend limitation, not hidden here.
 */
export function formatProgressPercent(pct: number, complete: boolean): string {
  if (complete) return "100%";
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.min(99, Math.round(pct))}%`;
}

const PICKING_DONE = new Set(["PACKING", "READY_TO_SHIP", "SHIPPED", "COMPLETED"]);
const PACKING_DONE = new Set(["READY_TO_SHIP", "SHIPPED", "COMPLETED"]);

/** complete-picking requires every allocation exactly picked, so a later status proves it */
export const soPickingComplete = (status: string) => PICKING_DONE.has(status.toUpperCase());
/** complete-packing requires every allocation exactly packed */
export const soPackingComplete = (status: string) => PACKING_DONE.has(status.toUpperCase());
/** RECEIVED is set only when every line's received quantity equals its ordered quantity */
export const poReceivingComplete = (status: string) => status.toUpperCase() === "RECEIVED";
