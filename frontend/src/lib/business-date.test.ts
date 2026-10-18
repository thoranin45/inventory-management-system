import { describe, expect, it } from "vitest";

import { businessToday, daysUntil, expiryState, formatDisplayDate, isIsoDate, normalizeBuddhistEraIso } from "./business-date";

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

describe("localized date-only display (D-R4-8)", () => {
  it("validates real calendar dates, including leap days", () => {
    expect(isIsoDate("2028-02-29")).toBe(true); // leap year
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2000-02-29")).toBe(true); // divisible by 400
    expect(isIsoDate("2100-02-29")).toBe(false); // divisible by 100, not 400
    expect(isIsoDate("2027-13-01")).toBe(false);
    expect(isIsoDate("2027-04-31")).toBe(false);
    expect(isIsoDate("2027-4-1")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("Thai shows the Buddhist-era year, English the Gregorian; the ISO value never changes", () => {
    expect(formatDisplayDate("2027-09-30", "th")).toBe("30 ก.ย. 2570");
    expect(formatDisplayDate("2027-09-30", "en")).toBe("30 Sep 2027");
    expect(formatDisplayDate("2028-02-29", "th")).toBe("29 ก.พ. 2571");
    expect(formatDisplayDate("2027-01-05", "en")).toBe("05 Jan 2027");
    expect(formatDisplayDate(null, "th")).toBe("—");
    expect(formatDisplayDate("not-a-date", "en")).toBe("not-a-date");
  });

  it("is time-zone independent (pure date parts, no Date object)", () => {
    // the first and last instant of a day in any zone still show that same day
    expect(formatDisplayDate("2027-01-01", "en")).toBe("01 Jan 2027");
    expect(formatDisplayDate("2026-12-31", "th")).toBe("31 ธ.ค. 2569");
  });

  it("normalizes a Buddhist-era year typed in Thai and round-trips through display", () => {
    expect(normalizeBuddhistEraIso("2570-09-30")).toBe("2027-09-30");
    expect(normalizeBuddhistEraIso("2571-02-29")).toBe("2028-02-29"); // BE leap day maps to a real CE leap day
    expect(normalizeBuddhistEraIso("2027-09-30")).toBe("2027-09-30"); // already Gregorian
    expect(normalizeBuddhistEraIso("")).toBe("");
    const iso = normalizeBuddhistEraIso("2570-09-30");
    expect(formatDisplayDate(iso, "th")).toBe("30 ก.ย. 2570");
  });
});
