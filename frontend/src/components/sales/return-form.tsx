"use client";

import * as React from "react";
import { toast } from "sonner";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { Banner } from "@/components/ui/states";
import { errorResponseSchema, isApiError } from "@/lib/api/errors";
import { compareDecimals, subtractDecimals, sumDecimals } from "@/lib/decimal";
import { newId, useIdempotentDraft } from "@/lib/idempotent-draft";
import { useReturnSalesOrder, useSalesOrder } from "@/lib/query/sales";
import { useProductLookup } from "@/lib/query/sales";
import {
  classifyReturnRefusal,
  confirmsReturnIntent,
  salesReturnLineInput,
  salesReturnResultSchema,
  shipErrorCopy,
  type ReturnRefusal,
  type SalesReturnItemResult,
  type SalesReturnLineInput,
  type SalesReturnResult,
} from "@/lib/api/schemas/sales";
import {
  clearReturnedLines,
  isReturnKeyConflict,
  mergeReturnedTotals,
  returnTotal,
  validateReturnLines,
  type ReturnLineDraft,
} from "@/lib/workflow/return-submission";

// The draft hook is used only for its persisted per-intent Idempotency-Key (the
// NEXT key); the drawer keeps its own line state, so there is no draft payload.
const noDraftPayload = () => null;

const inputCls =
  "min-h-11 w-28 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] read-only:bg-[var(--surface-sunken)] read-only:text-[var(--muted)]";

/** The drawer's running total; "—" while any entered quantity is not yet a number. */
function ReturningTotal({ total }: { total: string | null }) {
  return total !== null ? (
    <QuantityDisplay value={total} className="font-semibold text-[var(--foreground)]" />
  ) : (
    <span className="font-semibold text-[var(--foreground)]">—</span>
  );
}

type LineDraft = ReturnLineDraft;

/* ---------------------------------------------------------------------------
 * V1-H1 / P0-A5 pending intent: fail-closed recovery of a return whose outcome
 * is unknown (lost response, timeout, 5xx, reload, closed drawer).
 *
 * One sessionStorage record per order, `sales-return:<salesOrderId>`:
 *   { version: 1, salesOrderId, usedKeys: [every key sent for this order from this tab],
 *     pending: { actor, idempotencyKey, payload: { items }, createdAt } | null }
 * `pending` is written and read back BEFORE the request leaves; Retry only ever
 * sends that exact key and payload, and the backend replays a recorded one.
 * A pending intent is released ONLY by a 2xx that answers it, or by one of the
 * four backend refusals that prove nothing was recorded — never by a retry
 * count, a refreshed order, closing the drawer or reloading. It belongs to the
 * user who sent it: another user can't replay or clear it. Anything that can't
 * be proven safe blocks new returns instead of guessing.
 * ------------------------------------------------------------------------- */
const INTENT_VERSION = 1;
const KEY_RE = /^so-ret-[A-Za-z0-9._:-]{1,121}$/; // backend accepts [A-Za-z0-9._:-], at most 128

interface PendingIntent {
  /** the signed-in user who sent it (null: rendered without a session) */
  actor: number | null;
  idempotencyKey: string;
  /** the exact request body that was sent, and that Retry resends */
  payload: { items: SalesReturnLineInput[] };
  /** ISO time the intent was first sent */
  createdAt: string;
}

interface IntentRecord {
  version: typeof INTENT_VERSION;
  salesOrderId: number;
  /** every Idempotency-Key sent for this order from this tab: never reused */
  usedKeys: string[];
  /** the return whose outcome is not known yet, or null */
  pending: PendingIntent | null;
}

type StoredIntent =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "invalid" }
  | { kind: "valid"; raw: string; record: IntentRecord };

const intentKey = (id: number) => `sales-return:${id}`;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const hasExactKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).sort().join("|") === [...keys].sort().join("|");

