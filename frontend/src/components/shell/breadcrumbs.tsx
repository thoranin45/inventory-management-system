"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { NAV_GROUPS } from "@/lib/nav";
import { resolveRoute } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Concept B breadcrumbs (frozen showroom: section › page in the header).
 * Sub-routes show section › page (link) › current. Shown from iPad up; on
 * phones the app bar has no room and the bottom bar shows the location.
 */
export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();
  const trail = resolveRoute(pathname);
  if (!trail) return null;

  const groupLabel = t(NAV_GROUPS.find((g) => g.key === trail.group)!.labelKey);
  const pageLabel = t(trail.page.labelKey);

  return (
    <nav aria-label={t("shell.breadcrumb")} className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-[6px] whitespace-nowrap text-[13px] text-[var(--faint)]">
        <li className="truncate max-[1023.98px]:hidden">{groupLabel}</li>
        <li aria-hidden className="flex-none max-[1023.98px]:hidden">
          <ChevronRight className="h-[14px] w-[14px]" />
        </li>
        {trail.leaf ? (
          <>
            <li className="min-w-0 truncate">
              <Link href={trail.page.href} className="rounded-[var(--r-xs)] hover:text-[var(--foreground)] hover:underline">
                {pageLabel}
              </Link>
            </li>
            <li aria-hidden className="flex-none">
              <ChevronRight className="h-[14px] w-[14px]" />
            </li>
            <li className="min-w-0 truncate">
              <span aria-current="page" className="font-semibold text-[var(--foreground)]">
                {t(trail.leaf)}
              </span>
            </li>
          </>
        ) : (
          <li className="min-w-0 truncate">
            <span aria-current="page" className="font-semibold text-[var(--foreground)]">
              {pageLabel}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
