"use client";

import { useEffect, useState } from "react";

/** SSR-safe matchMedia hook. Returns `false` until mounted on the client. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export type Viewport = "phone" | "ipad-portrait" | "laptop" | "desktop";

/**
 * Phase 0.6 breakpoint contract:
 *   phone         <= 767.98px   (bottom nav, no topbar search)
 *   ipad-portrait <= 1023.98px  (slide-over sidebar)
 *   laptop        <= 1199.98px  (persistent sidebar, search moved into it)
 *   desktop       >= 1200px     (persistent sidebar + topbar search)
 */
export function useViewport(): { viewport: Viewport; isPhone: boolean; belowDesktop: boolean } {
  const phone = useMediaQuery("(max-width: 767.98px)");
  const ipadPortrait = useMediaQuery("(max-width: 1023.98px)");
  const belowDesktop = useMediaQuery("(max-width: 1199.98px)");

  const viewport: Viewport = phone
    ? "phone"
    : ipadPortrait
      ? "ipad-portrait"
      : belowDesktop
        ? "laptop"
        : "desktop";

  return { viewport, isPhone: phone, belowDesktop };
}
