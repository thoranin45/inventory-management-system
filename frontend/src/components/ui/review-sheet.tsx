"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, Lock } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Concept B "Review before commit" sheet for Stock In / Stock Out / Receiving.
 *
 * It only ever CONFIRMS an operation the console already built: opening it
 * sends nothing; `onConfirm` is the console's existing submit (same payload,
 * same Idempotency-Key). Safety rules:
 *   - on open, focus moves to the sheet heading, NEVER to Confirm, so the
 *     trailing Enter of a hardware barcode scan cannot confirm by accident;
 *     Confirm needs an explicit click, Space/Enter on the focused button;
 *   - while `pending`, Back, Esc and outside clicks are blocked (the post is in
 *     flight) and Confirm shows its progress;
 *   - closing returns focus to `returnFocusRef` (opened from state, there is
 *     no Radix trigger to restore it);
 *   - centred dialog from 768 px up, a bottom sheet below (frozen spec).
 */
export function ReviewSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
  confirmDisabled = false,
  error,
  returnFocusRef,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  confirmDisabled?: boolean;
  /** a failure to show inside the sheet (the console keeps its retry rules) */
  error?: React.ReactNode;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const t = useT();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const blockWhilePending = (e: Event) => {
    if (pending) e.preventDefault();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (pending && !next ? undefined : onOpenChange(next))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-[var(--overlay)]" />
        <DialogPrimitive.Content
          aria-describedby={description ? "review-sheet-desc" : undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            headingRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            if (returnFocusRef?.current) {
              e.preventDefault();
              returnFocusRef.current.focus();
            }
          }}
          onEscapeKeyDown={blockWhilePending}
          onPointerDownOutside={blockWhilePending}
          onInteractOutside={blockWhilePending}
          className={cn(
            "wc-review-sheet fixed z-[90] flex flex-col border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)] focus:outline-none",
          )}
        >
          <div className="flex flex-col gap-1 border-b border-[var(--border)] px-5 pb-3 pt-4">
            <DialogPrimitive.Title asChild>
              <h2 ref={headingRef} tabIndex={-1} className="text-[17px] font-semibold outline-none">
                {title}
              </h2>
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description id="review-sheet-desc" className="text-[13px] text-[var(--muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            {children}
            {error ? <div role="alert">{error}</div> : null}
            <p className="flex items-start gap-2 text-[12px] text-[var(--muted)]">
              <Lock aria-hidden className="mt-[2px] h-3.5 w-3.5 flex-none" />
              {t("review.onceNote")}
            </p>
          </div>
          <div className="wc-review-sheet-foot flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            <Button variant="secondary" className="h-11 min-w-[120px]" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("review.backToEdit")}
            </Button>
            <Button
              variant="primary"
              className="h-11 min-w-[160px]"
              onClick={onConfirm}
              disabled={pending || confirmDisabled}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <>
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  {t("review.sending")}
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** One labelled cell of a review summary grid. */
export function ReviewCell({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-[3px] rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2", className)}>
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className="min-w-0 text-[14px] font-semibold">{children}</div>
    </div>
  );
}
