import { Construction } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";

/**
 * Safe placeholder for routes not implemented in Frontend Phase 1. Renders
 * inside the real AppShell so navigation, responsive behaviour and theming
 * are exercised — but fabricates no business data.
 */
export function PlaceholderScreen({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} subtitle="Placeholder — this screen arrives in a later frontend phase." />
      <div className="flex flex-col items-center gap-3 rounded-[var(--r-xl)] border border-[var(--border)] bg-[var(--surface)] p-12 text-center shadow-[var(--shadow-panel)]">
        <Construction aria-hidden className="h-8 w-8 text-[var(--faint)]" />
        <h2 className="text-[15px] font-semibold">{title} is scheduled for {phase}</h2>
        <p className="max-w-[46ch] text-[12.5px] text-[var(--muted)]">
          Phase 1 delivers the production foundation (shell, auth, API client, theming, command
          palette and the real Dashboard). This route is wired into the shell so it is fully
          navigable, but its workflow UI has not been built yet.
        </p>
      </div>
    </div>
  );
}
