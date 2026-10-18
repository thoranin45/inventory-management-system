"use client";

import * as React from "react";

import { useT } from "@/lib/i18n/client";
import type { TrailEntry } from "@/lib/workflow/scan-count";

/**
 * A scan trail entry stores the scanned code (an undo stores nothing); the
 * words are rendered in the UI language. Entries saved before R4 stored the
 * English sentence ("barcode X +1", "undo -1"); their code is recovered so a
 * draft restored across the upgrade still reads correctly.
 */
export function trailCode(entry: TrailEntry): string {
  const legacy = /^barcode (.*) \+1$/.exec(entry.text);
  if (legacy) return legacy[1];
  if (entry.kind === "undo") return "";
  return entry.text;
}

/** "This session": the local scan trail of a Stock In / Stock Out session (never an AuditLog). */
export function TrailList({ trail }: { trail: TrailEntry[] }) {
  const t = useT();
  if (!trail.length) return null;
  return (
    <section>
      <h3 className="wc-section-label mb-1">{t("task.thisSession")}</h3>
      <ul className="flex flex-col gap-[2px] text-[12px] text-[var(--muted)]">
        {trail.map((e) => (
          <li key={e.id} className="tabular-nums">
            {e.kind === "hit" ? "✓" : "↶"} {e.at} ·{" "}
            {e.kind === "hit" ? t("task.trailHit", { code: trailCode(e) }) : t("task.trailUndo")}
          </li>
        ))}
      </ul>
    </section>
  );
}
