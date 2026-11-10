"use client";

import * as React from "react";

import { newId, sessionStore } from "@/lib/idempotent-draft";

/**
 * One Idempotency-Key for a single-shot action on an already-persisted record
 * (e.g. approving adjustment request 42), stored under `storageKey` in
 * sessionStorage — NOT a fresh key per click. A dropped response or a page
 * reload after the action must retry with the SAME key, so an uncertain
 * attempt either replays its stored outcome or safely proceeds, never applies
 * twice. `clear` is for when the key is spent (the action succeeded, or the
 * record was already decided): it forgets the stored key and holds a fresh,
 * unpersisted one in memory.
 */
export function usePersistedIdempotencyKey(storageKey: string, keyPrefix: string): { key: string; clear: () => void } {
  const [key, setKey] = React.useState<string>(() => {
    const store = sessionStore();
    const existing = store?.getItem(storageKey);
    if (existing) return existing;
    const fresh = `${keyPrefix}${newId()}`;
    try {
      store?.setItem(storageKey, fresh);
    } catch {
      /* quota / private mode — the in-memory key still works for this render */
    }
    return fresh;
  });
  const clear = React.useCallback(() => {
    try {
      sessionStore()?.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setKey(`${keyPrefix}${newId()}`);
  }, [storageKey, keyPrefix]);
  return { key, clear };
}
