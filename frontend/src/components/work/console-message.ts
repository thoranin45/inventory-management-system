import { DICTIONARIES, translate, type MessageKey } from "@/lib/i18n/translate";

/**
 * R5 (D-R5-10) — a console message stored as a dictionary key plus variables
 * and rendered in the UI language at display time, so a language switch
 * re-renders scan feedback and line activity instead of freezing them in the
 * language they were recorded in. A variable may itself be a key (e.g. the
 * "Item" fallback); `verbatim` carries backend copy that is shown as-is.
 */
export type MessageVar = string | number | { k: MessageKey };
export interface ConsoleMessage {
  key?: MessageKey;
  vars?: Record<string, MessageVar>;
  verbatim?: string;
  /** backend request id, appended as "· Request {id}" */
  rid?: string;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function renderConsoleMessage(m: ConsoleMessage, t: Translate): string {
  const vars: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(m.vars ?? {})) vars[name] = typeof v === "object" ? t(v.k) : v;
  const base = m.verbatim ?? (m.key ? t(m.key, vars) : "");
  return m.rid ? `${base} · ${t("task.requestRef", { id: m.rid })}` : base;
}

/** the canonical English text — what the scan machine records (unchanged from before R5) */
export function englishConsoleMessage(m: ConsoleMessage): string {
  return renderConsoleMessage(m, (key, vars) => translate(DICTIONARIES.en, key, vars));
}
