import { isDecimalString, type DecimalString } from "./decimal";

/** The real minus sign (U+2212) the frozen Concept B spec uses for quantities. */
export const MINUS = "−";

/** Fractional digits of an inventory quantity (the backend stores 3). */
export const QTY_SCALE = 3;

const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** True when a quantity carries more decimals than the supported scale (shown in full, never rounded). */
export function qtyScaleAnomaly(value: DecimalString | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const raw = typeof value === "number" ? String(value) : value.trim();
  return isDecimalString(raw) && (raw.split(".")[1]?.length ?? 0) > QTY_SCALE;
}

/**
 * Concept B inventory quantity: fixed 3 decimals, EXACT. Pure string handling
 * (no parseFloat): shorter values are padded ("5" → "5.000", "0.001" →
 * "0.001"); nothing is ever rounded or truncated, so a value with more than
 * 3 decimals keeps every digit (see `qtyScaleAnomaly`). Negative values use
 * the real minus sign. Not for money (`formatMoney`) or counts (`formatCount`).
 */
export function formatQty(value: DecimalString | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!isDecimalString(raw)) return String(value);

  const neg = raw.startsWith("-");
  const abs = neg ? raw.slice(1) : raw;
  const [int, frac = ""] = abs.split(".");
  const digits = frac.length >= QTY_SCALE ? frac : frac.padEnd(QTY_SCALE, "0");
  const zero = /^0*$/.test(int + frac);
  return (neg && !zero ? MINUS : "") + group(int) + "." + digits;
}

/**
 * A quantity change with an explicit sign: "+12.000", "−0.005", "0.000"
 * (zero has no sign). Exact, like `formatQty`.
 */
export function formatQtyDelta(value: DecimalString | null | undefined): string {
  const q = formatQty(value);
  if (q === "—" || !isDecimalString((value ?? "").trim())) return q;
  if (q.startsWith(MINUS) || /^[0.,]+$/.test(q)) return q;
  return "+" + q;
}

/**
 * Money: 2 decimals, rounded half-up on the 3rd digit (string/BigInt maths),
 * with the currency symbol. Unchanged by the Concept B quantity policy.
 */
export function formatMoney(value: DecimalString | number | null | undefined, symbol = "฿"): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!isDecimalString(raw)) return symbol + String(value);

  const neg = raw.startsWith("-");
  const abs = neg ? raw.slice(1) : raw;
  let [int, frac = ""] = abs.split(".");

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

  const intGrouped = group(int);
  return symbol + (neg && intGrouped !== "0" ? "-" : "") + intGrouped + "." + frac;
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
 * Phase 14C — the stored wall-clock value of an UNVERIFIED naive timestamp
 * ("2026-10-09T17:30:00" → "2026-10-09 17:30"). Shown as-is, never converted:
 * its zone is unproven, so no Bangkok conversion would be honest.
 */
export function formatStoredWallClock(naive: string | null | undefined): string {
  if (!naive || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(naive)) return "—";
  return `${naive.slice(0, 10)} ${naive.slice(11, 16)}`;
}

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
