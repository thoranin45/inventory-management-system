import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { isExactKeyMismatch, isLooseKeyMismatch, KEY_MISMATCH_MESSAGE, requestIdOf } from "./submission-errors";

const err = (status: number, message: string, requestId?: string) => new ApiError({ status, message, requestId });

describe("key-mismatch predicates (D-R3-2: kept workflow-specific)", () => {
  it("the backend message is the one every workflow has matched against", () => {
    expect(KEY_MISMATCH_MESSAGE).toBe("Idempotency-Key already used with a different payload");
  });

  it("loose (Stock In/Out, adjustment requests): 409 + 'different payload' anywhere, any case", () => {
    expect(isLooseKeyMismatch(err(409, KEY_MISMATCH_MESSAGE))).toBe(true);
    expect(isLooseKeyMismatch(err(409, "key reused with a DIFFERENT PAYLOAD here"))).toBe(true);
    expect(isLooseKeyMismatch(err(422, KEY_MISMATCH_MESSAGE))).toBe(false);
    expect(isLooseKeyMismatch(err(409, "Not enough stock"))).toBe(false);
    expect(isLooseKeyMismatch(new Error(KEY_MISMATCH_MESSAGE))).toBe(false);
    expect(isLooseKeyMismatch(undefined)).toBe(false);
  });

  it("exact (PO and transfer receiving): the exact message, whatever the status", () => {
    expect(isExactKeyMismatch(err(409, KEY_MISMATCH_MESSAGE))).toBe(true);
    expect(isExactKeyMismatch(err(422, KEY_MISMATCH_MESSAGE))).toBe(true);
    expect(isExactKeyMismatch(err(500, KEY_MISMATCH_MESSAGE))).toBe(true);
    expect(isExactKeyMismatch(err(409, KEY_MISMATCH_MESSAGE.toUpperCase()))).toBe(false);
    expect(isExactKeyMismatch(err(409, `${KEY_MISMATCH_MESSAGE}.`))).toBe(false);
    expect(isExactKeyMismatch(new Error(KEY_MISMATCH_MESSAGE))).toBe(false);
  });

  it("the two predicates disagree exactly where the workflows always have", () => {
    const cases = [err(422, KEY_MISMATCH_MESSAGE), err(409, "a different payload")];
    expect(cases.map(isLooseKeyMismatch)).toEqual([false, true]);
    expect(cases.map(isExactKeyMismatch)).toEqual([true, false]);
  });

  it("requestIdOf reads only ApiErrors", () => {
    expect(requestIdOf(err(500, "x", "req-1"))).toBe("req-1");
    expect(requestIdOf(err(500, "x"))).toBeUndefined();
    expect(requestIdOf(new Error("x"))).toBeUndefined();
  });
});
