/**
 * Concept B localization (R2). Thai is the first-visit language (decision D2);
 * an explicit choice is persisted in the `akk_lang` cookie, read on the server
 * so the first paint is already in the right language.
 */
export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "th";
export const LANG_COOKIE = "akk_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year, in seconds

export function isLocale(value: unknown): value is Locale {
  return value === "th" || value === "en";
}
