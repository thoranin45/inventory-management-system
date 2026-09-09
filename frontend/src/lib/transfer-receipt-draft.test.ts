import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { buildTransferReceivePayload, useTransferReceiptDraft } from "./transfer-receipt-draft";

beforeEach(() => window.sessionStorage.clear());

describe("buildTransferReceivePayload — byte-stable for the backend fingerprint", () => {
  it("sorts by transfer_item_id, pads quantity to 3dp, skips empty / over-precise", () => {
    expect(
      buildTransferReceivePayload({
        5: { quantity: "2" },
        1: { quantity: "3.5" },
        9: { quantity: "" },
        12: { quantity: "1.2345" },
      }),
    ).toEqual({
      items: [
        { transfer_item_id: 1, quantity: "3.500" },
        { transfer_item_id: 5, quantity: "2.000" },
      ],
    });
  });

  it("returns null when nothing is receivable", () => {
    expect(buildTransferReceivePayload({ 1: { quantity: "0" }, 2: { quantity: "" } })).toBeNull();
  });
});

describe("useTransferReceiptDraft — key lifecycle (shared idempotent-draft machinery)", () => {
  it("one key generated on start, stable across line edits, prefixed tr-rcpt-", () => {
    const { result } = renderHook(() => useTransferReceiptDraft(1));
    const key0 = result.current.idempotencyKey;
    expect(key0).toMatch(/^tr-rcpt-/);
    act(() => result.current.setLine(10, { quantity: "3" }));
    act(() => result.current.setLine(10, { quantity: "4" }));
    expect(result.current.idempotencyKey).toBe(key0);
    expect(result.current.payload).toEqual({ items: [{ transfer_item_id: 10, quantity: "4.000" }] });
  });

  it("a reload (remount) restores the SAME key + entries; the scope is transfer-specific", () => {
    const first = renderHook(() => useTransferReceiptDraft(42));
    const key = first.result.current.idempotencyKey;
    act(() => first.result.current.setLine(7, { quantity: "2.5" }));
    first.unmount();
    const second = renderHook(() => useTransferReceiptDraft(42));
    expect(second.result.current.idempotencyKey).toBe(key);
    expect(second.result.current.lines[7]?.quantity).toBe("2.5");
    // a different transfer id has an independent draft
    const other = renderHook(() => useTransferReceiptDraft(99));
    expect(other.result.current.idempotencyKey).not.toBe(key);
  });

  it("commitSuccess clears + issues a new key; startNewDraft keeps entries with a new key", () => {
    const { result } = renderHook(() => useTransferReceiptDraft(3));
    const k0 = result.current.idempotencyKey;
    act(() => result.current.setLine(1, { quantity: "1" }));
    act(() => result.current.commitSuccess());
    expect(result.current.idempotencyKey).not.toBe(k0);
    expect(result.current.payload).toBeNull();

    const k1 = result.current.idempotencyKey;
    act(() => result.current.setLine(1, { quantity: "2" }));
    act(() => result.current.startNewDraft());
    expect(result.current.idempotencyKey).not.toBe(k1);
    expect(result.current.lines[1]?.quantity).toBe("2");
  });
});
