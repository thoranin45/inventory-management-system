import { isDecimalString, type DecimalString } from "./decimal";

/**
 * Approved 2-decimal presentation for quantities & money.
 *
 * Operates purely on the string form — no parseFloat, no precision loss.
 * Truncation/rounding: we round half-up on the 3rd fractional digit for
 * display only; the raw value is always preserved by callers.
 */
export function formatQty(value: DecimalString | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!isDecimalString(raw)) return String(value);

  const neg = raw.startsWith("-");
  const abs = neg ? raw.slice(1) : raw;
  let [int, frac = ""] = abs.split(".");

  // round to 2 dp, half-up, using string/BigInt math
  if (frac.length > 2) {
    const keep = frac.slice(0, 2);
    const nextDigit = frac.charCodeAt(2) - 48;
    let scaled = BigInt(int + keep);
    if (nextDigit >= 5) scaled += 1n;
    const s = scaled.toString().padStart(3, "0");
    int = s.slice(0, s.length - 2);
    frac = s.slice(s.length - 2);
  } else {
    frac = (frac + "00").slice(0, 2);
  }

  const intGrouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg && intGrouped !== "0" ? "-" : "") + intGrouped + "." + frac;
}

export function formatMoney(value: DecimalString | number | null | undefined, symbol = "฿"): string {
  const q = formatQty(value);
  return q === "—" ? q : symbol + q;
}

/** Whole-number counts (queues, badges) — never decimals. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // "2026-09-07" or full ISO — show the date part only
  return iso.slice(0, 10);
}

/** Relative day label used by Recent activity ("today", "1d ago", …). */
export function agoFromIso(iso: string | null | undefined, nowIso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  if (Number.isNaN(then) || Number.isNaN(now)) return "";
  const days = Math.round((now - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

/**
 * Phase 14C — a ledger quantity with its sign and EXACT backend precision
 * ("-0.005" → "−0.005", "12.000" → "+12.000"). Pure string handling: the
 * ledger must never round a movement away.
 */
export function formatSignedQty(value: DecimalString | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = value.trim();
  if (!isDecimalString(raw)) return raw;
  const neg = raw.startsWith("-");
  const abs = neg ? raw.slice(1) : raw;
  const [int, frac] = abs.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? `.${frac}` : "");
  if (/^[0.]+$/.test(abs)) return grouped;
  return (neg ? "−" : "+") + grouped;
}

const BUSINESS_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Phase 14C — an explicit instant (ISO-8601 WITH `Z` or an offset) shown on
 * the Asia/Bangkok business clock as "YYYY-MM-DD HH:mm". A timestamp without
 * an offset is ambiguous, so it is refused ("—") rather than guessed.
 */
export function formatBusinessDateTime(iso: string | null | undefined): string {
  if (!iso || !/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(BUSINESS_DATE_TIME.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
