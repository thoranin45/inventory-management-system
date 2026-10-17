"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

import { useT } from "@/lib/i18n/client";
import { IconRail } from "./icon-rail";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MoreSheet } from "./more-sheet";
import { SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * Concept B shell (R2).
 *   ≥1024px   persistent 236 px sidebar
 *   768–1023  76 px icon rail; its expand item opens the full menu as a
 *             slide-over (Radix Dialog: focus trap, Esc, focus return)
 *   <768      bottom bar; "More" opens the grouped bottom sheet
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const pathname = usePathname();
  const t = useT();
  // These dialogs open from state (no Radix Trigger), so Radix has no
  // trigger to refocus on close; remember the opener and return focus to it.
  const opener = React.useRef<HTMLElement | null>(null);
  const rememberOpener = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const returnFocus = (e: Event) => {
    e.preventDefault();
    if (opener.current?.isConnected) opener.current.focus();
  };

  // close overlays on route change — adjust state during render
  // (React's "info from previous renders" pattern; no effect needed).
  const [prevPath, setPrevPath] = React.useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    if (navOpen) setNavOpen(false);
    if (moreOpen) setMoreOpen(false);
  }

  return (
    <div className="wc-app" data-nav-open={navOpen || moreOpen || undefined}>
      {/* WCAG 2.4.1 bypass block: first tab stop, visible on focus only */}
      <a href="#content" className="wc-skip-link">
        {t("shell.skipToContent")}
      </a>
      <div className="wc-topbar">
        <Topbar />
      </div>

      {/* persistent sidebar (hidden < 1024px via .wc-sidebar-slot) */}
      <aside className="wc-sidebar wc-sidebar-slot">
        <SidebarNav />
      </aside>

      {/* iPad icon rail (shown 768–1023.98px via .wc-rail-slot) */}
      <aside className="wc-rail-slot">
        <IconRail
          expanded={navOpen}
          onExpand={() => {
            rememberOpener();
            setNavOpen(true);
          }}
        />
      </aside>

      <main id="content" tabIndex={-1} className="wc-content">
        {children}
      </main>

      {/* full labelled menu for iPad, opened from the rail */}
      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="wc-sidebar-scrim min-[1024px]:hidden" />
          <DialogPrimitive.Content
            className="wc-sidebar-drawer min-[1024px]:hidden"
            aria-label={t("shell.navigation")}
            aria-describedby={undefined}
            onCloseAutoFocus={returnFocus}
          >
            <VisuallyHidden asChild>
              <DialogPrimitive.Title>{t("shell.navigation")}</DialogPrimitive.Title>
            </VisuallyHidden>
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <MobileBottomNav
        moreOpen={moreOpen}
        onMore={() => {
          rememberOpener();
          setMoreOpen(true);
        }}
      />
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} onCloseAutoFocus={returnFocus} />
    </div>
  );
}
