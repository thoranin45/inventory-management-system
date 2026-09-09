"use client";

import Link from "next/link";
import { Bell, Menu, Search, Warehouse } from "lucide-react";

import { useCommandPalette } from "@/components/command-palette";
import { useSession } from "@/components/session-provider";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { openPalette } = useCommandPalette();
  const { user, logout } = useSession();
  const initials =
    (user.username ?? "?")
      .split(/[.\s_-]+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <header className="wc-panel z-30 flex items-center gap-3 rounded-[var(--r-xl)] border px-4 shadow-[var(--shadow-sm)] max-[767.98px]:rounded-none max-[767.98px]:border-0 max-[767.98px]:border-b max-[767.98px]:border-[var(--border)] max-[767.98px]:shadow-none">
      <button
        type="button"
        aria-label="Open navigation"
        onClick={onOpenNav}
        className="hidden max-[1023.98px]:grid h-9 w-9 place-items-center rounded-[var(--r-sm)] text-[var(--muted)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        <Menu aria-hidden className="h-[18px] w-[18px]" />
      </button>

      <Link
        href="/dashboard"
        className="flex items-center gap-[9px] text-[14px] font-semibold tracking-[-0.01em]"
      >
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[var(--r-sm)] bg-[var(--primary)] text-[var(--primary-fg)]">
          <Warehouse aria-hidden className="h-[15px] w-[15px]" />
        </span>
        <span>Warehouse Console</span>
      </Link>

      {/* Desktop-only topbar search (>= 1200px). Below that it moves into the sidebar. */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Open command palette"
        className={cn(
          "hidden min-[1200px]:flex h-8 max-w-[380px] flex-1 items-center gap-[9px] rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--bg)] px-[10px] text-[13px] text-[var(--faint)] transition-colors duration-[var(--dur-1)] hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
        )}
      >
        <Search aria-hidden className="h-[14px] w-[14px] flex-none" />
        <span className="truncate">Search products, orders, lots…</span>
        <kbd className="ml-auto rounded-[var(--r-sm)] border border-[var(--border-strong)] px-[6px] text-[11px] text-[var(--muted)]">
          Ctrl K
        </kbd>
      </button>

      <span className="flex-1 min-[1200px]:flex-none" />

      <button
        type="button"
        aria-label="Notifications (placeholder)"
        className="grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        <Bell aria-hidden className="h-4 w-4" />
      </button>

      <ThemeToggle />

      <button
        type="button"
        onClick={() => void logout()}
        className="flex h-8 items-center gap-2 rounded-[var(--r-sm)] px-2 text-[13px] text-[var(--foreground)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        aria-label={`Signed in as ${user.username ?? "user"} — sign out`}
      >
        <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[var(--r-full)] bg-[var(--accent-subtle)] text-[10px] font-bold text-[var(--accent)]">
          {initials}
        </span>
        <span className="max-[767.98px]:hidden">{user.username ?? "Account"}</span>
      </button>
    </header>
  );
}
