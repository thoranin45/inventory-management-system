"use client";

import { toast } from "sonner";

import type { Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { DICTIONARIES, translate, type MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

/** Native-script labels (decision D3: "ไทย | EN"); each marked with its own language. */
const OPTIONS: { value: Locale; label: string; titleKey: MessageKey }[] = [
  { value: "th", label: "ไทย", titleKey: "shell.langThTitle" },
  { value: "en", label: "EN", titleKey: "shell.langEnTitle" },
];

/**
 * Concept B language switch (frozen showroom): a labelled group of two
 * toggle buttons, 28 px tall on desktop, 44×48 on tablet and phone. Switching
 * keeps everything the user typed: it only changes the language state.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, t, setLocale } = useI18n();

  async function choose(next: Locale) {
    if (next === locale) return;
    const outcome = await setLocale(next);
    // a newer choice replaced this one: only the latest choice is announced
    if (outcome === "superseded") return;
    // announce in the NEW language (sonner renders an aria-live region)
    const dict = DICTIONARIES[next];
    if (outcome === "saved") toast.success(translate(dict, "shell.languageChanged"));
    else toast.warning(translate(dict, "shell.languageSaveFailed"));
  }

  return (
    <div
      role="group"
      aria-label={t("shell.language")}
      className={cn(
        "inline-flex flex-none items-center gap-[2px] rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] p-[2px]",
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const pressed = locale === o.value;
        return (
          <button
            key={o.value}
            type="button"
            lang={o.value}
            aria-pressed={pressed}
            title={t(o.titleKey)}
            onClick={() => void choose(o.value)}
            className={cn(
              "h-7 min-w-10 rounded-[4px] px-[10px] text-[12px] font-semibold tracking-[0.02em] transition-colors duration-[var(--dur-1)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)] max-[1023.98px]:h-11 max-[1023.98px]:min-w-12 max-[1023.98px]:text-[14px]",
              pressed
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