/** Strict: only a record this drawer could have written is accepted, and nothing is repaired. */
function parseIntent(raw: string, salesOrderId: number): IntentRecord | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v) || !hasExactKeys(v, ["version", "salesOrderId", "usedKeys", "pending"])) return null;
  if (v.version !== INTENT_VERSION || v.salesOrderId !== salesOrderId) return null;
  const usedKeys = v.usedKeys;
  if (!Array.isArray(usedKeys) || !usedKeys.every((k): k is string => typeof k === "string" && KEY_RE.test(k))) return null;
  if (new Set(usedKeys).size !== usedKeys.length) return null;
  if (v.pending === null) return { version: INTENT_VERSION, salesOrderId, usedKeys, pending: null };
  const p = v.pending;
  if (!isObject(p) || !hasExactKeys(p, ["actor", "idempotencyKey", "payload", "createdAt"])) return null;
  const actor = p.actor;
  if (actor !== null && !(typeof actor === "number" && Number.isSafeInteger(actor))) return null;
  if (typeof p.idempotencyKey !== "string" || !usedKeys.includes(p.idempotencyKey)) return null;
  if (typeof p.createdAt !== "string" || Number.isNaN(Date.parse(p.createdAt))) return null;
  const payload = p.payload;
  if (!isObject(payload) || !hasExactKeys(payload, ["items"]) || !Array.isArray(payload.items)) return null;
  if (payload.items.length === 0) return null;
  const items: SalesReturnLineInput[] = [];
  for (const item of payload.items) {
    const parsed = salesReturnLineInput.safeParse(item);
    // a fixed point of the request schema: exactly what this drawer sends
    if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(item)) return null;
    // product ids unique and ascending
    if (items.length > 0 && parsed.data.product_id <= items[items.length - 1].product_id) return null;
    items.push(parsed.data);
  }
  return {
    version: INTENT_VERSION,
    salesOrderId,
    usedKeys,
    pending: { actor, idempotencyKey: p.idempotencyKey, payload: { items }, createdAt: p.createdAt },
  };
}

function readIntent(id: number): StoredIntent {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(intentKey(id));
  } catch {
    return { kind: "unreadable" };
  }
  if (raw === null) return { kind: "absent" };
  const record = parseIntent(raw, id);
  return record ? { kind: "valid", raw, record } : { kind: "invalid" };
}

/** Write, read back and remove a throwaway value: can this tab keep a recovery copy right now? */
function probeStorage(id: number): boolean {
  const key = `${intentKey(id)}:probe`;
  try {
    const store = window.sessionStorage;
    const value = newId();
    store.setItem(key, value);
    const readBack = store.getItem(key) === value;
    store.removeItem(key);
    return readBack && store.getItem(key) === null;
  } catch {
    return false;
  }
}

/**
 * Write the record and read it back. setItem replaces atomically, so after
 * "write_failed" the previous record is intact; after "verify_failed" what is
 * stored is unknown. On success, returns the record exactly as stored.
 */
function writeIntent(id: number, record: IntentRecord): IntentRecord | "write_failed" | "verify_failed" {
  const raw = JSON.stringify(record);
  let store: Storage;
  try {
    store = window.sessionStorage;
    store.setItem(intentKey(id), raw);
  } catch {
    return "write_failed";
  }
  try {
    if (store.getItem(intentKey(id)) !== raw) return "verify_failed";
  } catch {
    return "verify_failed";
  }
  return parseIntent(raw, id) ?? "verify_failed";
}

/** Best effort after an unverified admission write: nothing was sent, so put back what was there. */
function restoreIntent(id: number, previous: StoredIntent) {
  try {
    if (previous.kind === "absent") window.sessionStorage.removeItem(intentKey(id));
    else if (previous.kind === "valid") window.sessionStorage.setItem(intentKey(id), previous.raw);
  } catch {
    /* storage is failing; the drawer is already blocked */
  }
}

const samePending = (a: PendingIntent, b: PendingIntent) =>
  a.actor === b.actor &&
  a.idempotencyKey === b.idempotencyKey &&
  a.createdAt === b.createdAt &&
  JSON.stringify(a.payload) === JSON.stringify(b.payload);

/** The backend's own message, only when it arrived in the backend's error envelope. */
function backendMessage(error: unknown): string | undefined {
  if (!isApiError(error)) return undefined;
  const envelope = errorResponseSchema.safeParse(error.body);
  return envelope.success && envelope.data.message === error.message ? error.message : undefined;
}

/**
 * A terminal refusal (status + complete backend message, see
 * `classifyReturnRefusal`) that is also consistent with the intent that was
 * sent; otherwise null and the outcome stays unknown.
 */
