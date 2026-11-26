"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { isApiError } from "@/lib/api/errors";
import { quotationActions, type QuotationDetail } from "@/lib/api/schemas/quotations";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { openQuotationPdf, useQuotation, useQuotationAction, useDeleteQuotationDraft, type QuotationAction } from "@/lib/query/quotations";
import { QuotationStatusBadge } from "./quotation-status";

/** "2026-11-27" -> "27/11/2026" (CE year, Owner decision). Dates are business dates, not instants. */
export function formatDocDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[13px] last:border-b-0">
      <span className="flex-none text-[var(--muted)]">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="wc-section-label mb-2">{title}</h3>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3">{children}</div>
    </section>
  );
}

type Confirmable = Exclude<QuotationAction, "revise"> | "delete";

const CONFIRM_COPY: Record<Confirmable, { title: MessageKey; body: MessageKey; button: MessageKey; danger?: boolean }> = {
  issue: { title: "quotations.issueTitle", body: "quotations.issueBody", button: "quotations.issue" },
  accept: { title: "quotations.acceptTitle", body: "quotations.acceptBody", button: "quotations.accept" },
  reject: { title: "quotations.rejectTitle", body: "quotations.rejectBody", button: "quotations.reject", danger: true },
  void: { title: "quotations.voidTitle", body: "quotations.voidBody", button: "quotations.void", danger: true },
  convert: { title: "quotations.convertTitle", body: "quotations.convertBody", button: "quotations.convert" },
  delete: { title: "quotations.deleteTitle", body: "quotations.deleteBody", button: "quotations.delete", danger: true },
};

const DONE_TOAST: Record<QuotationAction, MessageKey> = {
  issue: "quotations.issuedToast",
  accept: "quotations.acceptedToast",
  reject: "quotations.rejectedToast",
  void: "quotations.voidedToast",
  revise: "quotations.revisedToast",
  convert: "quotations.convertedToast",
};

function errorText(error: unknown, fallback: string) {
  return isApiError(error) ? { message: error.userMessage, requestId: error.requestId } : { message: fallback };
}

