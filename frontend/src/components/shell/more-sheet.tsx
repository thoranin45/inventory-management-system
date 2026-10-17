"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { NAV_GROUPS, isNavActive, visibleNavItems } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Concept B phone "More" sheet (frozen showroom `.moregrid`): every
 * navigation item the user may see, grouped by section in a 3-column grid of
 * 76 px tiles. A Radix Dialog: focus is trapped inside, Esc or the close
 * button dismisses it, and focus returns to the More button.
 */
export function MoreSheet({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const pathname = usePathname();
  const { user } = useSession();
  const t = useT();
  const items = visibleNavItems(isAdmin(user.role));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="wc-sidebar-scrim min-[768px]:hidden" />
        <DialogPrimitive.Content
          className="wc-more-sheet min-[768px]:hidden"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--border-strong)]" />
          <div className="mb-2 flex items-center justify-between">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-[var(--foreground)]">
              {t("bottom.moreNavigation")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t("common.close")}
              className="grid h-11 w-11 place-items-center rounded-[var(--r-sm)] text-[var(--muted)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
            >
              <X aria-hidden className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label={t("bottom.moreNavigation")} className="flex flex-col gap-3">
            {NAV_GROUPS.map((g) => {
              const groupItems = items.filter((n) => n.group === g.key);
              if (groupItems.length === 0) return null;
              const headingId = `more-nav-${g.key}`;
              return (
                <section key={g.key} aria-labelledby={headingId}>
                  <h2 id={headingId} className="wc-section-label mb-[6px] px-1">
                    {t(g.labelKey)}
                  </h2>
                  <ul className="wc-more-grid">
                    {groupItems.map((n) => {
                      const active = isNavActive(pathname, n.href);
                      return (
                        <li key={n.key} className="min-w-0">
                          <Link
                            href={n.href}
                            onClick={() => onOpenChange(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-[76px] flex-col items-center justify-center gap-[6px] rounded-[var(--r-md)] px-1 py-2 text-center text-[12.5px] leading-tight focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
                              active
                                ? "bg-[var(--accent-subtle)] font-semibold text-[var(--accent)]"
                                : "bg-[var(--surface-sunken)] text-[var(--foreground)]",
                            )}
                          >
                            <n.icon aria-hidden className="h-5 w-5 flex-none" />
                            <span className="line-clamp-2 break-words">{t(n.labelKey)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
