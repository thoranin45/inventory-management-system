"use client";

import { isDecimalString, padScale, type DecimalString } from "./decimal";
import {
  useIdempotentDraft,
  type UseIdempotentDraft,
} from "./idempotent-draft";

/**
 * Phase 5 PO idempotent receiving — now a thin adapter over the shared
 * `useIdempotentDraft` (Phase 6 generalised the sessionStorage / key lifecycle).
 * Public API and behaviour are unchanged.
 */
export interface ReceiptDraftLine {
  quantity?: string;
  lot_no?: string;
  mfg_date?: string;
  expiry_date?: string;
}
export type ReceiptDraftLines = Record<number, ReceiptDraftLine>;

export interface ReceivePayloadItem {
  product_id: number;
  quantity: DecimalString;
  lot_no?: string;
  mfg_date?: string;
  expiry_date?: string;
}
export interface ReceivePayload {
  items: ReceivePayloadItem[];
}

/**
 * Deterministic receive body. Only lines with a positive, ≤3dp quantity are
 * included; sorted by product_id; quantity padded to exactly 3 decimals; lot /
 * dates included only when non-empty. Returns null when nothing is receivable.
 */
export function buildReceivePayload(lines: ReceiptDraftLines): ReceivePayload | null {
  const items: ReceivePayloadItem[] = [];
  for (const [pidStr, line] of Object.entries(lines)) {
    const q = (line.quantity ?? "").trim();
    if (!isDecimalString(q) || Number(q) <= 0) continue;
    if ((q.split(".")[1]?.length ?? 0) > 3) continue;
    const item: ReceivePayloadItem = { product_id: Number(pidStr), quantity: padScale(q, 3) };
    const lot = (line.lot_no ?? "").trim();
    if (lot) item.lot_no = lot;
    const mfg = (line.mfg_date ?? "").trim();
    if (mfg) item.mfg_date = mfg;
    const exp = (line.expiry_date ?? "").trim();
    if (exp) item.expiry_date = exp;
    items.push(item);
  }
  if (items.length === 0) return null;
  items.sort((a, b) => a.product_id - b.product_id);
  return { items };
}

/** A stable string for detecting "the payload changed since the last submit". */
export function payloadSignature(payload: ReceivePayload | null): string {
  return payload ? JSON.stringify(payload.items) : "";
}

export type UseReceiptDraft = UseIdempotentDraft<ReceiptDraftLine, ReceivePayload>;

export function useReceiptDraft(poId: number | string): UseReceiptDraft {
  return useIdempotentDraft<ReceiptDraftLine, ReceivePayload>({
    scope: `po-receipt:${poId}`,
    keyPrefix: "po-rcpt-",
    buildPayload: buildReceivePayload,
  });
}
