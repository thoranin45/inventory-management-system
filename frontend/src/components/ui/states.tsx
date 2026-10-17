import * as React from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

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
