import { describe, expect, it } from "vitest";

import { DICTIONARIES, translate } from "@/lib/i18n/translate";
import { englishConsoleMessage, renderConsoleMessage } from "./console-message";

const th = (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate(DICTIONARIES.th, k, v);

describe("console messages (D-R5-10)", () => {
  it("English is the pre-R5 console copy", () => {
    expect(englishConsoleMessage({ key: "fulfil.lineCountedPick", vars: { done: "2.000", of: "2.000" } })).toBe("✓ Picked +2.000 / 2.000");
    expect(
      englishConsoleMessage({ key: "fulfil.counted", vars: { name: { k: "fulfil.item" }, id: 8, done: "1.000", of: "2.000" } }),
    ).toBe("Item counted — now 1.000 / 2.000.");
    expect(englishConsoleMessage({ key: "fulfil.undoFailedRequest", vars: { id: "req-u" } })).toBe("Undo failed · Request req-u");
    expect(englishConsoleMessage({ key: "fulfil.everyLineDonePack" })).toBe("Every line is packed. Review and complete packing.");
  });

  it("appends the request id and keeps backend copy verbatim", () => {
    expect(englishConsoleMessage({ verbatim: "Order is locked.", rid: "r1" })).toBe("Order is locked. · Request r1");
    expect(renderConsoleMessage({ verbatim: "Order is locked." }, th)).toBe("Order is locked.");
  });

  it("renders the same message in Thai at display time, including key variables", () => {
    const m = { key: "fulfil.counted" as const, vars: { name: { k: "fulfil.item" as const }, id: 8, done: "1.000", of: "2.000" } };
    expect(renderConsoleMessage(m, th)).toBe(th("fulfil.counted", { name: th("fulfil.item"), id: 8, done: "1.000", of: "2.000" }));
    expect(renderConsoleMessage(m, th)).not.toBe(englishConsoleMessage(m));
  });
});
