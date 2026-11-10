"use client";

import * as React from "react";

/** The part of a react-query `mutate` this hook drives (its variables carry the key). */
export type KeyedMutate<Vars extends { idempotencyKey: string }, Data> = (
  vars: Vars,
  options: { onSuccess: (data: Data) => void; onError: (error: unknown) => void },
) => void;

export interface KeyedSubmitHandlers<Data> {
  /** after the draft was consumed (new key, cleared lines) and the mismatch flag reset */
  onSuccess: (data: Data) => void;
  /** every failure; `mismatch` is true when the flag was just raised for it */
  onError: (error: unknown, mismatch: boolean) => void;
}

/**
 * The shared save-once submit step of the keyed workflows, around a draft from
 * `useIdempotentDraft`:
 * - every submit carries the draft's CURRENT Idempotency-Key, so a retry after
 *   any failure (network, 5xx, rejection) replays the same key;
 * - only a confirmed success consumes the draft (`commitSuccess`: new key);
 * - a key mismatch, as recognised by the workflow's own predicate, raises
 *   `mismatch` and changes nothing else: the key is never rotated here. The
 *   component offers the workflow's own recovery and then calls `clearMismatch`.
 *
 * Deliberately NOT here: pending guards and duplicate-submit locks (each
 * component keeps its existing guard), copy, toasts, navigation.
 */
export function useIdempotentSubmission<Vars extends { idempotencyKey: string }, Data>({
  draft,
  mutate,
  isMismatch,
}: {
  draft: { idempotencyKey: string; commitSuccess: () => void };
  mutate: KeyedMutate<Vars, Data>;
  isMismatch: (error: unknown) => boolean;
}) {
  const [mismatch, setMismatch] = React.useState(false);

  /** `vars` without the key: the draft's current key is added here. */
  const submit = (vars: Omit<Vars, "idempotencyKey">, handlers: KeyedSubmitHandlers<Data>) => {
    mutate(
      { ...vars, idempotencyKey: draft.idempotencyKey } as Vars,
      {
        onSuccess: (data) => {
          draft.commitSuccess();
          setMismatch(false);
          handlers.onSuccess(data);
        },
        onError: (error) => {
          const isKeyMismatch = isMismatch(error);
          if (isKeyMismatch) setMismatch(true);
          handlers.onError(error, isKeyMismatch);
        },
      },
    );
  };

  const clearMismatch = React.useCallback(() => setMismatch(false), []);

  return { submit, mismatch, clearMismatch };
}
