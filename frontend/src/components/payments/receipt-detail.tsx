"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { ConfirmAction, errorText, FinanceStatusBadge, PdfButton, Row, Section } from "@/components/invoices/doc-parts";
import { receiptActions, type ReceiptDetail } from "@/lib/api/schemas/payments";
import { useT } from "@/lib/i18n/client";
import { openReceiptPdf, useReceipt, useVoidReceipt } from "@/lib/query/payments";
import { methodLabel } from "./payment-parts";

function ReceiptActions({ receipt }: { receipt: ReceiptDetail }) {
  const t = useT();
  const allowed = receiptActions(receipt.status);
  const voidMut = useVoidReceipt();
  const [confirming, setConfirming] = React.useState(false);

  const confirm = (reason: string) =>
    voidMut.mutate(
      { id: receipt.id, reason },
      {
        onSuccess: (data) => {
          setConfirming(false);
          toast.success(t("payments.voidedToast", { number: data.receipt_number }));
        },
        onError: (error) => toast.error(t("payments.actionFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowed.pdf ? <PdfButton open={() => openReceiptPdf(receipt.id)} label={t("payments.openPdf")} failed={t("payments.pdfFailed")} /> : null}
      {allowed.void ? <Button variant="danger" onClick={() => setConfirming(true)}>{t("payments.void")}</Button> : null}
      <ConfirmAction
        open={confirming}
        onOpenChange={setConfirming}
        title={t("payments.voidTitle", { ref: receipt.receipt_number })}
        body={t("payments.voidBody")}
        button={t("payments.void")}
        danger
        needsReason
        reasonLabel={t("payments.voidReason")}
        busy={voidMut.isPending}
        error={voidMut.isError ? errorText(voidMut.error, "") : null}
        onConfirm={confirm}
      />
    </div>
  );
}

function DetailBody({ id, onOpenInvoice }: { id: number; onOpenInvoice: (invoiceId: number) => void }) {
  const t = useT();
  const query = useReceipt(id);
  if (query.isLoading) return <LoadingState label={t("payments.loading")} />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const rc = query.data;
  const hasWht = rc.wht_total !== "0.00";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{rc.receipt_number}</div>
          <div className="text-[13px] text-[var(--muted)]">{rc.customer_name ?? "—"}</div>
        </div>
        <FinanceStatusBadge status={rc.status} />
      </div>
      {rc.status === "VOID" && rc.void_reason ? <Banner tone="info" title={t("payments.voidedBecause", { reason: rc.void_reason })} /> : null}

      <ReceiptActions receipt={rc} />

      <Section title={t("sales.summary")}>
        <Row label={t("payments.receivedDate")}>{formatDocDate(rc.received_date)}</Row>
        <Row label={t("payments.method")}>{methodLabel(t, rc.method)}</Row>
        {rc.reference ? <Row label={t("payments.reference")}><span className="mono">{rc.reference}</span></Row> : null}
      </Section>

      <Section title={t("payments.invoicesPaid")}>
        {rc.allocations.map((a) => (
          <div key={a.id} className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <button type="button" className="mono underline" onClick={() => onOpenInvoice(a.invoice_id)}>
                {a.invoice_number ?? `#${a.invoice_id}`}
              </button>
              <MoneyDisplay value={a.amount} className="font-semibold" />
            </div>
            {a.wht_amount !== "0.00" ? (
              <div className="flex items-baseline justify-between gap-3 text-[12px] text-[var(--muted)]">
                <span>{a.wht_certificate_no ? t("payments.whtWithCert", { cert: a.wht_certificate_no }) : t("payments.wht")}</span>
                <MoneyDisplay value={a.wht_amount} />
              </div>
            ) : null}
          </div>
        ))}
      </Section>

      <Section title={t("invoices.totals")}>
        <Row label={t("payments.cashReceived")}><MoneyDisplay value={rc.amount_total} className="font-semibold" /></Row>
        {hasWht ? (
          <>
            <Row label={t("payments.wht")}><MoneyDisplay value={rc.wht_total} /></Row>
            <Row label={t("payments.settled")}><MoneyDisplay value={rc.settled_total} /></Row>
          </>
        ) : null}
      </Section>

      {rc.notes ? (
        <Section title={t("payments.notes")}>
          <p className="whitespace-pre-line py-2 text-[13px]">{rc.notes}</p>
        </Section>
      ) : null}
      <p className="text-[12px] text-[var(--muted)]">{t("payments.notTaxInvoice")}</p>
    </div>
  );
}

export function ReceiptDetailDrawer({ id, open, onOpenChange, onOpenInvoice }: {
  id: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenInvoice: (invoiceId: number) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("payments.detailTitle")}>
        {id !== null ? <DetailBody key={id} id={id} onOpenInvoice={onOpenInvoice} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
