"use client";

import * as React from "react";

import { useScanner } from "@/components/work/use-scanner";
import { isApiError } from "@/lib/api/errors";
import { resolveBarcode } from "@/lib/query/sales";
import { bumpPatch, type ScanCountLine } from "@/lib/workflow/scan-count";

/** What the last scan did; the console turns it into copy. */
export type ScanFeedback =
  | { kind: "idle" }
  /** counted: the session's count is now `count` */
  | { kind: "match"; count: number }
  /** a registered product, but not the session's */
  | { kind: "wrong"; productName: string }
  /** a barcode no product is registered for (404) */
  | { kind: "unknown"; code: string }
  /** the lookup failed; `userMessage` when the backend said why */
  | { kind: "error"; userMessage: string | null };

function nowHM(): string {
  return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * The verified scan-count session shared by Stock In and Stock Out. The
 * session is the single draft line 0. A scan resolves the barcode
 * (read-only; `purpose` is the backend lookup context) and counts it only when
 * it is the session's product. Nothing here saves stock: the console's one
 * Save does.
 */
export function useScanCountSession<Line extends ScanCountLine>({
  draft,
  purpose,
  scanning,
  busy,
  beepOk,
  beepBad,
  hitTrailText,
}: {
  draft: { lines: Record<number, Line>; setLine: (id: number, patch: Partial<Line>) => void };
  purpose: "stock_in" | "lookup";
  /** the console is in its scanning phase */
  scanning: boolean;
  /** a save is in flight: scans are ignored */
  busy: boolean;
  beepOk: () => void;
  beepBad: () => void;
  /** the trail text of a counted scan */
  hitTrailText: (code: string) => string;
}) {
  const [feedback, setFeedback] = React.useState<ScanFeedback>({ kind: "idle" });
  const [resolving, setResolving] = React.useState(false);

  const bump = React.useCallback(
    (delta: 1 | -1, text: string) => {
      const cur = draft.lines[0] as Line | undefined;
      if (!cur) return;
      const patch = bumpPatch(cur, delta, (kind) => ({
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        kind,
        text,
        at: nowHM(),
      }));
      if (patch) draft.setLine(0, patch as Partial<Line>);
    },
    [draft],
  );

  const handleScan = React.useCallback(
    async (code: string) => {
      const cur = draft.lines[0] as Line | undefined;
      if (!cur || !cur.started || resolving || busy) return;
      setResolving(true);
      try {
        const res = await resolveBarcode(code, purpose);
        if (res.product.id === cur.productId) {
          bump(1, hitTrailText(code));
          beepOk();
          setFeedback({ kind: "match", count: cur.count + 1 });
        } else {
          beepBad();
          setFeedback({ kind: "wrong", productName: res.product.product_name });
        }
      } catch (e) {
        beepBad();
        if (isApiError(e) && e.status === 404) {
          setFeedback({ kind: "unknown", code });
        } else {
          setFeedback({ kind: "error", userMessage: isApiError(e) ? e.userMessage : null });
        }
      } finally {
        setResolving(false);
        requestAnimationFrame(() => scanner.focus());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, resolving, busy, bump, beepOk, beepBad, purpose, hitTrailText],
  );

  const scanner = useScanner({
    onScan: handleScan,
    disabled: !scanning || resolving || busy,
  });

  return { feedback, setFeedback, resolving, bump, handleScan, scanner };
}
