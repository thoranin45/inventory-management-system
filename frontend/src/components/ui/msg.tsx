"use client";

import { useT } from "@/lib/i18n/client";
import type { MessageKey, MessageVars } from "@/lib/i18n/translate";

/**
 * A translated message as a client leaf, for components that also render
 * inside Server Components (e.g. `states.tsx`): they stay server-compatible
 * while their default wording follows the language switch.
 */
export function Msg({ k, vars }: { k: MessageKey; vars?: MessageVars }) {
  return <>{useT()(k, vars)}</>;
}
