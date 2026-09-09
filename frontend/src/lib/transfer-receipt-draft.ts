"use client";

import { isDecimalString, padScale } from "./decimal";
import { useIdempotentDraft, type UseIdempotentDraft } from "./idempotent-draft";

/**
 * Phase 6 transfer receiving — the same idempotent-draft machinery as PO
 * receiving. A transfer receive line is identified by `transfer_item_id` (the
 * source / batch identity is already pinned by dispatch), so the payload is
 * just `{ items: [{ transfer_item_id, quantity }] }`.
 *
 * Backend fingerprint: `{version:1, transfer_id, items:[{transfer_item_id,
 * quantity:".3f"}] sorted by transfer_item_id}` — so the body must be sorted by
 * transfer_item_id with quantity padded to exactly 3dp.
 */
export interface TransferReceiptLine {
  quantity?: string;
}
export type TransferReceiptLines = Record<number, TransferReceiptLine>;

export interface TransferReceivePayloadItem {
  transfer_item_id: number;
  quantity: string;
}
export interface TransferReceivePayload {
  items: TransferReceivePayloadItem[];
}

export function buildTransferReceivePayload(lines: TransferReceiptLines): TransferReceivePayload | null {
  const items: TransferReceivePayloadItem[] = [];
  for (const [idStr, line] of Object.entries(lines)) {
    const q = (line.quantity ?? "").trim();
    if (!isDecimalString(q) || Number(q) <= 0) continue;
    if ((q.split(".")[1]?.length ?? 0) > 3) continue;
    items.push({ transfer_item_id: Number(idStr), quantity: padScale(q, 3) });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => a.transfer_item_id - b.transfer_item_id);
  return { items };
}

export type UseTransferReceiptDraft = UseIdempotentDraft<TransferReceiptLine, TransferReceivePayload>;

export function useTransferReceiptDraft(transferId: number | string): UseTransferReceiptDraft {
  return useIdempotentDraft<TransferReceiptLine, TransferReceivePayload>({
    scope: `transfer-receipt:${transferId}`,
    keyPrefix: "tr-rcpt-",
    buildPayload: buildTransferReceivePayload,
  });
}
