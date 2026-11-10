import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { RETURN_KEY_CONFLICT } from "@/lib/api/schemas/sales";
import {
  clearReturnedLines,
  isReturnKeyConflict,
  mergeReturnedTotals,
  returnTotal,
  validateReturnLines,
  type ReturnLineDraft,
} from "./return-submission";

const line = (product_id: number, quantity: string, reason = "", ordered = "5"): ReturnLineDraft => ({
  product_id,
  ordered,
  quantity,
  reason,
});
const ceilingOf = (l: ReturnLineDraft) => l.ordered;

describe("returnTotal", () => {
  it("sums valid quantities exactly at 3 dp", () => {
    expect(returnTotal([line(6, "1.5"), line(3, " 0.25 ")])).toBe("1.750");
    expect(returnTotal([])).toBe("0.000");
  });

  it("is null (unknown, never zero) while any quantity is not a number", () => {
    for (const q of ["1.", "abc", ".", "-", "1.2.3"]) {
      expect(returnTotal([line(6, "1"), line(3, q)])).toBeNull();
    }
  });
});

describe("validateReturnLines", () => {
  it("keeps the given line order, trims quantities without padding, trims or omits reasons", () => {
    expect(validateReturnLines([line(3, " 2 ", "   "), line(6, "1.50", "  torn  ")], ceilingOf)).toEqual({
      ok: true,
      items: [
        { product_id: 3, quantity: "2" },
        { product_id: 6, quantity: "1.50", reason: "torn" },
      ],
    });
  });

  it("an invalid quantity is a problem carrying the schema message, and blocks every line", () => {
    const result = validateReturnLines([line(3, "1"), line(6, "1.")], ceilingOf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.problems)).toEqual(["6"]);
      expect(result.problems[6]).toEqual({ kind: "invalid", message: expect.stringMatching(/up to 3 decimals/i) });
    }
    for (const q of ["abc", "1.0001", "0", "-1"]) {
      expect(validateReturnLines([line(6, q)], ceilingOf).ok).toBe(false);
    }
  });

  it("a quantity above the ceiling is a 'ceiling' problem with that ceiling", () => {
    expect(validateReturnLines([line(6, "5.001")], () => "5.000")).toEqual({
      ok: false,
      problems: { 6: { kind: "ceiling", ceiling: "5.000" } },
    });
    expect(validateReturnLines([line(6, "5")], () => "5.000").ok).toBe(true);
  });
});

describe("isReturnKeyConflict", () => {
  it("is HTTP 409 with exactly the backend message", () => {
    expect(isReturnKeyConflict(new ApiError({ status: 409, message: RETURN_KEY_CONFLICT }))).toBe(true);
    expect(isReturnKeyConflict(new ApiError({ status: 422, message: RETURN_KEY_CONFLICT }))).toBe(false);
    expect(isReturnKeyConflict(new ApiError({ status: 409, message: RETURN_KEY_CONFLICT.toUpperCase() }))).toBe(false);
    expect(isReturnKeyConflict(new Error(RETURN_KEY_CONFLICT))).toBe(false);
  });
});

describe("result handling", () => {
  const returned = [{ product_id: 6, returned_quantity: "1", previously_returned: "0", total_returned: "1", remaining_returnable: "4" }];

  it("mergeReturnedTotals records the backend total per product", () => {
    expect(mergeReturnedTotals({ 3: "2" }, returned)).toEqual({ 3: "2", 6: "1" });
  });

  it("clearReturnedLines clears only the returned lines' quantity and reason", () => {
    const lines = { 6: line(6, "1", "dent"), 3: line(3, "1", "x") };
    expect(clearReturnedLines(lines, returned)).toEqual({ 6: line(6, "", ""), 3: line(3, "1", "x") });
    expect(lines[6].quantity).toBe("1"); // not mutated
  });
});

describe("returnTotal follows the Sales Return quantity rule (no truncated look-alike totals)", () => {
  it("over-precise quantities are not a number for the total: never truncated to a valid-looking value", () => {
    expect(returnTotal([line(6, "0.0009")])).toBeNull(); // not "0.000"
    expect(returnTotal([line(6, "1.2345")])).toBeNull(); // not "1.234"
    expect(returnTotal([line(3, "1"), line(6, "0.0009")])).toBeNull(); // beside a valid line
  });

  it("values the rule rejects show no total either", () => {
    for (const q of ["0", "0.000", "-1", "1.", "abc"]) expect(returnTotal([line(6, q)])).toBeNull();
  });

  it("valid quantities with up to 3 decimals still sum exactly", () => {
    expect(returnTotal([line(6, "1.234")])).toBe("1.234");
    expect(returnTotal([line(6, "1.5"), line(3, "2")])).toBe("3.500");
  });

  it("the total accepts exactly what submit accepts (same rule, ceilings aside)", () => {
    for (const q of ["0.0009", "1.2345", "1.", "abc", "0", "-1", "1.234", "1.5", " 2 "]) {
      const totalKnown = returnTotal([line(6, q)]) !== null;
      const submittable = validateReturnLines([line(6, q, "", "999")], ceilingOf).ok;
      expect(totalKnown, q).toBe(submittable);
    }
  });
});
