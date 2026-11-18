import "server-only";

import type { Metadata } from "next";
import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LANG_COOKIE, isLocale, type Locale } from "./config";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "./translate";

/**
 * The request's language: the `akk_lang` cookie when it holds a supported
 * value, otherwise the first-visit default (Thai, decision D2). Browser
 * Accept-Language is deliberately not consulted.
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** A translator bound to the request's language, for server code (page metadata). */
export async function getServerT(): Promise<(key: MessageKey, vars?: MessageVars) => string> {
  const dict = DICTIONARIES[await getLocale()];
  return (key, vars) => translate(dict, key, vars);
}

/** Page `<title>` in the request's language; the root layout adds " | AKKRATHARA". */
export async function pageMetadata(key: MessageKey): Promise<Metadata> {
  return { title: (await getServerT())(key) };
}
