import { describe, expect, it } from "vitest";

import { AUDIT_ENTITY_LABEL, auditActionLabel, auditEntityLabel } from "@/lib/api/schemas/audit";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import { AUDIT_ACTION_KEY, AUDIT_ENTITY_KEY, auditActionText, auditEntityText } from "./audit-copy";

const en = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.en, k, v);
const th = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.th, k, v);

describe("audit-copy: English is unchanged, Thai is translated", () => {
  it("actions: English equals auditActionLabel, Thai differs", () => {
    for (const code of Object.keys(AUDIT_ACTION_KEY)) {
      expect(auditActionText(en, code), code).toBe(auditActionLabel(code));
      expect(auditActionText(th, code), code).not.toBe(auditActionLabel(code));
    }
  });

  it("entities: every AUDIT_ENTITY_LABEL entry is keyed; English equals auditEntityLabel", () => {
    for (const table of Object.keys(AUDIT_ENTITY_LABEL)) expect(AUDIT_ENTITY_KEY[table], table).toBeDefined();
    for (const table of Object.keys(AUDIT_ENTITY_KEY)) {
      expect(auditEntityText(en, table), table).toBe(auditEntityLabel(table));
      expect(auditEntityText(th, table), table).not.toBe(auditEntityLabel(table));
    }
  });

  it("unknown and empty codes fall back to the English helpers", () => {
    expect(auditActionText(th, "SOMETHING_NEW")).toBe("Something new");
    expect(auditEntityText(th, "weird_table")).toBe("weird table");
    expect(auditActionText(th, null)).toBe("—");
    expect(auditEntityText(th, null)).toBe("—");
  });
});
