import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  buildReceivePayload,
  payloadSignature,
  useReceiptDraft,
  type ReceiptDraftLines,
} from "./receipt-draft";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("buildReceivePayload — byte-stable body for the idempotency fingerprint", () => {
  it("includes only positive ≤3dp lines, sorted by product_id, quantity padded to 3dp", () => {
    const lines: ReceiptDraftLines = {
      3: { quantity: "5" },
      1: { quantity: "3.0", lot_no: "LOT-A", mfg_date: "2026-06-01", expiry_date: "2027-06-01" },
      6: { quantity: "" }, // skipped
      9: { quantity: "0" }, // skipped
      12: { quantity: "1.2345" }, // skipped (too precise)
    };
    expect(buildReceivePayload(lines)).toEqual({
      items: [
        { product_id: 1, quantity: "3.000", lot_no: "LOT-A", mfg_date: "2026-06-01", expiry_date: "2027-06-01" },
        { product_id: 3, quantity: "5.000" },
      ],
    });
  });

  it("returns null when nothing is receivable", () => {
    expect(buildReceivePayload({ 1: { quantity: "" }, 2: { quantity: "0" } })).toBeNull();
  });

  it("payload order is independent of insertion order (same signature)", () => {
    const a = buildReceivePayload({ 3: { quantity: "1" }, 1: { quantity: "2" } });
    const b = buildReceivePayload({ 1: { quantity: "2" }, 3: { quantity: "1" } });
    expect(payloadSignature(a)).toBe(payloadSignature(b));
  });
});

describe("useReceiptDraft — Idempotency-Key lifecycle", () => {
  it("generates one key on start and keeps it across line edits", () => {
    const { result } = renderHook(() => useReceiptDraft(101));
    const key0 = result.current.idempotencyKey;
    expect(key0).toMatch(/^po-rcpt-/);

    act(() => result.current.setLine(1, { quantity: "3" }));
    act(() => result.current.setLine(1, { lot_no: "LOT-X" }));
    expect(result.current.idempotencyKey).toBe(key0);
    expect(result.current.payload).toEqual({ items: [{ product_id: 1, quantity: "3.000", lot_no: "LOT-X" }] });
  });

  it("a page reload (remount) restores the SAME key + entered lines", () => {
    const first = renderHook(() => useReceiptDraft(202));
    const key = first.result.current.idempotencyKey;
    act(() => first.result.current.setLine(5, { quantity: "2.5" }));
    first.unmount();

    const second = renderHook(() => useReceiptDraft(202));
    expect(second.result.current.idempotencyKey).toBe(key);
    expect(second.result.current.lines[5]?.quantity).toBe("2.5");
  });

  it("commitSuccess clears the draft and starts a fresh one with a NEW key", () => {
    const { result } = renderHook(() => useReceiptDraft(303));
    const key0 = result.current.idempotencyKey;
    act(() => result.current.setLine(1, { quantity: "1" }));
    act(() => result.current.commitSuccess());
    expect(result.current.idempotencyKey).not.toBe(key0);
    expect(result.current.payload).toBeNull();
    // the cleared draft is gone from storage
    expect(window.sessionStorage.getItem("po-receipt:303:active")).toBe(result.current.draftId);
  });

  it("startNewDraft issues a new key but keeps the current entries (used after a 409 mismatch)", () => {
    const { result } = renderHook(() => useReceiptDraft(404));
    const key0 = result.current.idempotencyKey;
    act(() => result.current.setLine(2, { quantity: "4" }));
    act(() => result.current.startNewDraft());
    expect(result.current.idempotencyKey).not.toBe(key0);
    expect(result.current.lines[2]?.quantity).toBe("4");
  });

  it("survives sessionStorage throwing (private mode) without crashing", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    const { result } = renderHook(() => useReceiptDraft(505));
    act(() => result.current.setLine(1, { quantity: "1" }));
    expect(result.current.payload).toEqual({ items: [{ product_id: 1, quantity: "1.000" }] });
    spy.mockRestore();
  });
});
