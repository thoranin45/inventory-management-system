import { describe, expect, it } from "vitest";

import { addReceiptOnce, summarizeReceipt } from "./receipt-summary";

describe("summarizeReceipt", () => {
  it("sums only valid entered quantities exactly, at 3 dp", () => {
    const s = summarizeReceipt([
      { quantity: "0.1", error: null },
      { quantity: "0.2", error: null },
      { quantity: "", error: null },
      { quantity: "99", error: "Only 5.000 remaining on this line" },
    ]);
    expect(s.receivingNow).toBe("0.300");
    expect(s.selectedCount).toBe(2);
    expect(s.lineErrors).toEqual(["Only 5.000 remaining on this line"]);
  });

  it("an invalid entry contributes nothing and never throws", () => {
    const s = summarizeReceipt([{ quantity: "1.", error: "Enter a quantity greater than 0" }]);
    expect(s).toEqual({ lineErrors: ["Enter a quantity greater than 0"], receivingNow: "0.000", selectedCount: 0 });
  });

  it("an empty receipt", () => {
    expect(summarizeReceipt([])).toEqual({ lineErrors: [], receivingNow: "0.000", selectedCount: 0 });
  });
});

describe("addReceiptOnce", () => {
  it("prepends a new receipt and ignores a replay of a listed one", () => {
    const a = { receipt_number: "A" };
    const b = { receipt_number: "B" };
    const once = addReceiptOnce([a], b);
    expect(once).toEqual([b, a]);
    const replay = addReceiptOnce(once, { receipt_number: "B" });
    expect(replay).toBe(once);
  });
});
