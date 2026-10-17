"use client";

import * as React from "react";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "./translate";

/**
 * How a language choice ended, as far as this page can tell:
 * - `saved`: the preference cookie was written;
 * - `failed`: not confirmed: the request failed, was rejected, or took
 *   longer than LOCALE_SAVE_TIMEOUT_MS (it may still complete later);
 * - `superseded`: a newer choice replaced this one before its outcome was
 *   known; callers should stay silent and let the newer choice report.
 */
export type LocaleSaveOutcome = "saved" | "failed" | "superseded";

/** How long a choice waits for confirmation before it is reported as not saved. */
export const LOCALE_SAVE_TIMEOUT_MS = 10_000;

export interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, vars?: MessageVars) => string;
  /** Switch language now and persist the choice; always settles (see LocaleSaveOutcome). */
  setLocale: (next: Locale) => Promise<LocaleSaveOutcome>;
}

const I18nContext = React.createContext<I18nValue | null>(null);

/** Outside a provider (e.g. isolated component tests) components render English. */
const FALLBACK: I18nValue = {
  locale: "en",
  t: (key, vars) => translate(DICTIONARIES.en, key, vars),
  setLocale: async () => "failed",
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
  // Preference writes run one at a time, in click order: the tail of the chain,
  // a counter identifying the latest choice, and the settle function of the
  // choice still waiting for its outcome.
  const writes = React.useRef<Promise<unknown>>(Promise.resolve());
  const latest = React.useRef(0);
  const pending = React.useRef<((outcome: LocaleSaveOutcome) => void) | null>(null);

  // Nothing is left to report to once the provider is gone.
  React.useEffect(() => () => pending.current?.("superseded"), []);

  const setLocale = React.useCallback((next: Locale) => {
    const choice = ++latest.current;
    const isLatest = () => choice === latest.current;
    setLocaleState(next);
    document.documentElement.lang = next;
    pending.current?.("superseded");

    return new Promise<LocaleSaveOutcome>((resolve) => {
      let done = false;
      const settle = (outcome: LocaleSaveOutcome) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        if (pending.current === settle) pending.current = null;
        resolve(outcome);
      };
      pending.current = settle;
      // Bounded feedback: a slow write is reported as not saved, but it is
      // NOT aborted and the chain keeps waiting for it. An abort cannot stop a
      // request the server may already be handling; its cookie could then land
      // after a newer write. The browser applies a response's cookies before
      // fetch() settles, so starting the next write only once this one has
      // really settled keeps cookies landing in click order.
      const timer = window.setTimeout(() => settle("failed"), LOCALE_SAVE_TIMEOUT_MS);
      // Concurrent POSTs would let an older response land last and leave the
      // cookie on a choice the user already replaced. Chained writes never
      // overlap, and a write whose choice was superseded while it waited is
      // skipped, so the last cookie written is always the latest choice.
      const write = writes.current.then(() => (isLatest() ? persistLocale(next) : null));
      writes.current = write;
      void write.then((saved) => {
        if (saved !== null && isLatest()) settle(saved ? "saved" : "failed");
      });
    });
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
