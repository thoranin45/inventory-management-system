import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, Inbox, Loader2, XCircle } from "lucide-react";

import { isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Msg } from "./msg";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-sunken)] motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function LoadingState({
  label,
  className,
}: {
  label?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 p-6 text-[12.5px] text-[var(--muted)]", className)}
    >
      <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
      {label ?? <Msg k="common.loading" />}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  className,
}: {
  title?: React.ReactNode;
  message?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-[10px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-12 text-center text-[var(--muted)]",
        className,
      )}
    >
      <Inbox aria-hidden className="h-8 w-8 text-[var(--faint)]" />
      <h3 className="text-[14px] text-[var(--foreground)]">{title ?? <Msg k="common.emptyTitle" />}</h3>
      {message ? <p className="max-w-[36ch] text-[12.5px]">{message}</p> : null}
    </div>
  );
}

/**
 * Error surface. Always shows the backend `request_id` when present so
 * support can trace the failure.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const api = isApiError(error) ? error : null;
  // backend / error wording is shown as sent; only the generic fallback is translated
  const message: React.ReactNode =
    api?.userMessage ??
    (error instanceof Error ? error.message : <Msg k="common.somethingWrong" />);
  const requestId = api?.requestId;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-subtle)] text-[var(--foreground)]",
        compact ? "p-3 text-[12px]" : "p-4 text-[13px]",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-semibold text-[var(--danger)]">
        <AlertTriangle aria-hidden className="h-4 w-4 flex-none" />
        {message}
      </div>
      {requestId ? (
        <div className="text-[11px] text-[var(--muted)]">
          <Msg k="common.requestId" /> <span className="mono select-all">{requestId}</span>
        </div>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-1">
          <Msg k="common.tryAgain" />
        </Button>
      ) : null}
    </div>
  );
}

const BANNER_TONE = {
  good: { icon: CheckCircle2, cls: "border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-subtle)]", ink: "text-[var(--success)]" },
  warning: { icon: AlertTriangle, cls: "border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-subtle)]", ink: "text-[var(--warning)]" },
  danger: { icon: XCircle, cls: "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-subtle)]", ink: "text-[var(--danger)]" },
  info: { icon: Info, cls: "border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[var(--accent-subtle)]", ink: "text-[var(--accent)]" },
} as const;

/**
 * Concept B banner: icon + title (never colour alone), optional body and
 * actions. Danger banners are alerts; the others are polite status messages.
 */
export function Banner({
  tone,
  title,
  children,
  actions,
  className,
}: {
  tone: keyof typeof BANNER_TONE;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const t = BANNER_TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex flex-col gap-2 rounded-[var(--r-md)] border p-3 text-[13px] text-[var(--foreground)]", t.cls, className)}
    >
      <div className={cn("flex items-start gap-2 font-semibold", t.ink)}>
        <Icon aria-hidden className="mt-[1px] h-4 w-4 flex-none" />
        <span>{title}</span>
      </div>
      {children ? <div className="pl-6">{children}</div> : null}
      {actions ? <div className="flex flex-wrap gap-2 pl-6">{actions}</div> : null}
    </div>
  );
}
