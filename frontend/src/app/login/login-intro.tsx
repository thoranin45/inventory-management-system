"use client";

import { useT } from "@/lib/i18n/client";

/** Login heading and notices — client-rendered so a language switch updates them in place. */
export function LoginIntro({ expired }: { expired: boolean }) {
  const t = useT();
  return (
    <>
      <h1 className="text-[18px] font-semibold">{t("auth.signIn")}</h1>
      <p className="mt-1 text-[12.5px] text-[var(--muted)]">{t("auth.lede")}</p>

      {expired ? (
        <p
          role="status"
          className="mt-3 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warning)_32%,transparent)] bg-[var(--warning-subtle)] px-3 py-2 text-[12px] text-[var(--warning)]"
        >
          {t("auth.sessionExpired")}
        </p>
      ) : null}
    </>
  );
}
