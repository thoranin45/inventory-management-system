import * as React from "react";
import { CheckCheck, CircleCheck, CircleDot, Loader2, ScanLine, XCircle } from "lucide-react";

import { SCAN_STATE_LABEL, type ScanState } from "./scan-machine";
import { cn } from "@/lib/utils";

/**
 * Scan state is never colour-only: a distinct icon SHAPE + the state word +
 * a dot. The console pairs this with a border-colour change on the panel.
 */
const META: Record<
  ScanState,
  { Icon: React.ComponentType<{ className?: string }>; tone: string; spin?: boolean }
> = {
  READY: { Icon: ScanLine, tone: "text-[var(--muted)]" },
  SCANNING: { Icon: Loader2, tone: "text-[var(--info)]", spin: true },
  MATCHED: { Icon: CircleCheck, tone: "text-[var(--success)]" },
  AMBIGUOUS: { Icon: CircleDot, tone: "text-[var(--warning)]" },
  ERROR: { Icon: XCircle, tone: "text-[var(--danger)]" },
  COMPLETED: { Icon: CheckCheck, tone: "text-[var(--accent)]" },
};

export function ScanStatus({ state, className }: { state: ScanState; className?: string }) {
  const { Icon, tone, spin } = META[state];
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em]",
        tone,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon
        aria-hidden
        className={cn("h-4 w-4 flex-none", spin && "animate-spin motion-reduce:animate-none")}
      />
      {SCAN_STATE_LABEL[state]}
    </div>
  );
}
