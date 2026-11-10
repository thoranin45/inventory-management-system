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

/* ------------------------------------------------- localized date display -- */

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** Buddhist-era years are Gregorian + 543. */
export const BUDDHIST_ERA_OFFSET = 543;

/**
 * A real calendar date in strict `YYYY-MM-DD` form (leap days checked).
 * Pure arithmetic on the parts: no time zone is involved, so a date-only value
 * can never shift by a day.
 */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const y = +value.slice(0, 4);
  const m = +value.slice(5, 7);
  const d = +value.slice(8, 10);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

/**
 * Display a date-only ISO value in the UI language (frozen spec): Thai shows
 * the Buddhist-era year ("30 ก.ย. 2570"), English "30 Sep 2027". The value
 * itself never changes; anything that is not a real ISO date is shown as-is
 * ("" → "—").
 */
export function formatDisplayDate(iso: string | null | undefined, locale: "th" | "en"): string {
  if (!iso) return "—";
  if (!isIsoDate(iso)) return iso;
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  return locale === "th"
    ? `${d} ${MONTHS_TH[m - 1]} ${y + BUDDHIST_ERA_OFFSET}`
    : `${String(d).padStart(2, "0")} ${MONTHS_EN[m - 1]} ${y}`;
}

/**
 * Thai users may type a Buddhist-era year into a date input (2570 for 2027).
 * A complete ISO date whose year can only be Buddhist-era (2400–2999, giving a
 * Gregorian 1857–2456) is converted to Gregorian when the result is a real
 * date; anything else is returned unchanged. The backend only ever receives
 * the Gregorian ISO value.
 */
export function normalizeBuddhistEraIso(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const y = +iso.slice(0, 4);
  if (y < 2400 || y > 2999) return iso;
  const converted = `${String(y - BUDDHIST_ERA_OFFSET).padStart(4, "0")}${iso.slice(4)}`;
  return isIsoDate(converted) ? converted : iso;
}
