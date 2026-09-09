import * as React from "react";

import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("wc-panel flex flex-col", className)} {...props} />;
}

export function PanelHead({
  title,
  aside,
  className,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-[10px] border-b border-[var(--border)] px-[18px] py-[14px]",
        className,
      )}
    >
      <h3 className="text-[13px] font-semibold tracking-[0.01em]">{title}</h3>
      {aside ? <span className="tnum text-[11px] text-[var(--muted)]">{aside}</span> : null}
    </div>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[18px]", className)} {...props} />;
}
