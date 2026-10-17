import { describe, expect, it } from "vitest";

import { bumpPatch, TRAIL_LIMIT, type TrailEntry } from "./scan-count";

const entry = (n: number) => (kind: TrailEntry["kind"]): TrailEntry => ({ id: `e${n}`, kind, text: `t${n}`, at: "10:00" });

describe("bumpPatch", () => {
  it("a hit adds one and prepends a 'hit' entry", () => {
    expect(bumpPatch({ count: 2, trail: [] }, 1, entry(1))).toEqual({
      count: 3,
      trail: [{ id: "e1", kind: "hit", text: "t1", at: "10:00" }],
    });
  });

  it("an undo subtracts one and prepends an 'undo' entry", () => {
    const prior: TrailEntry = { id: "e0", kind: "hit", text: "t0", at: "09:59" };
    expect(bumpPatch({ count: 1, trail: [prior] }, -1, entry(1))).toEqual({
      count: 0,
      trail: [{ id: "e1", kind: "undo", text: "t1", at: "10:00" }, prior],
    });
  });

  it("an undo at zero is a no-op and creates no entry", () => {
    let made = 0;
    const result = bumpPatch({ count: 0, trail: [] }, -1, (kind) => {
      made++;
      return entry(1)(kind);
    });
    expect(result).toBeNull();
    expect(made).toBe(0);
  });

  it("keeps only the newest TRAIL_LIMIT (12) entries", () => {
    expect(TRAIL_LIMIT).toBe(12);
    const trail = Array.from({ length: 12 }, (_, i) => entry(i)("hit"));
    const result = bumpPatch({ count: 12, trail }, 1, entry(99))!;
    expect(result.trail).toHaveLength(12);
    expect(result.trail[0].id).toBe("e99");
    expect(result.trail.at(-1)!.id).toBe("e10");
  });
});
