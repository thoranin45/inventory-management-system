import "server-only";

import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LANG_COOKIE, isLocale, type Locale } from "./config";

/**
 * The request's language: the `akk_lang` cookie when it holds a supported
 * value, otherwise the first-visit default (Thai, decision D2). Browser
 * Accept-Language is deliberately not consulted.
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
