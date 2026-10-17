"use client";

import * as React from "react";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "./translate";

export interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, vars?: MessageVars) => string;
  /**
   * Switch language; resolves to whether the preference cookie was saved. A
   * call superseded by a newer choice before its outcome is known never
   * settles, so callers only ever report the latest choice.
   */
  setLocale: (next: Locale) => Promise<boolean>;
}

const I18nContext = React.createContext<I18nValue | null>(null);

/** Outside a provider (e.g. isolated component tests) components render English. */
const FALLBACK: I18nValue = {
  locale: "en",
  t: (key, vars) => translate(DICTIONARIES.en, key, vars),
  setLocale: async () => false,
};

/**
 * Seeded with the locale the server already rendered (read from the
 * `akk_lang` cookie), so server HTML and the first client render agree and
 * there is no wrong-language flash.
 *
 * Switching is instant and client-side: state and <html lang> update in the
 * same tick, then the choice is persisted by POST /api/prefs/language. It
 * deliberately does NOT call router.refresh(): every string R2 translates is
 * client-rendered, so nothing server-rendered needs re-fetching, and a refresh
 * would only add risk to unfinished work (forms, drafts, open dialogs). The
 * provider sits in the root layout, so it is never remounted by navigation.
 */
export function LanguageProvider({ initialLocale = DEFAULT_LOCALE, children }: { initialLocale?: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  // Preference writes run one at a time, in click order: the tail of the chain
  // and a counter identifying the latest choice.
  const writes = React.useRef<Promise<unknown>>(Promise.resolve());
  const latest = React.useRef(0);

  const setLocale = React.useCallback((next: Locale) => {
    const choice = ++latest.current;
    const isLatest = () => choice === latest.current;
    setLocaleState(next);
    document.documentElement.lang = next;
    // Concurrent POSTs would let an older response land last and leave the
    // cookie on a choice the user already replaced. Chained writes never
    // overlap, and a write whose choice was superseded while it waited is
    // skipped, so the last cookie written is always the latest choice.
    const write = writes.current.then(() => (isLatest() ? persistLocale(next) : false));
    writes.current = write;
    // a superseded outcome is withheld (never settles) rather than reported
    return write.then((saved) => (isLatest() ? saved : new Promise<boolean>(() => {})));
  }, []);

  const value = React.useMemo<I18nValue>(
    () => ({ locale, t: (key, vars) => translate(DICTIONARIES[locale], key, vars), setLocale }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** POST /api/prefs/language; never rejects, so one failure cannot stall later writes. */
async function persistLocale(next: Locale): Promise<boolean> {
  try {
    const res = await fetch("/api/prefs/language", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useI18n(): I18nValue {
  return React.useContext(I18nContext) ?? FALLBACK;
}

export function useT(): I18nValue["t"] {
  return useI18n().t;
}
