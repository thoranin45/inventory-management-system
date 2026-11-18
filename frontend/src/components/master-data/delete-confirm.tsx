"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { useT } from "@/lib/i18n/client";
import { masterDataErrorText } from "@/lib/master-data-copy";

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
  confirmLabel,
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
  const t = useT();
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
        const copy = masterDataErrorText(t, error.message, error.userMessage);
        setErr({ message: copy, requestId: error.requestId });
      } else {
        setErr({ message: t("common.somethingWrong") });
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
                {t("common.requestId")} <span className="mono select-all">{err.requestId}</span>
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="mt-1 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t("masterData.keepIt")}</Button>
          </DialogClose>
          <Button variant="danger" onClick={run} disabled={pending}>
            {pending ? t("masterData.working") : (confirmLabel ?? t("masterData.delete"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
