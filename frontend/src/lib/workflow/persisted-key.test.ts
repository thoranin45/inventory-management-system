import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { usePersistedIdempotencyKey } from "./persisted-key";

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("usePersistedIdempotencyKey", () => {
  it("creates a prefixed key and stores it under the storage key", () => {
    const { result } = renderHook(() => usePersistedIdempotencyKey("thing-key:1", "thing-"));
    expect(result.current.key).toMatch(/^thing-/);
    expect(window.sessionStorage.getItem("thing-key:1")).toBe(result.current.key);
  });

  it("a remount reuses the stored key", () => {
    const first = renderHook(() => usePersistedIdempotencyKey("thing-key:1", "thing-"));
    const key = first.result.current.key;
    first.unmount();
    const { result } = renderHook(() => usePersistedIdempotencyKey("thing-key:1", "thing-"));
    expect(result.current.key).toBe(key);
  });

  it("different storage keys hold different keys", () => {
    const a = renderHook(() => usePersistedIdempotencyKey("thing-key:1", "thing-"));
    const b = renderHook(() => usePersistedIdempotencyKey("thing-key:2", "thing-"));
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });

  it("clear forgets the stored key and holds a fresh, unpersisted one", () => {
    const { result } = renderHook(() => usePersistedIdempotencyKey("thing-key:1", "thing-"));
    const old = result.current.key;
    act(() => result.current.clear());
    expect(result.current.key).not.toBe(old);
    expect(result.current.key).toMatch(/^thing-/);
    expect(window.sessionStorage.getItem("thing-key:1")).toBeNull();
  });

  it("still works in memory when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => usePersistedIdempotencyKey("thing-key:1", "thing-"));
    expect(result.current.key).toMatch(/^thing-/);
  });
});
