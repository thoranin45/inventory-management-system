"use client";

import { Search } from "lucide-react";

import { useCommandPalette } from "@/components/command-palette";
import { cn } from "@/lib/utils";

/**
 * Sidebar Search — shown below 1200px (tablet + phone). Opens the ONE
 * command palette. Rendered at the top of the sidebar, before the menu.
 */
export function SidebarSearch({ className }: { className?: string }) {
  const { openPalette } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Search products, orders, lots — opens the command palette"
      className={cn(
        "flex min-h-11 w-full items-center gap-[9px] rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--bg)] px-3 text-left text-[14px] text-[var(--faint)] transition-colors duration-[var(--dur-1)] hover:border-[var(--accent)] hover:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
        className,
      )}
    >
      <Search aria-hidden className="h-[14px] w-[14px] flex-none" />
      <span className="truncate">Search products, orders, lots…</span>
    </button>
  );
}
