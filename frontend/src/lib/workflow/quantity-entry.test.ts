import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { isLooseKeyMismatch } from "@/lib/workflow/submission-errors";
import {
  ATTEMPT_SCOPE,
  classifyAttemptOutcome,
  clearAttempt,
  parseTypedQuantity,
  readAttempt,
  recoverAfterReload,
  stepTypedQuantity,
  writeAttempt,
  type AttemptRecord,
} from "./quantity-entry";

describe("parseTypedQuantity — mirrors the backend Decimal(gt=0, max_digits=18, decimal_places=3) contract", () => {
  it.each([
    ["1", "1.000"],
    ["1.250", "1.250"],
    ["1.25", "1.250"],
    ["0.001", "0.001"],
    ["5.000", "5.000"],
    ["5", "5.000"],
    ["  7.5  ", "7.500"],
    ["007.5", "7.500"],
    ["999999999999999.999", "999999999999999.999"],
  ])("%s is valid → canonical %s", (raw, canonical) => {
    expect(parseTypedQuantity(raw)).toEqual({ status: "valid", canonical });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    [".", "partial"],
    ["1.", "partial"],
    ["-", "partial"],
  ])("%j is %s (neutral, never an error while typing)", (raw, status) => {
    expect(parseTypedQuantity(raw).status).toBe(status);
  });

  it.each(["0", "0.000", "000", "-1", "-0.5"])("%s is not positive", (raw) => {
    expect(parseTypedQuantity(raw).status).toBe("not_positive");
  });

  it.each(["1.2345", "0.0001", "0.0005"])("%s has more than three decimals", (raw) => {
    expect(parseTypedQuantity(raw).status).toBe("too_precise");
  });

  it.each(["abc", "1e3", "1E3", "NaN", "Infinity", "-Infinity", "1,000", "1.2.3", ".5", "+1", "1 000", "0x10", "١٢"])(
    "%s is malformed",
    (raw) => {
      expect(parseTypedQuantity(raw).status).toBe("invalid");
    },
  );

  it("more than 15 integer digits is beyond the backend's 18-digit / 3-decimal limit", () => {
    expect(parseTypedQuantity("1000000000000000").status).toBe("too_large");
    expect(parseTypedQuantity("9999999999999999.5").status).toBe("too_large");
  });

  it("never returns a canonical value for anything that is not valid", () => {
    for (const raw of ["", "1.", "0", "1.2345", "abc", "1000000000000000"]) {
      expect(parseTypedQuantity(raw)).not.toHaveProperty("canonical");
    }
  });
});

describe("stepTypedQuantity — exact ±1, never below a positive quantity", () => {
  it("increments exactly, from empty to 1.000", () => {
    expect(stepTypedQuantity("", 1)).toBe("1.000");
    expect(stepTypedQuantity("1.25", 1)).toBe("2.250");
    expect(stepTypedQuantity("0.001", 1)).toBe("1.001");
    expect(stepTypedQuantity("0.1", 1)).toBe("1.100"); // not 1.1000000000000001
  });

  it("decrements exactly and only while the result stays above zero", () => {
    expect(stepTypedQuantity("2.250", -1)).toBe("1.250");
    expect(stepTypedQuantity("1.001", -1)).toBe("0.001");
    expect(stepTypedQuantity("1", -1)).toBeNull();
    expect(stepTypedQuantity("0.5", -1)).toBeNull();
    expect(stepTypedQuantity("", -1)).toBeNull();
  });

  it("does nothing for partial, malformed or too-precise text", () => {
    for (const raw of ["1.", "abc", "1.2345", "-1"]) {
      expect(stepTypedQuantity(raw, 1)).toBeNull();
      expect(stepTypedQuantity(raw, -1)).toBeNull();
    }
  });

  it("never steps past the backend limit", () => {
    expect(stepTypedQuantity("999999999999999", 1)).toBeNull();
  });
});

/* ----------------------------------------------------------- outcomes --- */

const api = (status: number, message: string) => new ApiError({ status, message, requestId: "r-1" });

