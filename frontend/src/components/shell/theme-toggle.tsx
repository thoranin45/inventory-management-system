"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};
/** false on the server + first client render, true afterwards — no effect, no
 *  setState, hydration-safe. */
function useMounted() {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  // render a stable placeholder icon until mounted so SSR and first paint match
  const Icon = !mounted ? Moon : isDark ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label={!mounted ? t("shell.toggleTheme") : isDark ? t("shell.switchToLight") : t("shell.switchToDark")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-[var(--r-sm)] border border-transparent text-[var(--muted)] transition-colors duration-[var(--dur-1)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
        className,
      )}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </button>
  );
}
