import * as React from "react";

import { ratio, type DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";

/**
 * Circular progress indicator for a work console header.
 * `done` / `total` are decimal strings — the only Number derived is the final
 * fraction for the SVG dash offset (via `ratio`, display-only).
 */
export function ProgressRing({
  done,
  total,
  size = 46,
  className,
  label,
}: {
  done: DecimalString;
  total: DecimalString;
  size?: number;
  className?: string;
  label?: string;
}) {
  const frac = Math.max(0, Math.min(1, ratio(done, total)));
  const pct = Math.round(frac * 100);
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const off = c * (1 - frac);
  const complete = pct >= 100;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `${pct}% complete`}
      className={cn("flex-none", className)}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={complete ? "var(--success)" : "var(--accent)"}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c.toFixed(1)}
        strokeDashoffset={off.toFixed(1)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.28}
        fontFamily="var(--font-display)"
        fill="var(--foreground)"
      >
        {pct}
      </text>
    </svg>
  );
}
