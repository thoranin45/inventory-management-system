import { describe, expect, it } from "vitest";

import { TRANSFER_ERROR_COPY, createTransferInput, transferReceiveInput } from "@/lib/api/schemas/transfers";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import { TRANSFER_ERROR_KEY, transferErrorText, transferFormText } from "./transfer-copy";

/*
 * P6: every transfer copy entry has a dictionary key, and the ENGLISH
 * dictionary reproduces the existing English copy exactly.
 */

const en = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.en, k, v);
const th = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.th, k, v);

function zodMessages(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error!.issues.map((i) => i.message);
}

describe("transfer-copy: every entry is keyed and English is unchanged", () => {
  it("backend error map: same entries, English text equal, Thai translated", () => {
    expect(Object.keys(TRANSFER_ERROR_KEY)).toEqual(Object.keys(TRANSFER_ERROR_COPY));
    for (const [raw, copy] of Object.entries(TRANSFER_ERROR_COPY)) {
      expect(transferErrorText(en, raw, "fb"), raw).toBe(copy);
      expect(transferErrorText(th, raw, "fb"), raw).not.toBe(copy);
    }
  });

  it("expired-batch dispatch keeps the old English sentence", () => {
    const raw = "Cannot dispatch expired batch: 7";
    expect(transferErrorText(en, raw, "fb")).toBe(`${raw} — pick an in-date batch.`);
    expect(transferErrorText(th, raw, "fb")).toContain(raw);
    expect(transferErrorText(th, raw, "fb")).not.toBe(`${raw} — pick an in-date batch.`);
  });

  it("unknown backend messages fall back", () => {
    expect(transferErrorText(th, "Something else", "fb")).toBe("fb");
    expect(transferErrorText(en, undefined, "fb")).toBe("fb");
  });

  it("zod messages render unchanged in English and translated in Thai", () => {
    const line = { product_id: 0, batch_id: null, from_location_id: 0, to_location_id: 0, quantity: "abc" };
    const ok = { product_id: 1, batch_id: null, from_location_id: 1, to_location_id: 2, quantity: "1" };
    const messages = [
      ...zodMessages(createTransferInput, { source_warehouse_id: 0, destination_warehouse_id: 0, items: [] }),
      ...zodMessages(createTransferInput, { source_warehouse_id: 1, destination_warehouse_id: 2, items: [line] }),
      ...zodMessages(createTransferInput, { source_warehouse_id: 1, destination_warehouse_id: 2, items: [{ ...ok, quantity: "0" }] }),
      ...zodMessages(createTransferInput, { source_warehouse_id: 1, destination_warehouse_id: 2, items: [{ ...ok, quantity: "1.2345" }] }),
      ...zodMessages(createTransferInput, { source_warehouse_id: 1, destination_warehouse_id: 1, items: [ok, ok] }),
      ...zodMessages(transferReceiveInput, { items: [] }),
      ...zodMessages(transferReceiveInput, {
        items: [
          { transfer_item_id: 1, quantity: "1" },
          { transfer_item_id: 1, quantity: "2" },
        ],
      }),
    ];
    expect(new Set(messages).size).toBeGreaterThanOrEqual(12);
    for (const m of messages) {
      expect(transferFormText(en, m), m).toBe(m);
      expect(transferFormText(th, m), m).not.toBe(m);
    }
  });

  it("unknown form messages are shown as sent", () => {
    expect(transferFormText(th, "too spicy")).toBe("too spicy");
    expect(transferFormText(th, undefined)).toBeUndefined();
  });
});
