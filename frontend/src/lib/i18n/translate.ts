import type { Locale } from "./config";
import { en, type Dictionary } from "./dictionaries/en";
import { th } from "./dictionaries/th";

export const DICTIONARIES: Record<Locale, Dictionary> = { en, th };

type Namespace = keyof Dictionary;
/** "namespace.key" for every message, e.g. "nav.stock". */
export type MessageKey = { [N in Namespace]: `${N}.${Extract<keyof Dictionary[N], string>}` }[Namespace];
export type MessageVars = Record<string, string | number>;

/** Look up a message and replace `{name}` placeholders. User text is never translated. */
export function translate(dict: Dictionary, key: MessageKey, vars?: MessageVars): string {
  const [ns, name] = key.split(".") as [Namespace, string];
  const table = dict[ns] as Record<string, string>;
  const template = table[name] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, placeholder: string) =>
    placeholder in vars ? String(vars[placeholder]) : match,
  );
}
