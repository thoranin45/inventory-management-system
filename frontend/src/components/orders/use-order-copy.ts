"use client";

import { useT } from "@/lib/i18n/client";
import type { MessageVars } from "@/lib/i18n/translate";
import { fieldKey, type KeyedMessage, type VerbatimMessage } from "@/lib/order-copy";
import { useStatusLabel } from "./lifecycle-steps";

/**
 * Renders an order-copy message (lib/order-copy) in the UI language. `field`
 * and status-code variables are translated as well; verbatim messages are
 * shown exactly as the backend sent them.
 */
export function useOrderCopy() {
  const t = useT();
  const statusLabel = useStatusLabel();
  return (message: KeyedMessage | VerbatimMessage): string => {
    if ("verbatim" in message) return message.verbatim;
    const vars: MessageVars = { ...message.vars };
    if (typeof vars.field === "string") {
      const k = fieldKey(vars.field);
      if (k) vars.field = t(k);
    }
    for (const name of ["current", "required"] as const) {
      if (typeof vars[name] === "string") vars[name] = statusLabel(vars[name] as string);
    }
    return t(message.key, vars);
  };
}
