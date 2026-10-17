import { sumDecimals, type DecimalString } from "@/lib/decimal";

/** One receive line as the summary sees it: the trimmed entry and its client validation. */
export interface ReceiptLineState {
  /** the entered quantity, trimmed ("" when the line is not part of this receipt) */
  quantity: string;
  /** the line's client-side validation message, or null */
  error: string | null;
}

export interface ReceiptSummary {
  /** every line's validation message (a non-empty list blocks Receive) */
  lineErrors: string[];
  /** sum of the valid entered quantities, 3 dp */
  receivingNow: DecimalString;
  /** how many valid lines carry a quantity above zero */
  selectedCount: number;
}

/**
 * The "This receipt" figures shared by PO and transfer receiving. Advisory
 * only: the backend re-checks every quantity against what is really remaining.
 */
export function summarizeReceipt(lines: ReceiptLineState[]): ReceiptSummary {
  return {
    lineErrors: lines.map((l) => l.error).filter((e): e is string => !!e),
    receivingNow: sumDecimals(
      lines.map((l) => (!l.error && l.quantity ? l.quantity : "0")),
      3,
    ),
    selectedCount: lines.filter((l) => !l.error && l.quantity && Number(l.quantity) > 0).length,
  };
}

/** Prepend a receipt unless one with the same number is listed (a replayed submit). */
export function addReceiptOnce<R extends { receipt_number: string }>(receipts: R[], receipt: R): R[] {
  return receipts.some((r) => r.receipt_number === receipt.receipt_number) ? receipts : [receipt, ...receipts];
}
