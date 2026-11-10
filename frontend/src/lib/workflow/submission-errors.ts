import { isApiError } from "@/lib/api/errors";

/**
 * Idempotency-Key mismatch detection for the keyed save-once workflows.
 *
 * The backend answers "same key, different body" with this message. The
 * workflows have always recognised it in two DIFFERENT ways, and each keeps its
 * own rule (decision D-R3-2: never unify them without a backend message audit):
 * - isLooseKeyMismatch: Stock In, Stock Out, adjustment requests;
 * - isExactKeyMismatch: PO receiving, transfer receiving.
 * (Sales Return keeps its own 409 + exact RETURN_KEY_CONFLICT check.)
 *
 * A mismatch never mints a new key on its own: the operator decides.
 */
export const KEY_MISMATCH_MESSAGE = "Idempotency-Key already used with a different payload";

/** HTTP 409 whose message contains "different payload" (any case). */
export function isLooseKeyMismatch(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && /different payload/i.test(error.message);
}

/** The exact backend message, whatever the HTTP status. */
export function isExactKeyMismatch(error: unknown): boolean {
  return isApiError(error) && error.message === KEY_MISMATCH_MESSAGE;
}

/** The backend request id of an ApiError, for "· Request <id>" copy. */
export function requestIdOf(error: unknown): string | undefined {
  return isApiError(error) ? error.requestId : undefined;
}
