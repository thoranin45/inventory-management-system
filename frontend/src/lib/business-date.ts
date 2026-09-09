/**
 * Phase 7 business-date semantics, mirrored on the client for *display only*.
 *
 *   expiry <  business_today  → expired      (backend still ACCEPTS it inbound)
 *   expiry == business_today  → usable today (accepted)
 *   expiry >  business_today  → usable
 *
 * Business calendar is Asia/Bangkok. We derive "today there" from the browser
 * clock via Intl, never from a naive local Date, so the label matches the
 * backend regardless of the operator's timezone.
 */
const BUSINESS_TZ = "Asia/Bangkok";
const NEAR_EXPIRY_DAYS = 90;

/** YYYY-MM-DD for "today" on the business calendar. */
export function businessToday(now: Date = new Date()): string {
  // en-CA gives ISO-ish YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole days from business-today to an ISO date (negative once past). */
export function daysUntil(isoDate: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null;
  const today = businessToday(now);
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export type ExpiryState = "expired" | "same-day" | "near" | "ok";

/** Classify an entered expiry date for the receiving UI. `null` if not a date. */
export function expiryState(isoDate: string | null | undefined, now: Date = new Date()): ExpiryState | null {
  if (!isoDate) return null;
  const d = daysUntil(isoDate, now);
  if (d === null) return null;
  if (d < 0) return "expired";
  if (d === 0) return "same-day";
  if (d <= NEAR_EXPIRY_DAYS) return "near";
  return "ok";
}

export const EXPIRY_STATE_LABEL: Record<ExpiryState, string> = {
  expired: "Already expired — accepted inbound, flagged in stock",
  "same-day": "Expires today — still usable today",
  near: "Near expiry",
  ok: "In date",
};