function provenRefusal(error: unknown, pending: PendingIntent): ReturnRefusal | null {
  const message = backendMessage(error);
  if (message === undefined || !isApiError(error)) return null;
  const refusal = classifyReturnRefusal(error.status, message);
  if (!refusal) return null;
  const items = pending.payload.items;
  if (refusal.kind === "product_not_in_order") {
    return items.some((i) => i.product_id === refusal.productId) ? refusal : null;
  }
  if (refusal.kind === "over_remaining") {
    const line = items.find((i) => i.product_id === refusal.productId);
    return line && compareDecimals(line.quantity, refusal.remaining) > 0 ? refusal : null;
  }
  return refusal;
}

type BlockedReason =
  | "storage_unreadable"
  | "storage_unwritable"
  | "storage_write_failed"
  | "cleanup_failed_recorded"
  | "cleanup_failed_refused";

type Phase =
  | { kind: "editing" }
  | { kind: "sending"; pending: PendingIntent }
  | {
      kind: "unknown";
      pending: PendingIntent;
      reason: "restored" | "failed" | "mismatch" | "conflict";
      message?: string;
      requestId?: string;
    }
  /** another user's pending intent: can't be replayed or cleared here */
  | { kind: "foreign"; pending: PendingIntent }
  /** a stored intent that can't be trusted */
  | { kind: "corrupt" }
  | { kind: "blocked"; reason: BlockedReason };

type Outcome = { ok: true; data: SalesReturnResult } | { ok: false; error: unknown };

/** The first phase of a freshly mounted drawer, from what this tab has stored. */
function phaseAtMount(id: number, actor: number | null): Phase {
  const stored = readIntent(id);
  if (stored.kind === "unreadable") return { kind: "blocked", reason: "storage_unreadable" };
  if (stored.kind === "invalid") return { kind: "corrupt" };
  const pending = stored.kind === "valid" ? stored.record.pending : null;
  if (pending) {
    return pending.actor === actor ? { kind: "unknown", pending, reason: "restored" } : { kind: "foreign", pending };
  }
  return probeStorage(id) ? { kind: "editing" } : { kind: "blocked", reason: "storage_unwritable" };
}

/**
 * The signed-in user's id, bound into every pending intent. In the app the
 * drawer always renders inside the (app) layout's SessionProvider; rendered
 * without one (an isolated component) there is no signed-in user, which is
 * its own identity, `null`: a record written without a session is never
 * replayed by a signed-in user, nor theirs without one. useSession reads its
 * context unconditionally before it throws, so the hook order never changes.
 */
function useActorId(): number | null {
  try {
    return useSession().user.id;
  } catch {
    return null;
  }
}

/**
 * Requests in flight, per order, for one mounted ReturnDrawer: a synchronous
 * guard (React state can be a render behind a double click). It lives beside
 * the mutation observer in ReturnDrawer, outside the drawer body, so closing
 * and reopening the drawer (a remount of the body) neither drops a request's
 * callbacks nor frees the guard while that request is still out.
 */
interface InFlight {
  has: (id: number) => boolean;
  /** false when a request for this order is already out */
  acquire: (id: number) => boolean;
  release: (id: number) => void;
  subscribe: (listener: () => void) => () => void;
}

