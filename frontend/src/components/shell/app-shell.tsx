"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

import { MobileBottomNav } from "./mobile-bottom-nav";
import { SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * The approved floating-panel shell.
 *   ≥1200px  persistent sidebar + topbar search
 *   ≤1199.98 persistent sidebar, search moves into it
 *   ≤1023.98 sidebar becomes a slide-over (Radix Dialog: focus trap, Esc)
 *   ≤767.98  edge-to-edge, bottom nav, "More" opens the slide-over
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = React.useState(false);
  const pathname = usePathname();

  // close the slide-over on route change — adjust state during render
  // (React's "info from previous renders" pattern; no effect needed).
  const [prevPath, setPrevPath] = React.useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    if (navOpen) setNavOpen(false);
  }

  return (
    <div className="wc-app" data-nav-open={navOpen || undefined}>
      <div className="wc-topbar">
        <Topbar onOpenNav={() => setNavOpen(true)} />
      </div>

      {/* persistent sidebar (hidden < 1024px via .wc-sidebar-slot) */}
      <aside className="wc-sidebar wc-sidebar-slot">
        <SidebarNav />
      </aside>

      <main id="content" tabIndex={-1} className="wc-content">
        {children}
      </main>

      {/* slide-over sidebar for tablet / phone */}
      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="wc-sidebar-scrim min-[1024px]:hidden" />
          <DialogPrimitive.Content
            className="wc-sidebar-drawer min-[1024px]:hidden"
            aria-label="Navigation"
          >
            <VisuallyHidden asChild>
              <DialogPrimitive.Title>Navigation</DialogPrimitive.Title>
            </VisuallyHidden>
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <MobileBottomNav onMore={() => setNavOpen(true)} />
    </div>
  );
}
