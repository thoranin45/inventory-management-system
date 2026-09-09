import { describe, expect, it } from "vitest";

import { businessToday, daysUntil, expiryState } from "./business-date";

// A fixed instant: 2026-09-08 in Asia/Bangkok (UTC+7) — 2026-09-07T20:00Z is
// already the 8th in Bangkok.
const NOW = new Date("2026-09-07T20:00:00Z");

describe("businessToday (Asia/Bangkok)", () => {
  it("rolls to the next Bangkok day even when UTC is still the previous day", () => {
    expect(businessToday(NOW)).toBe("2026-09-08");
    expect(businessToday(new Date("2026-09-08T10:00:00Z"))).toBe("2026-09-08");
  });
});

describe("daysUntil", () => {
  it("is 0 on the business date, negative once past, positive in future", () => {
    expect(daysUntil("2026-09-08", NOW)).toBe(0);
    expect(daysUntil("2026-09-05", NOW)).toBe(-3);
    expect(daysUntil("2026-12-07", NOW)).toBe(90);
  });
});

describe("expiryState — matches Phase 7 semantics (past = expired but still accepted)", () => {
  it("classifies expired / same-day / near / ok", () => {
    expect(expiryState("2020-01-01", NOW)).toBe("expired");
    expect(expiryState("2026-09-08", NOW)).toBe("same-day");
    expect(expiryState("2026-10-01", NOW)).toBe("near"); // within 90 days
    expect(expiryState("2028-01-01", NOW)).toBe("ok");
    expect(expiryState(null)).toBeNull();
    expect(expiryState("not-a-date")).toBeNull();
  });
});
