"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { masterDataErrorCopy } from "@/lib/api/schemas/master-data";

/**
 * Shared destructive-confirm dialog for master data. A backend refusal (409
 * category-in-use, 400 FK constraint) is shown inline with its Request ID —
 * never swallowed, never retried silently.
 */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = "Delete",
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [err, setErr] = React.useState<{ message: string; requestId?: string } | null>(null);

  // Reset the inline error when the dialog is (re)opened — adjust-during-render,
  // no effect needed.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (err) setErr(null);
  }

  const run = async () => {
    setErr(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error)) {
        const copy = masterDataErrorCopy(error.message) ?? error.userMessage;
        setErr({ message: copy, requestId: error.requestId });
      } else {
        setErr({ message: "Something went wrong." });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <div className="text-[13px] text-[var(--muted)]">{body}</div>

        {err ? (
          <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
            {err.message}
            {err.requestId ? (
              <span className="mt-1 block text-[11px] text-[var(--muted)]">
                Request ID: <span className="mono select-all">{err.requestId}</span>
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="mt-1 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Keep it</Button>
          </DialogClose>
          <Button variant="danger" onClick={run} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Toast helper shared by master-data mutation error handlers. */
export function toastMutationError(fallback: string, error: unknown) {
  const msg = isApiError(error) ? (masterDataErrorCopy(error.message) ?? error.userMessage) : fallback;
  const rid = isApiError(error) ? error.requestId : undefined;
  toast.error(fallback, { description: rid ? `${msg} · Request ${rid}` : msg });
}
