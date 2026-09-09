"use client";

import * as React from "react";

/**
 * Shared two-column work-console composition for Picking and Packing.
 *
 *   ≥1024px : `1fr 360px` grid, the side column sticky — order lines always
 *             visible next to the scan panel.
 *   ≤1023px : the side column becomes a fixed bottom dock (`.wc-work-side`
 *             styling in globals.css caps it at 25dvh). This effect measures
 *             the real dock height and pads the list so the last line and its
 *             controls are never covered, and tracks the software-keyboard
 *             inset via visualViewport.
 *
 * `kbActive` (the scan field is focused) sets `data-kb` on <html> so the dock
 * collapses to input + Complete and rides just above the keyboard; the bottom
 * nav slides away. Opening "More" is handled purely in CSS
 * (`.wc-app[data-nav-open] .wc-work-side`).
 */
export function WorkConsoleLayout({
  breadcrumb,
  header,
  lines,
  side,
  kbActive,
}: {
  breadcrumb?: React.ReactNode;
  header: React.ReactNode;
  lines: React.ReactNode;
  side: React.ReactNode;
  kbActive: boolean;
}) {
  const sideRef = React.useRef<HTMLDivElement | null>(null);
  const mainRef = React.useRef<HTMLDivElement | null>(null);

  const sync = React.useCallback(() => {
    const side = sideRef.current;
    const main = mainRef.current;
    if (!side || !main) return;
    requestAnimationFrame(() => {
      if (typeof getComputedStyle !== "function" || getComputedStyle(side).position !== "fixed") {
        main.style.paddingBottom = "";
        return;
      }
      const phone = window.matchMedia("(max-width: 767.98px)").matches;
      const kb = document.documentElement.hasAttribute("data-kb");
      const navClearance = phone && !kb ? 58 : 0;
      main.style.paddingBottom = `${side.offsetHeight + navClearance + 20}px`;
    });
  }, []);

  React.useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && sideRef.current) {
      ro = new ResizeObserver(sync);
      ro.observe(sideRef.current);
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const onVV = () => {
      if (!vv) return;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--wc-kb-inset", `${inset}px`);
      sync();
    };
    vv?.addEventListener("resize", onVV);
    vv?.addEventListener("scroll", onVV);
    const main = mainRef.current;
    return () => {
      window.removeEventListener("resize", sync);
      ro?.disconnect();
      vv?.removeEventListener("resize", onVV);
      vv?.removeEventListener("scroll", onVV);
      if (main) main.style.paddingBottom = "";
    };
  }, [sync]);

  React.useEffect(() => {
    const el = document.documentElement;
    if (kbActive) el.setAttribute("data-kb", "");
    else {
      el.removeAttribute("data-kb");
      el.style.removeProperty("--wc-kb-inset");
    }
    sync();
    return () => {
      el.removeAttribute("data-kb");
      el.style.removeProperty("--wc-kb-inset");
    };
  }, [kbActive, sync]);

  return (
    <div className="flex flex-col gap-4">
      {breadcrumb}
      <div className="wc-work-layout">
        <div ref={mainRef} className="wc-work-main flex min-w-0 flex-col gap-3.5">
          {header}
          <div className="flex flex-col gap-[10px]">{lines}</div>
        </div>
        <div ref={sideRef} className="wc-work-side">
          {side}
        </div>
      </div>
    </div>
  );
}