describe("classifyAttemptOutcome — conservative: only verified, pre-commit rejections are definitive", () => {
  it("the workflow's own mismatch predicate wins", () => {
    const e = api(409, "Idempotency-Key already used with a different payload");
    expect(classifyAttemptOutcome(e, "stock/in", isLooseKeyMismatch)).toBe("mismatch");
  });

  it.each([
    ["stock/in", 404, "Product not found"],
    ["stock/in", 409, "Batch-tracked products must be received with a lot number via POST /batches, not direct stock in"],
    ["stock/in", 422, "Validation error"],
    ["stock/out-fifo", 409, "Not enough stock"],
    ["stock/out-fefo", 409, "Not enough batch stock"],
    ["stock/out-fefo", 404, "Product not found"],
    ["batches", 409, "Lot number already exists"],
    ["batches", 409, "This product is not batch-tracked — add stock directly via POST /stock/in, not as a batch"],
    ["batches", 422, "Expiry-tracked product requires manufacturing and expiry dates"],
    ["batches", 400, "Supply both manufacturing and expiry dates, or neither"],
    ["batches", 400, "Expiry date must be after manufacturing date"],
  ] as const)("%s %i %j is definitive", (endpoint, status, message) => {
    expect(classifyAttemptOutcome(api(status, message), endpoint, isLooseKeyMismatch)).toBe("definitive");
  });

  it.each([
    ["network failure", ApiError.network(new TypeError("Failed to fetch"))],
    ["timeout 408", api(408, "Request Timeout")],
    ["rate limited", api(429, "Too many requests")],
    ["server error", api(500, "Internal server error")],
    ["BFF upstream failure", api(502, "Upstream request failed.")],
    ["unverified 409", api(409, "Some other conflict")],
    ["unexpected 400", api(400, "Bad request")],
    ["401 session", api(401, "Not authenticated")],
    ["403", api(403, "Forbidden")],
    ["malformed success body", new ApiError({ kind: "parse", status: 200, message: "bad body" })],
    ["not an ApiError", new Error("boom")],
    ["case-different message", api(409, "not enough stock")],
  ])("%s stays uncertain", (_label, error) => {
    expect(classifyAttemptOutcome(error, "stock/out-fifo", isLooseKeyMismatch)).toBe("uncertain");
  });

  it("a whitelisted message on the wrong endpoint is not definitive", () => {
    expect(classifyAttemptOutcome(api(409, "Not enough stock"), "stock/in", isLooseKeyMismatch)).toBe("uncertain");
    expect(classifyAttemptOutcome(api(409, "Lot number already exists"), "stock/out-fefo", isLooseKeyMismatch)).toBe("uncertain");
  });

  it("a matching message with a different status is not definitive", () => {
    expect(classifyAttemptOutcome(api(500, "Not enough stock"), "stock/out-fifo", isLooseKeyMismatch)).toBe("uncertain");
  });
});

/* ------------------------------------------------------------ storage --- */

function memoryStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const record = (over: Partial<AttemptRecord<{ endpoint: string; json: object }>> = {}): AttemptRecord<{ endpoint: string; json: object }> => ({
  v: 1,
  draftId: "d-1",
  idempotencyKey: "stockin-k1",
  mode: "typed",
  quantity: "1.250",
  body: { endpoint: "stock/in", json: { product_id: 5, quantity: "1.250" } },
  status: "inflight",
  priorUncertain: false,
  at: "2026-10-18T00:00:00.000Z",
  lastError: null,
  ...over,
});

describe("attempt persistence", () => {
  it("writes, verifies by reading back, and restores the exact record", () => {
    const store = memoryStore();
    expect(writeAttempt(store, ATTEMPT_SCOPE.stockIn, record())).toBe(true);
    expect(readAttempt(store, ATTEMPT_SCOPE.stockIn, "d-1", "stockin-k1")).toEqual(record());
  });

  it("refuses (returns false) when storage is unavailable or throws, so nothing is sent", () => {
    expect(writeAttempt(null, ATTEMPT_SCOPE.stockIn, record())).toBe(false);
    const throwing = { ...memoryStore(), setItem: () => { throw new Error("QuotaExceededError"); } } as Storage;
    expect(writeAttempt(throwing, ATTEMPT_SCOPE.stockIn, record())).toBe(false);
  });

  it("a record for another draft is not this draft's attempt", () => {
    const store = memoryStore();
    writeAttempt(store, ATTEMPT_SCOPE.stockIn, record());
    expect(readAttempt(store, ATTEMPT_SCOPE.stockIn, "d-2", "stockin-k1")).toBeNull();
  });

  it("a record whose key differs from the draft's still locks, as an uncertain attempt (never silently dropped)", () => {
    const store = memoryStore();
    writeAttempt(store, ATTEMPT_SCOPE.stockIn, record());
    const r = readAttempt(store, ATTEMPT_SCOPE.stockIn, "d-1", "stockin-OTHER");
    expect(r?.status).toBe("uncertain");
  });

  it("a corrupt record locks as uncertain rather than disappearing", () => {
    const store = memoryStore();
    store.setItem(`${ATTEMPT_SCOPE.stockIn}:d-1`, "{not json");
    expect(readAttempt(store, ATTEMPT_SCOPE.stockIn, "d-1", "stockin-k1")?.status).toBe("uncertain");
  });

  it("an in-flight record found after a reload becomes uncertain (no automatic retry)", () => {
    expect(recoverAfterReload(record({ status: "inflight" })).status).toBe("uncertain");
    expect(recoverAfterReload(record({ status: "uncertain" })).status).toBe("uncertain");
  });

  it("clearAttempt removes only that draft's record", () => {
    const store = memoryStore();
    writeAttempt(store, ATTEMPT_SCOPE.stockIn, record());
    writeAttempt(store, ATTEMPT_SCOPE.stockIn, record({ draftId: "d-2" }));
    clearAttempt(store, ATTEMPT_SCOPE.stockIn, "d-1");
    expect(store.getItem(`${ATTEMPT_SCOPE.stockIn}:d-1`)).toBeNull();
    expect(store.getItem(`${ATTEMPT_SCOPE.stockIn}:d-2`)).not.toBeNull();
  });
});
