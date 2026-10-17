"use client";

import Link from "next/link";
import { Bell, Search } from "lucide-react";

import { useCommandPalette } from "@/components/command-palette";
import { useSession } from "@/components/session-provider";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { Breadcrumbs } from "./breadcrumbs";
import { LanguageSwitch } from "./language-switch";
import { ThemeToggle } from "./theme-toggle";

const ICON_BTN =
  "grid h-8 w-8 flex-none place-items-center rounded-[var(--r-sm)] text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--focus)] max-[1023.98px]:h-11 max-[1023.98px]:w-11";

/**
 * Concept B header (frozen showroom): breadcrumbs, command search, language
 * switch, notifications, theme and account. Full navigation lives in the
 * sidebar (desktop), icon rail (iPad) and bottom bar (phone).
 */
export function Topbar() {
  const { openPalette } = useCommandPalette();
  const { user, logout } = useSession();
  const t = useT();
  const initials =
    (user.username ?? "?")
      .split(/[.\s_-]+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <header className="z-30 flex min-w-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 max-[767.98px]:gap-1 max-[767.98px]:px-3">
      <Link href="/dashboard" aria-label={t("shell.homeLink")} className="flex flex-none items-center">
        {/* mark always; wordmark from tablet up */}
        <BrandMark variant="full" className="max-[767.98px]:[&>span:last-child]:hidden" />
      </Link>

      <Breadcrumbs className="ml-2 max-[767.98px]:hidden" />

      <span className="flex-1" />

      {/* Desktop command search (>= 1200px); below that an icon opens the same palette. */}
      <button
        type="button"
        onClick={openPalette}
        aria-label={t("shell.openPalette")}
        className="hidden min-[1200px]:flex h-8 w-[300px] flex-none items-center gap-[9px] rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--bg)] px-[10px] text-[13px] text-[var(--faint)] transition-colors duration-[var(--dur-1)] hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        <Search aria-hidden className="h-[14px] w-[14px] flex-none" />
        <span className="truncate">{t("shell.searchPlaceholder")}</span>
        <kbd className="ml-auto rounded-[var(--r-sm)] border border-[var(--border-strong)] px-[6px] text-[11px] text-[var(--muted)]">
          Ctrl K
        </kbd>
      </button>
      <button type="button" onClick={openPalette} aria-label={t("shell.openPalette")} className={cn(ICON_BTN, "min-[1200px]:hidden")}>
        <Search aria-hidden className="h-4 w-4" />
      </button>

      <LanguageSwitch />

      <button type="button" aria-label={t("shell.notifications")} className={ICON_BTN}>
        <Bell aria-hidden className="h-4 w-4" />
      </button>

      <ThemeToggle className="max-[1023.98px]:h-11 max-[1023.98px]:w-11" />

      <button
        type="button"
        onClick={() => void logout()}
        className="flex h-8 flex-none items-center gap-2 rounded-[var(--r-sm)] px-2 text-[13px] text-[var(--foreground)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)] max-[1023.98px]:h-11"
        aria-label={t("shell.signedInAs", { name: user.username ?? t("shell.user") })}
      >
        <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[var(--r-full)] bg-[var(--accent-subtle)] text-[10px] font-bold text-[var(--accent)]">
          {initials}
        </span>
        <span className="max-[1199.98px]:hidden">{user.username ?? t("shell.account")}</span>
      </button>
    </header>
  );
}
