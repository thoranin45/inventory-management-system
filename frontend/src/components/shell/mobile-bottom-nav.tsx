"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BOTTOM_NAV, isBottomNavActive } from "@/lib/nav";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Concept B phone bottom bar (frozen showroom `.bnav`): Home, Tasks, Stock,
 * Orders and More. 52 px targets, 12 px labels, the current tab in accent.
 */
export function MobileBottomNav({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav
      aria-label={t("bottom.label")}
      className="wc-bottom-nav fixed inset-x-0 bottom-0 z-40 hidden max-[767.98px]:grid grid-cols-5 gap-1 border-t border-[var(--border)] bg-[var(--surface)] px-2 pb-[calc(6px+env(safe-area-inset-bottom))] pt-[6px] transition-transform duration-[var(--dur-2)]"
    >
      {BOTTOM_NAV.map((n) => {
        const active = n.href ? isBottomNavActive(pathname, n) : moreOpen;
        const label = t(n.labelKey);
        const inner = (
          <>
            <n.icon aria-hidden className="h-5 w-5" />
            <span className="max-w-full truncate">{label}</span>
          </>
        );
        const cls = cn(
          "flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-[3px] rounded-[14px] px-1 text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
          active ? "font-semibold text-[var(--accent)]" : "font-medium text-[var(--muted)]",
        );
        return n.href ? (
          <Link key={n.key} href={n.href} className={cls} aria-current={active ? "page" : undefined}>
            {inner}
          </Link>
        ) : (
          <button
            key={n.key}
            type="button"
            onClick={onMore}
            className={cls}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-label={t("bottom.moreNavigation")}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
