"use client";

import { formatDisplayDate } from "@/lib/business-date";
import { useI18n } from "@/lib/i18n/client";

/**
 * A date-only ISO value shown in the UI language (Thai: Buddhist-era year).
 * Display only; the value is never changed. `isoInEnglish` keeps the existing
 * plain ISO text in English for shared components whose English wording is
 * outside R4.
 */
export function LocalDate({ iso, isoInEnglish = false }: { iso: string | null | undefined; isoInEnglish?: boolean }) {
  const { locale } = useI18n();
  if (isoInEnglish && locale === "en") return <>{iso ? iso.slice(0, 10) : "—"}</>;
  return <>{formatDisplayDate(iso ? iso.slice(0, 10) : iso, locale)}</>;
}
