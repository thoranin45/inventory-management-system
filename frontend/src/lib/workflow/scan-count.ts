/** One entry of a scan session's local activity trail (never an AuditLog). */
export interface TrailEntry {
  id: string;
  kind: "hit" | "undo";
  text: string;
  at: string;
}

/** The part of a persisted Stock In / Stock Out session line the scan count owns. */
export interface ScanCountLine {
  productId: number;
  /** local scan tally — NO stock moves until Save */
  count: number;
  /** setup confirmed, scanning has begun */
  started: boolean;
  trail: TrailEntry[];
}

/** How many trail entries a session keeps (newest first). */
export const TRAIL_LIMIT = 12;

/**
 * The draft patch for one counted scan (+1) or one undo (-1). An undo at zero
 * is a no-op (null) and creates no trail entry. Pure: the caller supplies the
 * entry (its id, time and text).
 */
export function bumpPatch(
  cur: Pick<ScanCountLine, "count" | "trail">,
  delta: 1 | -1,
  makeEntry: (kind: TrailEntry["kind"]) => TrailEntry,
): Pick<ScanCountLine, "count" | "trail"> | null {
  if (delta === -1 && cur.count === 0) return null;
  const entry = makeEntry(delta === 1 ? "hit" : "undo");
  return { count: Math.max(0, cur.count + delta), trail: [entry, ...cur.trail].slice(0, TRAIL_LIMIT) };
}
