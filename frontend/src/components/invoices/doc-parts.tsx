"use client";

import * as React from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { useT } from "@/lib/i18n/client";
import { formMessage } from "@/lib/order-copy";

/** Shared building blocks for the F2b invoice and adjustment-note screens. */

export const inputCls =
  "min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] min-[768px]:text-[13px]";

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[13px] last:border-b-0">
      <span className="flex-none text-[var(--muted)]">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="wc-section-label mb-2">{title}</h3>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const copy = useOrderCopy();
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {hint && !error ? <span className="text-[11px] text-[var(--faint)]">{hint}</span> : null}
      {error ? <span className="text-[12px] text-[var(--danger)]">{copy(formMessage(error))}</span> : null}
    </label>
  );
}

export function errorText(error: unknown, fallback: string) {
  return isApiError(error) ? { message: error.userMessage, requestId: error.requestId } : { message: fallback };
}

/** Status chip; OVERDUE is computed by the backend (ISSUED and past the due date). */
export function FinanceStatusBadge({ status, overdue = false }: { status: string; overdue?: boolean }) {
  const t = useT();
  if (overdue) return <StatusBadge status="OVERDUE" label={t("status.OVERDUE")} tone="warning" />;
  return <StatusBadge status={status.toUpperCase()} />;
}

type OpenPdf = () => PromiseLike<{ opened: boolean }>;

export function PdfButton({ open, label, failed }: { open: OpenPdf; label: string; failed: string }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { opened } = await open();
      if (!opened) toast.message(t("sales.popupBlocked"), { description: t("sales.popupBlockedHint") });
    } catch (error) {
      toast.error(failed, { description: errorText(error, t("sales.somethingWrong")).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" onClick={run} disabled={busy}>
      {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <FileText aria-hidden className="h-4 w-4" />}
      {busy ? t("sales.preparing") : label}
    </Button>
  );
}

type ConfirmProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  button: string;
  danger?: boolean;
  needsReason?: boolean;
  reasonLabel?: string;
  busy: boolean;
  error: { message: string; requestId?: string } | null;
  onConfirm: (reason: string) => void;
};

/** Mounted only while open, so the reason starts empty every time. */
function ConfirmBody({ button, danger, needsReason, reasonLabel, busy, error, onConfirm }: Omit<ConfirmProps, "open" | "onOpenChange" | "title" | "body">) {
  const t = useT();
  const [reason, setReason] = React.useState("");
  const missing = needsReason === true && reason.trim() === "";
  return (
    <>
      {needsReason ? (
        <label className="flex flex-col gap-1" htmlFor="fin-void-reason">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{reasonLabel}</span>
          <input
            id="fin-void-reason"
            className="min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px]"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
        </label>
      ) : null}
      {error?.message ? <ActionError message={error.message} requestId={error.requestId} className="mt-2" /> : null}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t("orders.cancel")}</Button>
        </DialogClose>
        <Button variant={danger ? "danger" : "primary"} disabled={busy || missing} onClick={() => onConfirm(reason.trim())}>
          {busy ? t("invoices.working") : button}
        </Button>
      </div>
    </>
  );
}

/** One confirm dialog for issue / void (with a required reason) / delete. */
export function ConfirmAction({ open, onOpenChange, title, body, ...rest }: ConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent title={title} description={body}>
          <ConfirmBody {...rest} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
