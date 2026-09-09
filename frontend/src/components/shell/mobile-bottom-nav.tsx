"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BOTTOM_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile"
      className="wc-bottom-nav fixed inset-x-0 bottom-0 z-40 hidden max-[767.98px]:grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)] px-1 pb-[calc(6px+env(safe-area-inset-bottom))] pt-[6px] transition-transform duration-[var(--dur-2)]"
    >
      {BOTTOM_NAV.map((n) => {
        const active = n.href
          ? pathname === n.href || pathname.startsWith(n.href + "/") || (n.href === "/dashboard" && pathname === "/")
          : false;
        const inner = (
          <>
            <n.icon aria-hidden className="h-[19px] w-[19px]" />
            <span>{n.label}</span>
          </>
        );
        const cls = cn(
          "flex min-h-11 flex-col items-center justify-center gap-[2px] rounded-[var(--r-sm)] px-1 text-[10px] font-semibold",
          active ? "text-[var(--accent)]" : "text-[var(--muted)]",
        );
        return n.action === "more" ? (
          <button key={n.key} type="button" onClick={onMore} className={cls} aria-label="More navigation">
            {inner}
          </button>
        ) : (
          <Link key={n.key} href={n.href!} className={cls} aria-current={active ? "page" : undefined}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
