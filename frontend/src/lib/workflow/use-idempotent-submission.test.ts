import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { ApiError } from "@/lib/api/errors";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import { isExactKeyMismatch, isLooseKeyMismatch, KEY_MISMATCH_MESSAGE } from "./submission-errors";
import { useIdempotentSubmission, type KeyedMutate } from "./use-idempotent-submission";

type Vars = { body: string; idempotencyKey: string };
type Outcome = { kind: "ok"; data: string } | { kind: "err"; error: unknown };

/** A mutate whose next outcome the test chooses; records every call. */
function fakeMutate() {
  const calls: Vars[] = [];
  let next: Outcome = { kind: "ok", data: "done" };
  const mutate: KeyedMutate<Vars, string> = (vars, { onSuccess, onError }) => {
    calls.push(vars);
    if (next.kind === "ok") onSuccess(next.data);
    else onError(next.error);
  };
  return { mutate, calls, will: (o: Outcome) => (next = o) };
}

function setup(isMismatch = isLooseKeyMismatch) {
  const m = fakeMutate();
  const hook = renderHook(() => {
    const draft = useIdempotentDraft<{ q?: string }, string>({ scope: "sub-test", keyPrefix: "k-", buildPayload: () => null });
    const submission = useIdempotentSubmission<Vars, string>({ draft, mutate: m.mutate, isMismatch });
    return { draft, ...submission };
  });
  return { ...m, hook };
}

const handlers = () => ({ onSuccess: vi.fn(), onError: vi.fn() });

beforeEach(() => window.sessionStorage.clear());

describe("useIdempotentSubmission", () => {
  it("sends the draft's current key with the caller's variables", () => {
    const { hook, calls } = setup();
    const key = hook.result.current.draft.idempotencyKey;
    act(() => hook.result.current.submit({ body: "b1" }, handlers()));
    expect(calls).toEqual([{ body: "b1", idempotencyKey: key }]);
  });

  it("a failure keeps the key: the retry carries the same key and variables", () => {
    const { hook, calls, will } = setup();
    will({ kind: "err", error: new ApiError({ status: 503, message: "down" }) });
    const h = handlers();
    act(() => hook.result.current.submit({ body: "b1" }, h));
    act(() => hook.result.current.submit({ body: "b1" }, h));
    expect(calls[1]).toEqual(calls[0]);
    expect(h.onError).toHaveBeenCalledTimes(2);
    expect(h.onError.mock.calls[0][1]).toBe(false);
    expect(hook.result.current.mismatch).toBe(false);
  });

  it("success consumes the draft (new key) before the caller's onSuccess, and resets the flag", () => {
    const { hook, calls, will } = setup();
    will({ kind: "err", error: new ApiError({ status: 409, message: KEY_MISMATCH_MESSAGE }) });
    act(() => hook.result.current.submit({ body: "b1" }, handlers()));
    expect(hook.result.current.mismatch).toBe(true);
    will({ kind: "ok", data: "rcpt" });
    const h = handlers();
    act(() => hook.result.current.submit({ body: "b1" }, h));
    expect(h.onSuccess).toHaveBeenCalledWith("rcpt");
    expect(hook.result.current.mismatch).toBe(false);
    expect(hook.result.current.draft.idempotencyKey).not.toBe(calls[1].idempotencyKey);
  });

  it("a mismatch raises the flag, reports it to the caller and NEVER rotates the key", () => {
    const { hook, calls, will } = setup();
    will({ kind: "err", error: new ApiError({ status: 409, message: KEY_MISMATCH_MESSAGE }) });
    const h = handlers();
    act(() => hook.result.current.submit({ body: "b1" }, h));
    expect(hook.result.current.mismatch).toBe(true);
    expect(h.onError).toHaveBeenCalledWith(expect.any(ApiError), true);
    expect(hook.result.current.draft.idempotencyKey).toBe(calls[0].idempotencyKey);
    act(() => hook.result.current.clearMismatch());
    expect(hook.result.current.mismatch).toBe(false);
    expect(hook.result.current.draft.idempotencyKey).toBe(calls[0].idempotencyKey);
  });

  it("uses the workflow's own predicate", () => {
    const loose = setup(isLooseKeyMismatch);
    loose.will({ kind: "err", error: new ApiError({ status: 422, message: KEY_MISMATCH_MESSAGE }) });
    act(() => loose.hook.result.current.submit({ body: "b" }, handlers()));
    expect(loose.hook.result.current.mismatch).toBe(false);
    loose.hook.unmount();
    window.sessionStorage.clear();

    const exact = setup(isExactKeyMismatch);
    exact.will({ kind: "err", error: new ApiError({ status: 422, message: KEY_MISMATCH_MESSAGE }) });
    act(() => exact.hook.result.current.submit({ body: "b" }, handlers()));
    expect(exact.hook.result.current.mismatch).toBe(true);
  });

  it("adds no duplicate-submit lock (D-R3-1): every submit reaches mutate", () => {
    const { hook, calls } = setup();
    act(() => {
      hook.result.current.submit({ body: "b" }, handlers());
      hook.result.current.submit({ body: "b" }, handlers());
    });
    expect(calls).toHaveLength(2);
  });
});
