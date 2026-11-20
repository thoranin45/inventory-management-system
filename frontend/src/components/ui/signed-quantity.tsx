import { formatSignedQty } from "@/lib/format";

/**
 * A ledger movement at full backend precision with an explicit sign
 * ("+12.000", "−0.005"). Colour is never the only cue: the sign is shown too.
 */
export function SignedQuantity({ value, className }: { value: string; className?: string }) {
  const neg = value.trim().startsWith("-");
  const zero = /^-?[0.]+$/.test(value.trim());
  return (
    <span
      className={`mono tabular-nums font-semibold ${zero ? "" : neg ? "text-[var(--danger)]" : "text-[var(--success)]"} ${className ?? ""}`}
      data-raw={value}
      title={value}
    >
      {formatSignedQty(value)}
    </span>
  );
}
