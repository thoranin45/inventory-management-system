import { describe, expect, it } from "vitest";

import { auditActionLabel, auditEntityLabel, auditLogListSchema, auditLogSchema } from "./audit";

const rows = [
  {
    id: 620,
    table_name: "products",
    description: "Soft Delete Product: QA-P7-x - QA P7 Image",
    username: "wc_admin",
    record_id: 19,
    action: "SOFT_DELETE_PRODUCT",
    created_at: "2026-09-08T18:01:59.361027",
  },
  {
    id: 1,
    table_name: "sales_orders",
    description: "SO-000001: DRAFT -> DRAFT. ",
    username: "wc_admin",
    record_id: 1,
    action: "CREATE_SALES_ORDER",
    created_at: "2026-09-08T12:15:48.352261",
  },
];

describe("auditLogListSchema", () => {
  it("parses a BARE ARRAY of audit rows (no envelope)", () => {
    const parsed = auditLogListSchema.parse(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].action).toBe("SOFT_DELETE_PRODUCT");
  });

  it("only knows the seven non-sensitive columns — nothing password/token-shaped", () => {
    const keys = Object.keys(auditLogSchema.shape);
    expect(keys.sort()).toEqual(["action", "created_at", "description", "id", "record_id", "table_name", "username"]);
    for (const k of keys) expect(k).not.toMatch(/pass|hash|token|secret|authorization|jwt/i);
  });

  it("tolerates null columns", () => {
    expect(
      auditLogSchema.parse({ id: 5, username: null, action: null, table_name: null, record_id: null, description: null, created_at: null }).id,
    ).toBe(5);
  });
});

describe("labels", () => {
  it("map known entities and humanise actions", () => {
    expect(auditEntityLabel("sales_orders")).toBe("Sales order");
    expect(auditEntityLabel("weird_table")).toBe("weird table");
    expect(auditEntityLabel(null)).toBe("—");
    expect(auditActionLabel("SHIP_SALES_ORDER")).toBe("Ship sales order");
    expect(auditActionLabel(null)).toBe("—");
  });
});
