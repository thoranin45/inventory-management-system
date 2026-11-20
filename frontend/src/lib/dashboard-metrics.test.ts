import { describe, expect, it } from "vitest";

import {
  activityWhen,
  bucketWidth,
  businessTimeOfDay,
  expiryBuckets,
  kpiKeysFor,
  nearExpiryLots,
} from "./dashboard-metrics";

const rows = (...days: (number | null)[]) => days.map((days_to_expiry) => ({ days_to_expiry }));

describe("kpiKeysFor (design KPI sets)", () => {
  it("admin watches approvals and the catalogue", () => {
    expect(kpiKeysFor(true)).toEqual(["low", "near", "expired", "approvals", "pick", "skus"]);
  });
  it("warehouse watches receiving and its own requests", () => {
    expect(kpiKeysFor(false)).toEqual(["low", "near", "expired", "pick", "receipts", "mine"]);
  });
});

describe("expiryBuckets", () => {
  it("puts each lot in exactly one bucket, with inclusive upper bounds", () => {
    const b = expiryBuckets(rows(0, 30, 31, 60, 61, 90, 91, 400), [{}, {}]);
    expect(b).toEqual({ expired: 2, d30: 2, d60: 2, d90: 2, later: 2 });
  });

  it("counts a lot expiring today as usable (within 30 days), never as expired", () => {
    expect(expiryBuckets(rows(0), [])).toEqual({ expired: 0, d30: 1, d60: 0, d90: 0, later: 0 });
  });

  it("ignores near-expiry rows without days or already past (the expired report owns those)", () => {
    expect(expiryBuckets(rows(null, -1), [])).toEqual({ expired: 0, d30: 0, d60: 0, d90: 0, later: 0 });
  });

  it("the 90-day tile is every bucket inside the window", () => {
    expect(nearExpiryLots(expiryBuckets(rows(0, 45, 90, 91), [{}]))).toBe(3);
  });
});

describe("bucketWidth", () => {
  it("scales to the largest bucket with a visible minimum, and draws nothing for zero", () => {
    expect(bucketWidth(10, 10)).toBe(100);
    expect(bucketWidth(5, 10)).toBe(50);
    expect(bucketWidth(1, 1000)).toBe(3);
    expect(bucketWidth(0, 10)).toBe(0);
    expect(bucketWidth(0, 0)).toBe(0);
  });
});

describe("businessTimeOfDay", () => {
  it("shows an instant on the Bangkok clock", () => {
    expect(businessTimeOfDay("2026-11-19T15:30:14.819963+00:00")).toBe("22:30");
    expect(businessTimeOfDay("2026-11-19T17:05:00Z")).toBe("00:05");
  });
  it("refuses a timestamp without a zone", () => {
    expect(businessTimeOfDay("2026-11-19T15:30:14")).toBe("—");
    expect(businessTimeOfDay(null)).toBe("—");
  });
});

describe("activityWhen", () => {
  // 2026-11-19 10:00 in Bangkok
  const now = new Date("2026-11-19T03:00:00Z");

  it("a verified row from business-today shows its Bangkok time only", () => {
    const row = { occurred_at: "2026-11-19T02:42:00Z", timestamp_verified: true, created_at: "2026-11-19T02:42:00" };
    expect(activityWhen(row, now)).toEqual({ time: "09:42", date: null, verified: true });
  });

  it("uses the business calendar: 23:30 UTC is already tomorrow in Bangkok", () => {
    const row = { occurred_at: "2026-11-18T17:30:00Z", timestamp_verified: true, created_at: "2026-11-18T17:30:00" };
    expect(activityWhen(row, now)).toEqual({ time: "00:30", date: null, verified: true });
  });

  it("a verified row from an earlier day carries its date", () => {
    const row = { occurred_at: "2026-11-18T09:10:00Z", timestamp_verified: true, created_at: "2026-11-18T09:10:00" };
    expect(activityWhen(row, now)).toEqual({ time: "16:10", date: "2026-11-18", verified: true });
  });

  it("an unverified row keeps its stored wall clock, always dated, never converted", () => {
    const row = { occurred_at: null, timestamp_verified: false, created_at: "2026-11-19T08:15:00" };
    expect(activityWhen(row, now)).toEqual({ time: "08:15", date: "2026-11-19", verified: false });
  });

  it("an unreadable timestamp shows a dash", () => {
    const row = { occurred_at: null, timestamp_verified: false, created_at: "" };
    expect(activityWhen(row, now)).toEqual({ time: "—", date: null, verified: false });
  });
});
