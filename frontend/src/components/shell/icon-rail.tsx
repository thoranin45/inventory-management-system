"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { NAV_GROUPS, isNavActive, visibleNavItems } from "@/lib/nav";
import { cn } from "@/lib/utils";

const RAIL_ITEM =
  "relative grid h-11 w-12 flex-none place-items-center rounded-[var(--r-sm)] transition-colors duration-[var(--dur-1)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]";

/**
 * Concept B iPad icon rail (frozen showroom `.rail`): 76 px column, 48×44
 * icon items with an accessible name and a tooltip, a hairline between
 * sections, and an "expand" item on top that opens the full labelled menu.
 * Same role-filtered items as the sidebar. Only visible 768–1023.98 px.
 */
export function IconRail({ onExpand, expanded }: { onExpand: () => void; expanded: boolean }) {
  const pathname = usePathname();
  const { user } = useSession();
  const t = useT();
  const items = visibleNavItems(isAdmin(user.role));

  return (
    <nav aria-label={t("nav.primary")} className="flex w-full flex-col items-center gap-1 py-[14px]">
      <button
        type="button"
        onClick={onExpand}
        aria-label={t("shell.expandMenu")}
        aria-expanded={expanded}
        title={t("shell.expandMenu")}
        className={cn(RAIL_ITEM, "text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]")}
      >
        <Menu aria-hidden className="h-5 w-5" />
      </button>
      {NAV_GROUPS.map((g) => {
        const groupItems = items.filter((n) => n.group === g.key);
        if (groupItems.length === 0) return null;
        return (
          <React.Fragment key={g.key}>
            <span aria-hidden className="my-1 h-px w-7 flex-none bg-[var(--border)]" />
            {groupItems.map((n) => {
              const active = isNavActive(pathname, n.href);
              const label = t(n.labelKey);
              return (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-label={label}
                  title={label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    RAIL_ITEM,
                    active
                      ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]",
                  )}
                >
                  <n.icon aria-hidden className="h-5 w-5" />
                </Link>
              );
            })}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
