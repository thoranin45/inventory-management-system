import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useIdempotentDraft, type DraftLines } from "./idempotent-draft";

/**
 * Direct characterization of the shared idempotent-draft primitive (R3.0):
 * every keyed workflow (stock in/out, PO and transfer receiving, sales return,
 * adjustment requests) relies on exactly this key and storage lifecycle.
 */
interface Line {
  quantity?: string;
  note?: string;
}

const build = (lines: DraftLines<Line>) => {
  const ids = Object.keys(lines).map(Number).sort((a, b) => a - b);
  return ids.length ? ids.map((id) => `${id}:${lines[id].quantity ?? ""}`).join(",") : null;
};

const draftFor = (scope = "test-scope:1", keyPrefix = "tst-") =>
  renderHook(() => useIdempotentDraft<Line, string>({ scope, keyPrefix, buildPayload: build }));

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("useIdempotentDraft", () => {
  it("creates one prefixed key and persists the active draft immediately", () => {
    const { result } = draftFor();
    expect(result.current.idempotencyKey).toMatch(/^tst-/);
    expect(result.current.ready).toBe(true);
    const active = window.sessionStorage.getItem("test-scope:1:active");
    expect(active).toBe(result.current.draftId);
    expect(JSON.parse(window.sessionStorage.getItem(`test-scope:1:${active}`)!)).toEqual({
      idempotencyKey: result.current.idempotencyKey,
      lines: {},
    });
  });

  it("setLine merges patches, persists them and keeps the key", () => {
    const { result } = draftFor();
    const key = result.current.idempotencyKey;
    act(() => result.current.setLine(2, { quantity: "1" }));
    act(() => result.current.setLine(2, { note: "x" }));
    act(() => result.current.setLine(1, { quantity: "3" }));
    expect(result.current.lines).toEqual({ 1: { quantity: "3" }, 2: { quantity: "1", note: "x" } });
    expect(result.current.payload).toBe("1:3,2:1");
    expect(result.current.idempotencyKey).toBe(key);
    const stored = JSON.parse(window.sessionStorage.getItem(`test-scope:1:${result.current.draftId}`)!);
    expect(stored.lines).toEqual(result.current.lines);
  });

  it("removeLine and clearLines keep the key", () => {
    const { result } = draftFor();
    const key = result.current.idempotencyKey;
    act(() => result.current.setLine(1, { quantity: "3" }));
    act(() => result.current.setLine(2, { quantity: "4" }));
    act(() => result.current.removeLine(1));
    expect(result.current.lines).toEqual({ 2: { quantity: "4" } });
    act(() => result.current.clearLines());
    expect(result.current.lines).toEqual({});
    expect(result.current.payload).toBeNull();
    expect(result.current.idempotencyKey).toBe(key);
  });

  it("a remount restores the same key and lines", () => {
    const first = draftFor();
    act(() => first.result.current.setLine(5, { quantity: "2" }));
    const key = first.result.current.idempotencyKey;
    first.unmount();
    const { result } = draftFor();
    expect(result.current.idempotencyKey).toBe(key);
    expect(result.current.lines).toEqual({ 5: { quantity: "2" } });
  });

  it("commitSuccess removes the old draft, clears lines and issues a new key", () => {
    const { result } = draftFor();
    act(() => result.current.setLine(1, { quantity: "1" }));
    const { idempotencyKey: oldKey, draftId: oldId } = result.current;
    act(() => result.current.commitSuccess());
    expect(result.current.idempotencyKey).not.toBe(oldKey);
    expect(result.current.idempotencyKey).toMatch(/^tst-/);
    expect(result.current.lines).toEqual({});
    expect(window.sessionStorage.getItem(`test-scope:1:${oldId}`)).toBeNull();
    expect(window.sessionStorage.getItem("test-scope:1:active")).toBe(result.current.draftId);
  });

  it("startNewDraft issues a new key but keeps the lines", () => {
    const { result } = draftFor();
    act(() => result.current.setLine(1, { quantity: "1" }));
    const { idempotencyKey: oldKey, draftId: oldId } = result.current;
    act(() => result.current.startNewDraft());
    expect(result.current.idempotencyKey).not.toBe(oldKey);
    expect(result.current.lines).toEqual({ 1: { quantity: "1" } });
    expect(window.sessionStorage.getItem(`test-scope:1:${oldId}`)).toBeNull();
  });

  it("scopes are independent", () => {
    const a = draftFor("scope-a");
    const b = draftFor("scope-b");
    act(() => a.result.current.setLine(1, { quantity: "9" }));
    expect(b.result.current.lines).toEqual({});
    expect(a.result.current.idempotencyKey).not.toBe(b.result.current.idempotencyKey);
  });

  it("a corrupt stored draft is replaced by a fresh one", () => {
    window.sessionStorage.setItem("test-scope:1:active", "bad");
    window.sessionStorage.setItem("test-scope:1:bad", "{not json");
    const { result } = draftFor();
    expect(result.current.idempotencyKey).toMatch(/^tst-/);
    expect(result.current.draftId).not.toBe("bad");
  });

  it("keeps working in memory when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = draftFor();
    act(() => result.current.setLine(1, { quantity: "1" }));
    expect(result.current.lines).toEqual({ 1: { quantity: "1" } });
  });
});
