import { businessToday } from "./business-date";
import { formatBusinessDateTime, formatStoredWallClock } from "./format";

/**
 * UI-1 — pure logic behind the dashboard (Concept B, Design Showroom DashB).
 * Every figure here is a COUNT of records the linked page lists, never a sum
 * of quantities across products (those have different units).
 */

/** The eight count tiles the design defines. */
export type KpiKey = "low" | "near" | "expired" | "approvals" | "pick" | "skus" | "receipts" | "mine";

/**
 * Tile order per role, exactly as the design: admin watches approvals and the
 * catalogue, warehouse its receiving work and its own requests. Phones show
 * the first four.
 */
export function kpiKeysFor(admin: boolean): readonly KpiKey[] {
  return admin
    ? ["low", "near", "expired", "approvals", "pick", "skus"]
    : ["low", "near", "expired", "pick", "receipts", "mine"];
}

/** "Lots expiring in 90 days": the same window as the near-expiry report's default. */
export const NEAR_EXPIRY_WINDOW_DAYS = 90;

/**
 * The near-expiry report is asked for this many days (its maximum) so one
 * request fills every horizon bucket. Lots further out than ten years are
 * not counted in "Over 90 days".
 */
export const EXPIRY_HORIZON_DAYS = 3650;

export interface ExpiryBuckets {
  expired: number;
  d30: number;
  d60: number;
  d90: number;
  later: number;
}

/**
 * Lots with stock, by days left until expiry. `expiredRows` come from the
 * expired-stock report (expiry before business-today) and `nearRows` from the
 * near-expiry report (business-today up to the window); the backend keeps the
 * two disjoint. A lot that expires today is still usable today, so it counts
 * in "within 30 days", never in "expired".
 */
export function expiryBuckets(
  nearRows: readonly { days_to_expiry: number | null }[],
  expiredRows: readonly unknown[],
): ExpiryBuckets {
  const buckets: ExpiryBuckets = { expired: expiredRows.length, d30: 0, d60: 0, d90: 0, later: 0 };
  for (const row of nearRows) {
    const days = row.days_to_expiry;
    if (days === null || days < 0) continue;
    if (days <= 30) buckets.d30 += 1;
    else if (days <= 60) buckets.d60 += 1;
    else if (days <= NEAR_EXPIRY_WINDOW_DAYS) buckets.d90 += 1;
    else buckets.later += 1;
  }
  return buckets;
}

/** The "Lots expiring in 90 days" tile: every bucket inside the window. */
export function nearExpiryLots(buckets: ExpiryBuckets): number {
  return buckets.d30 + buckets.d60 + buckets.d90;
}

/** Bar length of one horizon bucket, in percent of the largest (at least 3 so a 1 is still visible). */
export function bucketWidth(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(3, (count / max) * 100);
}

/** "HH:mm" on the Asia/Bangkok business clock, from an instant with Z or an offset. */
export function businessTimeOfDay(iso: string | null | undefined): string {
  const stamp = formatBusinessDateTime(iso);
  return stamp === "—" ? stamp : stamp.slice(11, 16);
}

export interface ActivityWhen {
  /** "HH:mm" */
  time: string;
  /** ISO date to show beside the time; null when it is a verified row from business-today. */
  date: string | null;
  /** false: the stored wall-clock time is shown as recorded, its zone unproven. */
  verified: boolean;
}

/**
 * When a ledger row happened, for the dashboard's short time column. Verified
 * rows are on the Bangkok business clock and today's rows show the time only.
 * Unverified rows keep their stored wall-clock value (never converted, as in
 * the ledger) and always show their date, since "today" cannot be claimed.
 */
export function activityWhen(
  row: { occurred_at: string | null; timestamp_verified: boolean; created_at: string },
  now: Date = new Date(),
): ActivityWhen {
  const verified = row.timestamp_verified && Boolean(row.occurred_at);
  const stamp = verified ? formatBusinessDateTime(row.occurred_at) : formatStoredWallClock(row.created_at);
  if (stamp === "—") return { time: "—", date: null, verified };
  const date = stamp.slice(0, 10);
  return { time: stamp.slice(11, 16), date: verified && date === businessToday(now) ? null : date, verified };
}
