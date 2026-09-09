import { describe, expect, it } from "vitest";

import {
  initialScanContext,
  scanReducer,
  sortFefo,
  type AmbiguityCandidate,
} from "./scan-machine";

const cand = (over: Partial<AmbiguityCandidate>): AmbiguityCandidate => ({
  allocation_id: 1,
  batch_id: 1,
  quantity: "4.000",
  done: "0.000",
  ...over,
});

describe("scanReducer", () => {
  it("SUBMIT with a non-empty code moves to SCANNING and clears prior error", () => {
    const errored = scanReducer(initialScanContext, { type: "ERROR", message: "bad", code: "X" });
    const next = scanReducer(errored, { type: "SUBMIT", code: " 885000000001 " });
    expect(next.state).toBe("SCANNING");
    expect(next.code).toBe("885000000001");
    expect(next.errorCode).toBeNull();
  });

  it("SUBMIT with an empty / whitespace code is ignored (stray key, double Enter)", () => {
    expect(scanReducer(initialScanContext, { type: "SUBMIT", code: "   " })).toBe(initialScanContext);
  });

  it("MATCH → MATCHED, ERROR → ERROR with backend code, COMPLETE → COMPLETED", () => {
    let ctx = scanReducer(initialScanContext, { type: "SUBMIT", code: "abc" });
    ctx = scanReducer(ctx, { type: "MATCH", message: "counted" });
    expect(ctx.state).toBe("MATCHED");
    ctx = scanReducer(ctx, { type: "ERROR", message: "nope", code: "PRODUCT_NOT_IN_ORDER" });
    expect(ctx.state).toBe("ERROR");
    expect(ctx.errorCode).toBe("PRODUCT_NOT_IN_ORDER");
    ctx = scanReducer(ctx, { type: "COMPLETE", message: "done" });
    expect(ctx.state).toBe("COMPLETED");
  });

  it("AMBIGUOUS carries candidates; cancel returns to READY without counting", () => {
    const ctx = scanReducer(initialScanContext, {
      type: "AMBIGUOUS",
      message: "choose",
      candidates: [cand({ allocation_id: 7 }), cand({ allocation_id: 8 })],
    });
    expect(ctx.state).toBe("AMBIGUOUS");
    expect(ctx.candidates).toHaveLength(2);
    const cancelled = scanReducer(ctx, { type: "AMBIGUITY_CANCELLED" });
    expect(cancelled.state).toBe("READY");
    expect(cancelled.candidates).toHaveLength(0);
  });
});

describe("sortFefo", () => {
  it("orders by earliest expiry, nulls last, then allocation id", () => {
    const out = sortFefo([
      cand({ allocation_id: 3, expiry_date: null }),
      cand({ allocation_id: 1, expiry_date: "2026-10-19" }),
      cand({ allocation_id: 2, expiry_date: "2026-09-30" }),
      cand({ allocation_id: 4, expiry_date: null }),
    ]);
    expect(out.map((c) => c.allocation_id)).toEqual([2, 1, 3, 4]);
  });
});