function QuotationActions({
  q,
  onEdit,
  onOpenOther,
  onDeleted,
}: {
  q: QuotationDetail;
  onEdit: (d: QuotationDetail) => void;
  onOpenOther: (id: number, editDraft?: QuotationDetail) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const allowed = quotationActions(q.status, q.is_expired);
  const action = useQuotationAction();
  const del = useDeleteQuotationDraft();
  const [pending, setPending] = React.useState<Confirmable | null>(null);
  const [reason, setReason] = React.useState("");
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const ref = q.quotation_number ?? t("quotations.draftRef", { id: q.id });

  const run = (kind: QuotationAction) =>
    action.mutate(
      { id: q.id, action: kind, reason: kind === "void" ? reason.trim() : undefined },
      {
        onSuccess: (data) => {
          setPending(null);
          setReason("");
          toast.success(
            t(DONE_TOAST[kind], { number: data.quotation_number ?? "", order: data.sales_order_number ?? "" }),
          );
          if (kind === "revise") onOpenOther(data.id, data);
        },
        onError: (error) => {
          const e = errorText(error, t("sales.somethingWrong"));
          toast.error(t("quotations.actionFailed"), { description: e.message });
        },
      },
    );

  const runDelete = () =>
    del.mutate(q.id, {
      onSuccess: () => {
        setPending(null);
        toast.success(t("quotations.deletedToast"));
        onDeleted();
      },
      onError: (error) => {
        toast.error(t("quotations.actionFailed"), { description: errorText(error, t("sales.somethingWrong")).message });
      },
    });

  const pdf = async () => {
    setPdfBusy(true);
    try {
      const { opened } = await openQuotationPdf(q.id);
      if (!opened) toast.message(t("sales.popupBlocked"), { description: t("sales.popupBlockedHint") });
    } catch (error) {
      toast.error(t("quotations.pdfFailed"), { description: errorText(error, t("sales.somethingWrong")).message });
    } finally {
      setPdfBusy(false);
    }
  };

  const copy = pending ? CONFIRM_COPY[pending] : null;
  const busy = action.isPending || del.isPending;
  const dialogError = pending === "delete" ? (del.isError ? errorText(del.error, "") : null) : action.isError ? errorText(action.error, "") : null;
  const reasonMissing = pending === "void" && reason.trim() === "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowed.issue ? <Button variant="primary" onClick={() => setPending("issue")}>{t("quotations.issue")}</Button> : null}
      {allowed.edit ? <Button variant="secondary" onClick={() => onEdit(q)}>{t("quotations.edit")}</Button> : null}
      {allowed.convert ? <Button variant="primary" onClick={() => setPending("convert")}>{t("quotations.convert")}</Button> : null}
      {allowed.accept ? <Button variant="primary" onClick={() => setPending("accept")}>{t("quotations.accept")}</Button> : null}
      {allowed.reject ? <Button variant="secondary" onClick={() => setPending("reject")}>{t("quotations.reject")}</Button> : null}
      {allowed.revise ? (
        <Button variant="secondary" onClick={() => run("revise")} disabled={busy}>
          {t("quotations.revise")}
        </Button>
      ) : null}
      {allowed.pdf ? (
        <Button variant="secondary" onClick={pdf} disabled={pdfBusy}>
          {pdfBusy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <FileText aria-hidden className="h-4 w-4" />}
          {pdfBusy ? t("sales.preparing") : t("quotations.openPdf")}
        </Button>
      ) : null}
      {allowed.void ? <Button variant="danger" onClick={() => setPending("void")}>{t("quotations.void")}</Button> : null}
      {allowed.remove ? <Button variant="danger" onClick={() => setPending("delete")}>{t("quotations.delete")}</Button> : null}

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
        {copy && pending ? (
          <DialogContent title={t(copy.title, { ref })} description={t(copy.body)}>
            {pending === "void" ? (
              <label className="flex flex-col gap-1" htmlFor="qt-void-reason">
                <span className="text-[12px] font-semibold text-[var(--muted)]">{t("quotations.voidReason")}</span>
                <input
                  id="qt-void-reason"
                  className="min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px]"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.currentTarget.value)}
                />
              </label>
            ) : null}
            {dialogError?.message ? (
              <ActionError message={dialogError.message} requestId={dialogError.requestId} className="mt-2" />
            ) : null}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">{t("orders.cancel")}</Button>
              </DialogClose>
              <Button
                variant={copy.danger ? "danger" : "primary"}
                disabled={busy || reasonMissing}
                onClick={() => (pending === "delete" ? runDelete() : run(pending))}
              >
                {busy ? t("quotations.working") : t(copy.button)}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function DetailBody({
  id,
  onEdit,
  onOpenOther,
  onDeleted,
}: {
  id: number;
  onEdit: (d: QuotationDetail) => void;
  onOpenOther: (id: number, editDraft?: QuotationDetail) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const query = useQuotation(id);
  if (query.isLoading) return <LoadingState label={t("quotations.loading")} />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const q = query.data;
  const customer = q.customer_snapshot ?? {};
  const seller = q.seller_snapshot ?? {};
  const vatOn = seller.vat_registered === true;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{q.quotation_number ?? t("quotations.draftRef", { id: q.id })}</div>
          <div className="text-[13px] text-[var(--muted)]">{String(customer.name ?? q.customer_name ?? "—")}</div>
        </div>
        <QuotationStatusBadge status={q.status} isExpired={q.is_expired} />
      </div>

      {q.is_expired ? (
        <Banner tone="warning" title={t("quotations.expiredNote", { date: formatDocDate(q.valid_until) })} />
      ) : null}
      {q.status === "VOID" && q.void_reason ? <Banner tone="info" title={t("quotations.voidedBecause", { reason: q.void_reason })} /> : null}

      <QuotationActions q={q} onEdit={onEdit} onOpenOther={onOpenOther} onDeleted={onDeleted} />

      <Section title={t("sales.summary")}>
        <Row label={t("quotations.issueDate")}>{formatDocDate(q.issue_date)}</Row>
        <Row label={t("quotations.validUntil")}>{formatDocDate(q.valid_until)}</Row>
        <Row label={t("quotations.customer")}>{String(customer.name ?? q.customer_name ?? "—")}</Row>
        {customer.tax_id ? <Row label={t("finance.taxId")}><span className="mono">{String(customer.tax_id)}</span></Row> : null}
        {q.sales_order_id ? (
          <Row label={t("quotations.salesOrder")}>
            <Link className="mono underline" href={`/sales?search=${encodeURIComponent(q.sales_order_number ?? "")}`}>
              {q.sales_order_number ?? `#${q.sales_order_id}`}
            </Link>
          </Row>
        ) : null}
        {q.revision_of_id ? (
          <Row label={t("quotations.revisionOf")}>
            <button type="button" className="underline" onClick={() => onOpenOther(q.revision_of_id as number)}>
              #{q.revision_of_id}
            </button>
          </Row>
        ) : null}
        {q.revised_by_id ? (
          <Row label={t("quotations.revisedBy")}>
            <button type="button" className="underline" onClick={() => onOpenOther(q.revised_by_id as number)}>
              #{q.revised_by_id}
            </button>
          </Row>
        ) : null}
      </Section>

      <Section title={t("quotations.lines")}>
        {q.items.map((item) => (
          <div key={item.id} className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
            <div className="font-medium">{item.description}</div>
            <div className="flex items-baseline justify-between gap-3 text-[var(--muted)]">
              <span>
                <QuantityDisplay value={item.quantity} /> × <MoneyDisplay value={item.unit_price} />
              </span>
              <MoneyDisplay value={item.line_total} className="font-semibold text-[var(--foreground)]" />
            </div>
          </div>
        ))}
      </Section>

      <Section title={t("quotations.totals")}>
        <Row label={t("quotations.subtotal")}><MoneyDisplay value={q.subtotal} /></Row>
        {vatOn ? <Row label={t("quotations.vat")}><MoneyDisplay value={q.vat_amount} /></Row> : null}
        <Row label={t("quotations.grandTotal")}><MoneyDisplay value={q.grand_total} className="font-semibold" /></Row>
      </Section>
      {!vatOn ? <p className="text-[12px] text-[var(--muted)]">{t("quotations.notTaxInvoice")}</p> : null}
      {q.notes ? (
        <Section title={t("quotations.notes")}>
          <p className="whitespace-pre-line py-2 text-[13px]">{q.notes}</p>
        </Section>
      ) : null}
    </div>
  );
}

export function QuotationDetailDrawer({
  id,
  open,
  onOpenChange,
  onEdit,
  onOpenOther,
}: {
  id: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (d: QuotationDetail) => void;
  onOpenOther: (id: number, editDraft?: QuotationDetail) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("quotations.detailTitle")}>
        {id !== null ? (
          <DetailBody id={id} onEdit={onEdit} onOpenOther={onOpenOther} onDeleted={() => onOpenChange(false)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
