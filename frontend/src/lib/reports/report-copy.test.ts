import { describe, expect, it } from "vitest";

import {
  EXPIRY_SERIES,
  EXPIRY_SERIES_LABEL,
  MOVEMENT_TYPE_LABEL,
  MOVEMENT_TYPES,
  REPORT_EXPORTS,
  movementTypeLabel,
  reportErrorCopy,
} from "@/lib/api/schemas/reports";
import { SO_STATUSES, SO_STATUS_LABEL } from "@/lib/api/schemas/sales";
import { PO_STATUSES, PO_STATUS_LABEL } from "@/lib/api/schemas/purchase-orders";
import { TRANSFER_STATUSES, TRANSFER_STATUS_LABEL } from "@/lib/api/schemas/transfers";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import { REPORTS, REPORT_GROUPS } from "./registry";
import {
  EXPIRY_SERIES_KEY,
  MOVEMENT_TYPE_KEY,
  REPORT_EXPORT_KEY,
  REPORT_GROUP_KEY,
  REPORT_PARAM_KEY,
  REPORT_TITLE_KEY,
  movementTypeText,
  reportErrorKey,
  reportErrorText,
  statusText,
} from "./report-copy";

/*
 * P6: every report registry entry, export descriptor and copy map has a
 * dictionary key, and the ENGLISH dictionary reproduces the existing English
 * text exactly. Thai differs from English everywhere it is translated.
 */

const en = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.en, k, v);
const th = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.th, k, v);

describe("report-copy: every entry is keyed and English is unchanged", () => {
  it("registry titles, blurbs and groups", () => {
    for (const r of REPORTS) {
      const keys = REPORT_TITLE_KEY[r.slug];
      expect(keys, r.slug).toBeDefined();
      expect(en(keys.title), r.slug).toBe(r.title);
      expect(en(keys.blurb), r.slug).toBe(r.blurb);
      expect(th(keys.title), r.slug).not.toBe(r.title);
    }
    expect(Object.keys(REPORT_TITLE_KEY).sort()).toEqual(REPORTS.map((r) => r.slug).sort());
    for (const g of REPORT_GROUPS) expect(en(REPORT_GROUP_KEY[g])).toBe(g);
  });

  it("export descriptors and their parameter labels", () => {
    for (const ex of REPORT_EXPORTS) {
      expect(en(REPORT_EXPORT_KEY[ex.key].title), ex.key).toBe(ex.title);
      expect(en(REPORT_EXPORT_KEY[ex.key].description), ex.key).toBe(ex.description);
      for (const p of ex.params ?? []) expect(en(REPORT_PARAM_KEY[p.name]), p.name).toBe(p.label);
    }
  });

  it("movement types mirror movementTypeLabel, including unknown codes", () => {
    expect(Object.keys(MOVEMENT_TYPE_KEY)).toEqual(Object.keys(MOVEMENT_TYPE_LABEL));
    for (const code of [...MOVEMENT_TYPES, ...Object.keys(MOVEMENT_TYPE_LABEL), "SOMETHING_NEW"]) {
      expect(movementTypeText(en, code), code).toBe(movementTypeLabel(code));
    }
    expect(movementTypeText(th, "SOMETHING_NEW")).toBe("something new");
  });

  it("expiry series labels", () => {
    for (const s of EXPIRY_SERIES) expect(en(EXPIRY_SERIES_KEY[s]), s).toBe(EXPIRY_SERIES_LABEL[s]);
  });

  it("error copy mirrors reportErrorCopy", () => {
    const messages = [
      "Export too large (60000 rows > 50000); narrow the filters and retry",
      "Unknown sort field: bogus",
      "Validation error",
      undefined,
    ];
    for (const m of messages) {
      const key = reportErrorKey(m);
      expect(key ? en(key) : undefined, String(m)).toBe(reportErrorCopy(m));
    }
    expect(reportErrorText(th, "Unknown sort field: x", "fb")).not.toBe(reportErrorCopy("Unknown sort field: x"));
    expect(reportErrorText(th, "Validation error", "fb")).toBe("fb");
  });

  it("status options: English equals the existing label maps", () => {
    for (const s of SO_STATUSES) expect(statusText(en, s, SO_STATUS_LABEL), s).toBe(SO_STATUS_LABEL[s] ?? s);
    for (const s of PO_STATUSES) expect(statusText(en, s, PO_STATUS_LABEL), s).toBe(PO_STATUS_LABEL[s] ?? s);
    for (const s of TRANSFER_STATUSES) expect(statusText(en, s, TRANSFER_STATUS_LABEL), s).toBe(TRANSFER_STATUS_LABEL[s] ?? s);
    expect(statusText(en, "NEW_STATE", {})).toBe("NEW_STATE");
  });
});
