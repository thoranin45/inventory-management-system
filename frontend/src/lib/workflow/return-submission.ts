import { isApiError } from "@/lib/api/errors";
import { compareDecimals, sumDecimals, type DecimalString } from "@/lib/decimal";
import {
  RETURN_KEY_CONFLICT,
  salesReturnLineInput,
  type SalesReturnItemResult,
  type SalesReturnLineInput,
} from "@/lib/api/schemas/sales";

/**
 * Pure logic of the Sales Return drawer (R3.4). The backend stays
 * authoritative: it picks the batch, enforces the true returnable total and
 * replays a repeated Idempotency-Key. Nothing here sends a request.
 */

/** One drawer line as typed. */
export interface ReturnLineDraft {
  product_id: number;
  ordered: string;
  quantity: string; // "return now"
  reason: string;
  error?: string;
}

/** The Sales Return quantity rule itself (up to 3 decimals, above zero), shared with submit. */
const returnQuantity = salesReturnLineInput.shape.quantity;

/**
 * The running total of the entered quantities, or null while any of them is
 * not a valid return quantity ("1." mid-typing, "abc", "0.0009"): unknown,
 * never counted as zero and never truncated into a valid-looking total.
 */
export function returnTotal(activeLines: ReturnLineDraft[]): DecimalString | null {
  const quantities = activeLines.map((l) => l.quantity.trim());
  return quantities.every((q) => returnQuantity.safeParse(q).success) ? sumDecimals(quantities, 3) : null;
}

/** Why one line can't be sent; the drawer turns it into copy. */
export type ReturnLineProblem = { kind: "invalid"; message: string } | { kind: "ceiling"; ceiling: DecimalString };

export type ReturnValidation =
  | { ok: true; items: SalesReturnLineInput[] }
  | { ok: false; problems: Record<number, ReturnLineProblem> };

/**
 * Validate the active lines in their order and build the request items:
 * quantities trimmed but NOT padded, reasons trimmed and omitted when blank,
 * each line within its ceiling (ordered minus what the backend reported as
 * already returned). Any problem blocks the whole return.
 */
export function validateReturnLines(
  activeLines: ReturnLineDraft[],
  ceilingOf: (line: ReturnLineDraft) => DecimalString,
): ReturnValidation {
  const items: SalesReturnLineInput[] = [];
  const problems: Record<number, ReturnLineProblem> = {};
  for (const l of activeLines) {
    const parsed = salesReturnLineInput.safeParse({
      product_id: l.product_id,
      quantity: l.quantity.trim(),
      reason: l.reason.trim() || undefined,
    });
    if (!parsed.success) {
      problems[l.product_id] = { kind: "invalid", message: parsed.error.issues[0].message };
      continue;
    }
    const ceiling = ceilingOf(l);
    if (compareDecimals(parsed.data.quantity, ceiling) > 0) {
      problems[l.product_id] = { kind: "ceiling", ceiling };
      continue;
    }
    items.push(parsed.data);
  }
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, items };
}

/** The return's own key-conflict rule: HTTP 409 with exactly the backend message. */
export function isReturnKeyConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.message === RETURN_KEY_CONFLICT;
}

/** Record the backend's total returned per product. */
export function mergeReturnedTotals(
  alreadyReturned: Record<number, string>,
  returned: SalesReturnItemResult[],
): Record<number, string> {
  const next = { ...alreadyReturned };
  for (const r of returned) next[r.product_id] = r.total_returned;
  return next;
}

/** Clear the quantity and reason of the lines the backend returned; keep every row. */
export function clearReturnedLines(
  lines: Record<number, ReturnLineDraft>,
  returned: SalesReturnItemResult[],
): Record<number, ReturnLineDraft> {
  const next = { ...lines };
  for (const r of returned) if (next[r.product_id]) next[r.product_id] = { ...next[r.product_id], quantity: "", reason: "" };
  return next;
}