function createInFlight(): InFlight {
  const busy = new Set<number>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    has: (id) => busy.has(id),
    acquire: (id) => {
      if (busy.has(id)) return false;
      busy.add(id);
      emit();
      return true;
    },
    release: (id) => {
      if (busy.delete(id)) emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type ReturnMutation = Pick<ReturnType<typeof useReturnSalesOrder>, "mutate" | "isPending">;

const ledgerCheck = (so: string) => `Check SALES_RETURN movements for ${so} in Inventory › Ledger before recording anything else.`;
const conflictCheck = (so: string) =>
  `Check the stock ledger (SALES_RETURN movements for ${so} in Inventory › Ledger) and the sales order to see whether the return was recorded.`;

const COPY = {
  sending: "Submitting this return…",
  stillOut: "A request for this return is still in progress. Retry unlocks when it settles.",
  retryExplains:
    "Retry sends exactly the same return with the same request key: if it was already recorded, it won't add stock twice. Editing and new returns stay blocked until the backend confirms or refuses it.",
  unknownTitle: "Outcome unknown — this return may or may not be recorded",
  restoredTitle: "Outcome unknown — a return from this tab hasn't been confirmed",
  mismatchTitle: "Outcome unknown — the server's reply didn't match this return",
  mismatchBody: "It isn't marked as recorded.",
  conflictTitle: "Failed — request key conflict (outcome unknown)",
  // A key conflict is the server's settled answer for this key and payload: Retry (D4) stays
  // available but does not change it, so the copy must not promise that it resolves anything.
  conflictWhy: "This request key was already used for a return with different quantities, so a return may already be recorded.",
  conflictRetry: "Retry resends exactly this return with the same request key. It can't add stock twice, but it won't change the server's answer.",
  conflictReset:
    "Closing this browser tab is the only way to reset: until then the request key is kept and new returns for this order stay blocked here.",
  noResponse: "No response was received: the connection failed or the request was interrupted.",
  foreignTitle: "Outcome unknown — submitted by another user",
  foreignBody:
    "A return for this order was submitted in this browser tab by a different signed-in user and hasn't been confirmed. Only that user can retry it, and it isn't cleared here. New returns for this order are blocked.",
  corruptTitle: "Outcome unknown — an earlier return couldn't be restored",
  corruptBody:
    "A return submitted earlier in this tab couldn't be restored safely, so it may or may not have been recorded. New returns for this order are blocked here.",
  storageTitle: "Returns blocked — this browser can't keep a recovery copy",
  storageBody:
    "Session storage is off, full or blocked, so a return whose outcome became unknown couldn't be recovered safely. Nothing was sent. Use a normal window with site storage allowed, then reload.",
  storageUnreadableBody:
    "Session storage can't be read, so this tab can't tell whether an earlier return is unconfirmed. Nothing was sent. Use a normal window with site storage allowed, then reload.",
  cleanupTitle: "New returns paused — this browser couldn't update its recovery copy",
  cleanupRecorded: "The return was recorded. Reload to clear the recovery copy: the return is checked again without adding stock twice.",
  cleanupRefused: "The backend refused this return, so nothing was recorded. Reload to clear the recovery copy.",
  freshKey: "This return needed a fresh request key. Nothing was sent — press Record return again.",
};

function ReturnBody({
  id,
  ret,
  inFlight,
  onClose,
}: {
  id: number;
  ret: ReturnMutation;
  inFlight: InFlight;
  onClose: () => void;
}) {
  const detailQ = useSalesOrder(id);
  const detail = detailQ.data;
  const actor = useActorId();
  // V1-H1: one Idempotency-Key per return intent. The hook supplies the NEXT key;
  // the pending intent records what was actually sent, and Retry only sends that.
  const draft = useIdempotentDraft<never, null>({
    scope: `sales-return:${id}`,
    keyPrefix: "so-ret-",
    buildPayload: noDraftPayload,
  });
  const { commitSuccess, startNewDraft } = draft;
  // Read the stored intent once per mount (ReturnBody is keyed by order), with
  // the same synchronous-initializer pattern as the draft hook.
  const [phase, setPhase] = React.useState<Phase>(() => phaseAtMount(id, actor));
  const busy = React.useSyncExternalStore(inFlight.subscribe, () => inFlight.has(id), () => false);
  // an outcome is applied only by the mounted body that sent it, for its latest attempt
  const aliveRef = React.useRef(false);
  const attemptRef = React.useRef(0);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const productIds = React.useMemo(() => (detail?.items ?? []).map((it) => it.product_id), [detail]);
  const lookup = useProductLookup(productIds);
  const name = (pid: number) => lookup.data?.[pid]?.product_name ?? `Product #${pid}`;
  const sku = (pid: number) => lookup.data?.[pid]?.sku ?? "";
  const soLabel = detail?.so_number ?? "this order";

  // session-local: how much the backend has told us is already returned per product
  const [alreadyReturned, setAlreadyReturned] = React.useState<Record<number, string>>({});
  const [lines, setLines] = React.useState<Record<number, LineDraft>>({});
  const [formError, setFormError] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [results, setResults] = React.useState<SalesReturnItemResult[] | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // seed a draft row per order item once the detail loads (adjust-during-render)
  const [seededFor, setSeededFor] = React.useState<number | null>(null);
  if (detail && seededFor !== detail.id) {
    setSeededFor(detail.id);
    const init: Record<number, LineDraft> = {};
    for (const it of detail.items) {
      init[it.product_id] = { product_id: it.product_id, ordered: String(it.quantity), quantity: "", reason: "" };
    }
    setLines(init);
  }

  // A stored intent whose products aren't all on this order can't be trusted.
  const offOrder = (p: PendingIntent) => detail !== undefined && p.payload.items.some((i) => !productIds.includes(i.product_id));
  const view: Phase =
    (phase.kind === "sending" || phase.kind === "unknown" || phase.kind === "foreign") && offOrder(phase.pending)
      ? { kind: "corrupt" }
      : phase;

  // clears the line error on edit; an explicit `error` in the patch wins.
  const setLine = (pid: number, patch: Partial<LineDraft>) =>
    setLines((s) => ({ ...s, [pid]: { ...s[pid], error: undefined, ...patch } }));

  const remainingReturnable = (pid: number, ordered: string) => {
    const already = alreadyReturned[pid] ?? "0";
    return subtractDecimals(ordered, already, 3);
  };

  const activeLines = Object.values(lines).filter((l) => l.quantity.trim() !== "");
  // While an intent is out or unresolved, the inputs show exactly what was sent (read-only).
  const intentItems =
    view.kind === "sending" || view.kind === "unknown" || view.kind === "foreign" ? view.pending.payload.items : null;
  const locked = view.kind !== "editing";
  // A quantity still being typed ("1.") or invalid ("abc") is not a number: the
  // total is unknown (shown as "—"), never computed (that threw during render)
  // and never counted as zero. Submit still validates every line.
  const total = intentItems ? sumDecimals(intentItems.map((i) => i.quantity), 3) : returnTotal(activeLines);

  const showRecorded = (data: SalesReturnResult) => {
    setResults(data.returned_items);
    setAlreadyReturned((s) => mergeReturnedTotals(s, data.returned_items));
    // clear the quantities we just submitted, keep the rows for further returns
    setLines((s) => clearReturnedLines(s, data.returned_items));
    toast.success("Return recorded", { description: `${data.returned_items.length} line${data.returned_items.length === 1 ? "" : "s"} returned to stock` });
  };

  /** Release the intent with a verified write (pending → null); only then rotate the key and allow a new return. */
  const finish = (
    resolution:
      | { kind: "recorded"; pending: PendingIntent; data: SalesReturnResult }
      | { kind: "refused"; pending: PendingIntent; message: string; requestId?: string },
  ) => {
    const current = readIntent(id);
    const cleared =
      current.kind === "valid" && current.record.pending && samePending(current.record.pending, resolution.pending)
        ? writeIntent(id, { version: INTENT_VERSION, salesOrderId: id, usedKeys: current.record.usedKeys, pending: null })
        : "write_failed";
    if (typeof cleared === "string") {
      // the intent stays stored: a reload re-checks it, never twice
      if (resolution.kind === "recorded") showRecorded(resolution.data);
      setPhase({ kind: "blocked", reason: resolution.kind === "recorded" ? "cleanup_failed_recorded" : "cleanup_failed_refused" });
      return;
    }
    if (resolution.kind === "recorded") {
      commitSuccess();
      showRecorded(resolution.data);
    } else {
      startNewDraft();
      // the lines come back exactly as sent, editable, with the backend's reason
      const sent = resolution.pending.payload.items;
      setLines((s) => {
        const next = { ...s };
        for (const i of sent) {
          if (next[i.product_id]) next[i.product_id] = { ...next[i.product_id], quantity: i.quantity, reason: i.reason ?? "", error: undefined };
        }
        return next;
      });
      setFormError({ message: resolution.message, requestId: resolution.requestId });
    }
    setPhase({ kind: "editing" });
  };

  const settle = (pending: PendingIntent, outcome: Outcome) => {
    if (outcome.ok) {
      const shown = salesReturnResultSchema.safeParse(outcome.data);
      if (shown.success && confirmsReturnIntent(outcome.data, id, pending.payload.items)) {
        finish({ kind: "recorded", pending, data: shown.data });
      } else {
        setPhase({ kind: "unknown", pending, reason: "mismatch" });
      }
      return;
    }
    const { error } = outcome;
    const message = isApiError(error) ? (shipErrorCopy(error.message) ?? error.userMessage) : COPY.noResponse;
    const requestId = isApiError(error) ? error.requestId : undefined;
    if (provenRefusal(error, pending)) {
      finish({ kind: "refused", pending, message, requestId });
      return;
    }
    // RETURN_KEY_CONFLICT and every other failure: keep the intent and its key
    setPhase({ kind: "unknown", pending, reason: isReturnKeyConflict(error) ? "conflict" : "failed", message, requestId });
  };

  const send = (pending: PendingIntent) => {
    if (!inFlight.acquire(id)) return; // a request for this order is already out
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setPhase({ kind: "sending", pending });
    const settleOnce = (outcome: Outcome) => {
      inFlight.release(id);
      // A stale outcome (closed drawer, newer attempt) is dropped: the intent
      // stays stored, and a later Retry resolves it by replay.
      if (!aliveRef.current || attemptRef.current !== attempt) return;
      settle(pending, outcome);
    };
    try {
      ret.mutate(
        { id, input: pending.payload, idempotencyKey: pending.idempotencyKey },
        {
          onSuccess: (data) => settleOnce({ ok: true, data }),
          onError: (error) => settleOnce({ ok: false, error }),
        },
      );
    } catch (error) {
      settleOnce({ ok: false, error });
    }
  };

  const submit = () => {
    // React state can be a render behind a double click; the in-flight guard is not.
    if (view.kind !== "editing" || inFlight.has(id) || ret.isPending || !draft.ready) return;
    setFormError(null);
    setNotice(null);
    if (activeLines.length === 0) {
      setFormError({ message: "Enter a quantity on at least one line." });
      return;
    }
    const checked = validateReturnLines(activeLines, (l) => remainingReturnable(l.product_id, l.ordered));
    if (!checked.ok) {
      for (const [pid, problem] of Object.entries(checked.problems)) {
        setLine(Number(pid), {
          error:
            problem.kind === "invalid"
              ? problem.message
              : `Can't exceed ${problem.ceiling} (ordered minus already returned)`,
        });
      }
      return;
    }
    const items = [...checked.items].sort((a, b) => a.product_id - b.product_id);

    // Fail closed: a request leaves only after its exact key and payload are stored and read back.
    if (!probeStorage(id)) {
      setPhase({ kind: "blocked", reason: "storage_write_failed" });
      return;
    }
    const current = readIntent(id);
    if (current.kind === "unreadable") {
      setPhase({ kind: "blocked", reason: "storage_unreadable" });
      return;
    }
    if (current.kind === "invalid") {
      setPhase({ kind: "corrupt" });
      return;
    }
    const existing = current.kind === "valid" ? current.record : null;
    if (existing?.pending) {
      // an unconfirmed return for this order already exists: it is resolved first
      const p = existing.pending;
      setPhase(p.actor === actor ? { kind: "unknown", pending: p, reason: "restored" } : { kind: "foreign", pending: p });
      return;
    }
    const usedKeys = existing?.usedKeys ?? [];
    const key = draft.idempotencyKey;
    if (!KEY_RE.test(key) || usedKeys.includes(key)) {
      startNewDraft(); // a key that may already have been sent is never reused
      setNotice(COPY.freshKey);
      return;
    }
    const written = writeIntent(id, {
      version: INTENT_VERSION,
      salesOrderId: id,
      usedKeys: [...usedKeys, key],
      pending: { actor, idempotencyKey: key, payload: { items }, createdAt: new Date().toISOString() },
    });
    if (typeof written === "string" || !written.pending) {
      // Nothing was sent. An unverified write may have left this intent behind: put back what was there.
      if (written === "verify_failed") restoreIntent(id, current);
      setPhase({ kind: "blocked", reason: "storage_write_failed" });
      return;
    }
    send(written.pending); // exactly what is stored
  };

  const retry = () => {
    if (view.kind !== "unknown" || inFlight.has(id) || ret.isPending) return;
    const { pending } = view;
    const current = readIntent(id);
    if (current.kind === "unreadable") {
      setPhase({ kind: "blocked", reason: "storage_unreadable" });
      return;
    }
    if (current.kind !== "valid" || !current.record.pending || !samePending(current.record.pending, pending)) {
      setPhase({ kind: "corrupt" }); // what is stored no longer matches what Retry would send: don't guess
      return;
    }
    if (pending.actor !== actor) {
      setPhase({ kind: "foreign", pending });
      return;
    }
    setFormError(null);
    setNotice(null);
    send(pending);
  };

  if (detailQ.isLoading) return <p className="py-6 text-[13px] text-[var(--muted)]">Loading order lines…</p>;
  if (detailQ.isError || !detail) return <p className="py-6 text-[13px] text-[var(--danger)]">Could not load the order.</p>;

  const sending = view.kind === "sending" || busy || ret.isPending;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-[var(--muted)]">
        Returns restore stock to the original allocation — the backend picks the batch, you don&apos;t. A return is a
        stock and audit event; it does <strong>not</strong> change the order status or process a refund.
      </p>

      <div className="flex flex-col gap-3">
        {detail.items.map((it) => {
          const l = lines[it.product_id];
          if (!l) return null;
          const sent = intentItems?.find((i) => i.product_id === it.product_id);
          const quantity = intentItems ? (sent?.quantity ?? "") : l.quantity;
          const reason = intentItems ? (sent?.reason ?? "") : l.reason;
          const already = alreadyReturned[it.product_id];
          const ceiling = remainingReturnable(it.product_id, l.ordered);
          const afterThis = quantity.trim() ? subtractDecimals(ceiling, quantity.trim(), 3) : ceiling;
          return (
            <div key={it.id} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="mb-2">
                <div className="text-[13px] font-medium">{name(it.product_id)}</div>
                <div className="mono text-[11px] text-[var(--faint)]">{sku(it.product_id)}</div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
                <span>Ordered <QuantityDisplay value={l.ordered} className="font-medium text-[var(--foreground)]" /></span>
                <span>Shipped <QuantityDisplay value={l.ordered} className="font-medium text-[var(--foreground)]" /></span>
                <span>
                  Already returned{" "}
                  {already !== undefined ? (
                    <QuantityDisplay value={already} className="font-medium text-[var(--foreground)]" />
                  ) : (
                    <span className="text-[var(--faint)]" title="Not exposed by GET /sales-orders/{id}; the backend enforces the true total">unknown until you submit</span>
                  )}
                </span>
                <span>Remaining returnable <QuantityDisplay value={afterThis} className="font-medium text-[var(--foreground)]" /></span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--muted)]">Return now</span>
                  <input
                    aria-label={`Return quantity for ${name(it.product_id)}`}
                    inputMode="decimal"
                    className={inputCls}
                    placeholder="0.000"
                    readOnly={locked}
                    value={quantity}
                    onChange={(e) => {
                      if (!locked) setLine(it.product_id, { quantity: e.currentTarget.value });
                    }}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--muted)]">Reason (optional)</span>
                  <input
                    aria-label={`Return reason for ${name(it.product_id)}`}
                    className={`${inputCls} w-full`}
                    maxLength={255}
                    readOnly={locked}
                    value={reason}
                    onChange={(e) => {
                      if (!locked) setLine(it.product_id, { reason: e.currentTarget.value });
                    }}
                  />
                </label>
              </div>
              {l.error && !locked ? <p className="mt-1 text-[11px] text-[var(--danger)]">{l.error}</p> : null}
            </div>
          );
        })}
      </div>

      {view.kind === "sending" ? <Banner tone="info" title={COPY.sending} /> : null}

      {view.kind === "unknown" ? (
        <Banner
          tone={view.reason === "conflict" ? "danger" : "warning"}
          title={
            view.reason === "restored"
              ? COPY.restoredTitle
              : view.reason === "mismatch"
                ? COPY.mismatchTitle
                : view.reason === "conflict"
                  ? COPY.conflictTitle
                  : COPY.unknownTitle
          }
        >
          <div className="flex flex-col gap-1 text-[12px]">
            {view.reason === "mismatch" ? <p>{COPY.mismatchBody}</p> : null}
            {/* a conflict's message is always the mapped key-conflict copy: its dedicated copy replaces it */}
            {view.reason === "conflict" ? <p>{COPY.conflictWhy}</p> : view.message ? <p>{view.message}</p> : null}
            {view.requestId ? (
              <span className="block text-[11px] text-[var(--muted)]">
                Request ID: <span className="mono select-all">{view.requestId}</span>
              </span>
            ) : null}
            {view.reason === "conflict" ? (
              <>
                <p>{COPY.conflictRetry}</p>
                <p>{conflictCheck(soLabel)}</p>
                <p>{COPY.conflictReset}</p>
              </>
            ) : (
              <p>{COPY.retryExplains}</p>
            )}
            {busy || ret.isPending ? <p className="text-[var(--muted)]">{COPY.stillOut}</p> : null}
            {view.reason !== "conflict" ? <p className="text-[var(--muted)]">{ledgerCheck(soLabel)}</p> : null}
          </div>
        </Banner>
      ) : null}

      {view.kind === "foreign" ? (
        <Banner tone="danger" title={COPY.foreignTitle}>
          <p className="text-[12px]">
            {COPY.foreignBody} {ledgerCheck(soLabel)}
          </p>
        </Banner>
      ) : null}

      {view.kind === "corrupt" ? (
        <Banner tone="danger" title={COPY.corruptTitle}>
          <p className="text-[12px]">
            {COPY.corruptBody} {ledgerCheck(soLabel)}
          </p>
        </Banner>
      ) : null}

      {view.kind === "blocked" ? (
        <Banner
          tone="danger"
          title={view.reason === "cleanup_failed_recorded" || view.reason === "cleanup_failed_refused" ? COPY.cleanupTitle : COPY.storageTitle}
        >
          <p className="text-[12px]">
            {view.reason === "cleanup_failed_recorded"
              ? COPY.cleanupRecorded
              : view.reason === "cleanup_failed_refused"
                ? COPY.cleanupRefused
                : view.reason === "storage_unreadable"
                  ? COPY.storageUnreadableBody
                  : COPY.storageBody}
          </p>
        </Banner>
      ) : null}

      {results ? (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-subtle)] p-2 text-[11.5px] text-[var(--foreground)]">
          <div className="mb-1 font-semibold text-[var(--success)]">Recorded by the backend</div>
          {results.map((r) => (
            <div key={r.product_id} className="mono">
              {name(r.product_id)}: returned <QuantityDisplay value={r.returned_quantity} /> · total returned{" "}
              <QuantityDisplay value={r.total_returned} /> · remaining <QuantityDisplay value={r.remaining_returnable} />
            </div>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-[var(--r-sm)] bg-[var(--surface-sunken)] p-2 text-[12px] text-[var(--foreground)]">
          {notice}
        </p>
      ) : null}

      {formError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              Request ID: <span className="mono select-all">{formError.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <span className="text-[12px] text-[var(--muted)]">
          Returning <ReturningTotal total={total} />
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {/* distinct keys: a double click can't land on a reused button that now means "retry" */}
          {view.kind === "unknown" ? (
            <Button key="retry" variant="primary" onClick={retry} disabled={busy || ret.isPending}>
              {busy || ret.isPending ? "Submitting…" : "Retry: Record return"}
            </Button>
          ) : (
            <Button
              key="record"
              variant="primary"
              onClick={submit}
              disabled={view.kind !== "editing" || sending || !draft.ready || activeLines.length === 0}
            >
              {sending ? "Submitting…" : "Record return"}
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

export function ReturnDrawer({
  id,
  soNumber,
  open,
  onOpenChange,
}: {
  id: number | null;
  soNumber: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  // The mutation observer and the in-flight guard live here, outside the drawer
  // body: closing and reopening the drawer remounts the body, but a request
  // still out keeps its callbacks and keeps blocking a second send.
  const ret = useReturnSalesOrder();
  const [inFlight] = React.useState(createInFlight);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={`Return items — ${soNumber ?? "sales order"}`}>
        {/* keyed by order: the draft hook and the stored intent are read once per mount */}
        {open && id != null ? (
          <ReturnBody key={id} id={id} ret={ret} inFlight={inFlight} onClose={() => onOpenChange(false)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
