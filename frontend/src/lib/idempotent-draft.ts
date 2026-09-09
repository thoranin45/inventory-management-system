"use client";

import * as React from "react";

/**
 * Shared idempotent-operation draft (Phase 5 PO receiving generalised for
 * Phase 6 transfer receiving).
 *
 * A draft bundles ONE Idempotency-Key with the per-line values the operator is
 * about to submit. Rules:
 *   - the key is generated ONCE when a draft starts and reused for every retry
 *     of the SAME payload (network error, button re-click, page reload);
 *   - a genuinely new operation gets a NEW key (`startNewDraft`);
 *   - on confirmed success the draft + key are cleared and a fresh one starts;
 *   - the key is never shown to or edited by the operator.
 *
 * The backend replays `same key + same payload` and rejects `same key +
 * different payload` with 409, so `buildPayload` MUST be byte-stable
 * (deterministic line ordering, fixed-scale quantities).
 */
export type DraftLines<Line> = Record<number, Line>;

export interface UseIdempotentDraft<Line, Payload> {
  draftId: string;
  idempotencyKey: string;
  lines: DraftLines<Line>;
  setLine: (id: number, patch: Partial<Line>) => void;
  removeLine: (id: number) => void;
  clearLines: () => void;
  /** deterministic request body (null when nothing is entered) */
  payload: Payload | null;
  /** call after the backend confirms — clears this draft + key, starts a fresh one */
  commitSuccess: () => void;
  /** start a genuinely new operation (new key) keeping the current entries */
  startNewDraft: () => void;
  ready: boolean;
}

export interface IdempotentDraftOptions<Line, Payload> {
  /** e.g. `po-receipt:123` or `transfer-receipt:45` */
  scope: string;
  /** e.g. `po-rcpt-` or `tr-rcpt-` */
  keyPrefix: string;
  buildPayload: (lines: DraftLines<Line>) => Payload | null;
}

const activeKey = (scope: string) => `${scope}:active`;
const draftKey = (scope: string, draftId: string) => `${scope}:${draftId}`;

function ss(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

interface DraftState<Line> {
  draftId: string;
  idempotencyKey: string;
  lines: DraftLines<Line>;
}

function loadOrCreate<Line>(scope: string, keyPrefix: string): DraftState<Line> {
  const store = ss();
  if (store) {
    try {
      const active = store.getItem(activeKey(scope));
      if (active) {
        const raw = store.getItem(draftKey(scope, active));
        if (raw) {
          const parsed = JSON.parse(raw) as { idempotencyKey: string; lines: DraftLines<Line> };
          if (parsed.idempotencyKey) {
            return { draftId: active, idempotencyKey: parsed.idempotencyKey, lines: parsed.lines ?? {} };
          }
        }
      }
    } catch {
      /* corrupt — fall through to a fresh draft */
    }
  }
  const state: DraftState<Line> = { draftId: newId(), idempotencyKey: `${keyPrefix}${newId()}`, lines: {} };
  persist(scope, state);
  return state;
}

function persist<Line>(scope: string, s: DraftState<Line>) {
  const store = ss();
  if (!store) return;
  try {
    store.setItem(activeKey(scope), s.draftId);
    store.setItem(draftKey(scope, s.draftId), JSON.stringify({ idempotencyKey: s.idempotencyKey, lines: s.lines }));
  } catch {
    /* quota / private mode — the in-memory draft still works for this session */
  }
}

const EMPTY_SUBSCRIBE = () => () => {};

export function useIdempotentDraft<Line, Payload>({
  scope,
  keyPrefix,
  buildPayload,
}: IdempotentDraftOptions<Line, Payload>): UseIdempotentDraft<Line, Payload> {
  // `loadOrCreate` reads/writes sessionStorage synchronously in the initializer,
  // so the first *client* render already has the right draft. SSR renders a
  // throwaway draft (no window) that nothing displays — no hydration mismatch.
  const [state, setState] = React.useState<DraftState<Line>>(() => loadOrCreate<Line>(scope, keyPrefix));
  const ready = React.useSyncExternalStore(EMPTY_SUBSCRIBE, () => true, () => false);

  const setLine = React.useCallback(
    (id: number, patch: Partial<Line>) => {
      setState((s) => {
        const next = { ...s, lines: { ...s.lines, [id]: { ...(s.lines[id] as object), ...patch } as Line } };
        persist(scope, next);
        return next;
      });
    },
    [scope],
  );

  const removeLine = React.useCallback(
    (id: number) => {
      setState((s) => {
        const lines = { ...s.lines };
        delete lines[id];
        const next = { ...s, lines };
        persist(scope, next);
        return next;
      });
    },
    [scope],
  );

  const clearLines = React.useCallback(() => {
    setState((s) => {
      const next = { ...s, lines: {} };
      persist(scope, next);
      return next;
    });
  }, [scope]);

  const commitSuccess = React.useCallback(() => {
    setState((s) => {
      const store = ss();
      try {
        store?.removeItem(draftKey(scope, s.draftId));
        store?.removeItem(activeKey(scope));
      } catch {
        /* ignore */
      }
      const next: DraftState<Line> = { draftId: newId(), idempotencyKey: `${keyPrefix}${newId()}`, lines: {} };
      persist(scope, next);
      return next;
    });
  }, [scope, keyPrefix]);

  const startNewDraft = React.useCallback(() => {
    setState((s) => {
      const store = ss();
      try {
        store?.removeItem(draftKey(scope, s.draftId));
      } catch {
        /* ignore */
      }
      const next: DraftState<Line> = { draftId: newId(), idempotencyKey: `${keyPrefix}${newId()}`, lines: s.lines };
      persist(scope, next);
      return next;
    });
  }, [scope, keyPrefix]);

  const payload = React.useMemo(() => buildPayload(state.lines), [state.lines, buildPayload]);

  return {
    draftId: state.draftId,
    idempotencyKey: state.idempotencyKey,
    lines: state.lines,
    setLine,
    removeLine,
    clearLines,
    payload,
    commitSuccess,
    startNewDraft,
    ready,
  };
}
