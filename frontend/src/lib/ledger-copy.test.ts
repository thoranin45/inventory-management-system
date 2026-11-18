import { describe, expect, it } from "vitest";

import { LEDGER_TYPE_META, MOVEMENT_GROUPS, ledgerTypeMeta } from "@/lib/api/schemas/inventory-movements";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import { LEDGER_TYPE_KEY, MOVEMENT_GROUP_KEY, ledgerTypeText } from "./ledger-copy";

const en = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.en, k, v);
const th = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.th, k, v);

describe("ledger-copy: every entry is keyed and English is unchanged", () => {
  it("movement groups", () => {
    expect(Object.keys(MOVEMENT_GROUP_KEY).sort()).toEqual(MOVEMENT_GROUPS.map((g) => g.key).sort());
    for (const g of MOVEMENT_GROUPS) {
      expect(en(MOVEMENT_GROUP_KEY[g.key]), g.key).toBe(g.label);
      expect(th(MOVEMENT_GROUP_KEY[g.key]), g.key).not.toBe(g.label);
    }
  });

  it("movement types mirror ledgerTypeMeta, including unknown types", () => {
    expect(Object.keys(LEDGER_TYPE_KEY)).toEqual(Object.keys(LEDGER_TYPE_META));
    for (const type of [...Object.keys(LEDGER_TYPE_META), "SOMETHING_NEW"]) {
      expect(ledgerTypeText(en, type), type).toBe(ledgerTypeMeta(type).label);
    }
    expect(ledgerTypeText(th, "SOMETHING_NEW")).toBe("something new");
    expect(ledgerTypeText(th, "STOCK_IN")).not.toBe("Stock in");
  });

  it("the unlinked-adjustment label", () => {
    expect(en("ledger.adjustmentUnlinked")).toBe("Adjustment (unlinked)");
  });
});
