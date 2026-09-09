/**
 * Decimal-safe helpers for backend fixed-scale quantity / money strings
 * ("20.000", "1.125", "120.00"). We NEVER parseFloat these for arithmetic —
 * values are kept as strings and any math is done on scaled BigInts.
 *
 * Display uses the approved 2-decimal presentation but the raw string is
 * always preserved alongside it.
 */

export type DecimalString = string;

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

export function isDecimalString(v: unknown): v is DecimalString {
  return typeof v === "string" && NUMERIC_RE.test(v.trim());
}

/** Parse a decimal string into { sign, digits (BigInt, no point), scale }. */
function parts(value: DecimalString): { neg: boolean; scaled: bigint; scale: number } {
  const s = value.trim();
  if (!NUMERIC_RE.test(s)) throw new Error(`Not a decimal string: ${JSON.stringify(value)}`);
  const neg = s.startsWith("-");
  const abs = neg ? s.slice(1) : s;
  const [int, frac = ""] = abs.split(".");
  const scale = frac.length;
  const scaled = BigInt(int + frac || "0");
  return { neg, scaled, scale };
}

function toScale(value: DecimalString, scale: number): bigint {
  const p = parts(value);
  let d = p.scaled;
  if (p.scale < scale) d *= 10n ** BigInt(scale - p.scale);
  else if (p.scale > scale) d /= 10n ** BigInt(p.scale - scale); // truncates
  return p.neg ? -d : d;
}

/** Sum a list of decimal strings, exact, returned as a decimal string. */
export function sumDecimals(values: DecimalString[], scale = 3): DecimalString {
  const total = values.reduce((acc, v) => acc + toScale(v, scale), 0n);
  return fromScaled(total, scale);
}

/** Exact `a - b` for two decimal strings. */
export function subtractDecimals(a: DecimalString, b: DecimalString, scale = 3): DecimalString {
  const av = isDecimalString(a) ? toScale(a, scale) : 0n;
  const bv = isDecimalString(b) ? toScale(b, scale) : 0n;
  return fromScaled(av - bv, scale);
}

/**
 * Render a decimal string with EXACTLY `dp` fractional digits.
 * Pads with zeros; truncates extra digits (does not round — callers restrict
 * input precision upstream). Used to build a byte-stable request payload that
 * matches the backend's `format(Decimal, ".<dp>f")` idempotency fingerprint.
 */
export function padScale(value: DecimalString, dp: number): DecimalString {
  if (!isDecimalString(value)) return value;
  const neg = value.trim().startsWith("-");
  const abs = neg ? value.trim().slice(1) : value.trim();
  const [int, frac = ""] = abs.split(".");
  const f = dp > 0 ? "." + (frac + "0".repeat(dp)).slice(0, dp) : "";
  return (neg && !/^0+$/.test(int + frac) ? "-" : "") + int + f;
}

/**
 * Exact product of two decimal strings (BigInt scaled math, no float).
 * Result scale = scale(a) + scale(b); the caller formats for display.
 * Returns "0" when either factor is not a usable decimal string.
 */
export function multiplyDecimals(a: DecimalString, b: DecimalString): DecimalString {
  if (!isDecimalString(a) || !isDecimalString(b)) return "0";
  const pa = parts(a);
  const pb = parts(b);
  const scaled = (pa.neg ? -pa.scaled : pa.scaled) * (pb.neg ? -pb.scaled : pb.scaled);
  return fromScaled(scaled, pa.scale + pb.scale);
}

function fromScaled(scaled: bigint, scale: number): DecimalString {
  const neg = scaled < 0n;
  const digits = (neg ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale) || "0";
  const frac = scale > 0 ? "." + digits.slice(digits.length - scale) : "";
  return (neg ? "-" : "") + int + frac;
}

/** -1 | 0 | 1 comparison, exact, no float. */
export function compareDecimals(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const scale = Math.max(parts(a).scale, parts(b).scale);
  const av = toScale(a, scale);
  const bv = toScale(b, scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function isZero(v: DecimalString): boolean {
  try {
    return parts(v).scaled === 0n;
  } catch {
    return false;
  }
}

/**
 * Ratio of `part` to `whole` as a Number in [0, 1], for display-only use
 * (e.g. a CSS bar width). This is the single place a Number is derived, at
 * the very end, and it is never fed back into inventory arithmetic.
 */
export function ratio(part: DecimalString, whole: DecimalString): number {
  const scale = 6;
  const w = toScale(whole, scale);
  if (w === 0n) return 0;
  const p = toScale(part, scale);
  // scale up before the divide so we keep 4 significant fractional digits
  return Number((p * 1_000_000n) / w) / 1_000_000;
}
