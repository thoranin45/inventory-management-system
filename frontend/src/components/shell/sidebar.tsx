"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { NAV_GROUPS, isNavActive, visibleNavItems } from "@/lib/nav";
import { isAdmin } from "@/lib/auth/permissions";
import { useSession } from "@/components/session-provider";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { SidebarSearch } from "./sidebar-search";

/**
 * Sidebar panel content. On desktop it is the persistent left column; on iPad
 * it is the full menu opened from the icon rail, with Search at the top.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useSession();
  const t = useT();
  const items = visibleNavItems(isAdmin(user.role));
  // The sidebar renders twice (persistent column + slide-over); unique ids
  // keep each group's aria-labelledby pointing at its own heading.
  const idPrefix = React.useId();

  return (
    <nav aria-label={t("nav.primary")} className="flex h-full flex-col gap-[2px] overflow-y-auto p-[10px_8px]">
      {/* Search (visible only < 1200px via CSS) */}
      <div className="min-[1200px]:hidden">
        <SidebarSearch className="mb-[10px]" />
        <div className="wc-section-label px-[10px] pb-[6px] pt-[4px]">{t("nav.menu")}</div>
      </div>

      {/* Concept B: six labelled sections; an empty section (e.g. after role
          filtering) is not rendered. Items, destinations and visibility are
          unchanged — grouping is presentation only. */}
      {NAV_GROUPS.map((g) => {
        const groupItems = items.filter((n) => n.group === g.key);
        if (groupItems.length === 0) return null;
        const headingId = `${idPrefix}-nav-${g.key}`;
        return (
          <div key={g.key} role="group" aria-labelledby={headingId} className="flex flex-col gap-[2px] pb-[6px]">
            <div id={headingId} className="wc-section-label px-[10px] pb-[4px] pt-[8px]">
              {t(g.labelKey)}
            </div>
            {groupItems.map((n) => {
              const active = isNavActive(pathname, n.href);
              const label = t(n.labelKey);
              return (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  title={label}
                  className={cn(
                    "relative flex h-[34px] w-full items-center gap-[11px] rounded-[var(--r-sm)] px-[10px] text-[13px] transition-colors duration-[var(--dur-1)] max-[1023.98px]:h-11 max-[1023.98px]:text-[14px]",
                    active
                      ? "bg-[var(--accent-subtle)] font-medium text-[var(--foreground)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]",
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-[7px] left-0 w-[2px] rounded-[2px] bg-[var(--accent)]"
                    />
                  ) : null}
                  <n.icon aria-hidden className={cn("h-4 w-4 flex-none", active && "text-[var(--accent)]")} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}

      <div className="mt-auto flex flex-col gap-[2px] border-t border-[var(--border)] pt-[10px]">
        <Link
          href="/reports"
          onClick={onNavigate}
          className="flex h-[38px] items-center gap-[11px] rounded-[var(--r-sm)] px-[10px] text-[13px] text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)] max-[1023.98px]:h-11"
        >
          <RotateCcw aria-hidden className="h-4 w-4 flex-none" />
          <span className="truncate">{t("nav.reportsExports")}</span>
        </Link>
      </div>
    </nav>
  );
}
