"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { DateField } from "@/components/ui/date-field";
import { compareDecimals, isDecimalString, subtractDecimals, type DecimalString } from "@/lib/decimal";
import { daysUntil, expiryState, type ExpiryState } from "@/lib/business-date";
import { useT } from "@/lib/i18n/client";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import type { ProductLite } from "@/lib/query/sales";
import type { ReceiptDraftLine } from "@/lib/receipt-draft";
import { cn } from "@/lib/utils";

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] max-[767.98px]:min-h-[46px] max-[767.98px]:text-[16px]";

/** A receive line's client-side problem, as a message key (rendered in the UI language). */
export interface LineIssue {
  key: MessageKey;
  vars?: MessageVars;
}

/** Per-line client validation. Mirrors the backend rules EXCEPT it never blocks
 *  an expired / same-day expiry date (Phase 7 accepts those inbound). */
export function receiveLineIssue(
  product: ProductLite | undefined,
  line: ReceiptDraftLine,
  remaining: DecimalString,
): LineIssue | null {
  const q = (line.quantity ?? "").trim();
  if (!q) return null; // empty line = not part of this receipt
  if (!isDecimalString(q) || Number(q) <= 0) return { key: "receive.errQtyPositive" };
  if ((q.split(".")[1]?.length ?? 0) > 3) return { key: "receive.errQtyScale" };
  if (compareDecimals(q, remaining) > 0) return { key: "receive.errOverRemaining", vars: { remaining } };
  if (!product) return null;
  const lot = (line.lot_no ?? "").trim();
  const mfg = (line.mfg_date ?? "").trim();
  const exp = (line.expiry_date ?? "").trim();
  if (!product.track_batch) {
    if (lot || mfg || exp) return { key: "receive.errNotBatch" };
    return null;
  }
  if (!lot) return { key: "receive.errLotRequired" };
  if (product.track_expiry && (!mfg || !exp)) return { key: "receive.errDatesRequired" };
  if (mfg && exp && exp <= mfg) return { key: "receive.errExpiryAfterMfg" };
  return null;
}

/** The same rules as English text (the summary and existing callers only need "is there a problem"). */
export function validateReceiveLine(
  product: ProductLite | undefined,
  line: ReceiptDraftLine,
  remaining: DecimalString,
): string | null {
  const issue = receiveLineIssue(product, line, remaining);
  return issue ? translate(DICTIONARIES.en, issue.key, issue.vars) : null;
}

const EXPIRY_KEY: Record<ExpiryState, MessageKey> = {
  expired: "receive.expiryExpired",
  "same-day": "task.expirySameDay",
  near: "task.expiryNear",
  ok: "task.expiryOk",
};

export function ReceiveLine({
  anchorId,
  product,
  productId,
  ordered,
  receivedToDate,
  remaining,
  line,
  onChange,
  highlight,
}: {
  anchorId: string;
  product: ProductLite | undefined;
  productId: number;
  ordered: DecimalString;
  receivedToDate: DecimalString;
  remaining: DecimalString;
  line: ReceiptDraftLine;
  onChange: (patch: ReceiptDraftLine) => void;
  highlight?: boolean;
}) {
  const t = useT();
  const complete = compareDecimals(remaining, "0") <= 0;
  const q = (line.quantity ?? "").trim();
  const issue = receiveLineIssue(product, line, remaining);
  const remainingAfter =
    isDecimalString(q) && Number(q) > 0 && !issue ? subtractDecimals(remaining, q, 3) : remaining;
  const expState = expiryState(line.expiry_date || null);
  const name = product?.product_name ?? t("receive.productFallback", { id: productId });
  const sku = product?.sku ?? String(productId);
  const trackHint = !product
    ? ""
    : t(product.track_batch && product.track_expiry ? "receive.trackBatchExpiry" : product.track_batch ? "task.trackBatch" : "task.trackNone");
  const errId = `${anchorId}-err`;

  return (
    <div
      id={anchorId}
      className={cn(
        "rounded-[var(--r-md)] border bg-[var(--surface)] p-[13px_15px]",
        complete
          ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)]"
          : highlight
            ? "border-[var(--accent)] ring-2 ring-[var(--accent-subtle)]"
            : "border-[var(--border)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{name}</div>
          <div className="mt-[3px] text-[12px] text-[var(--muted)]">
            <span className="mono">{sku}</span>
            {trackHint ? <span> · {trackHint}</span> : null}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
          <div>
            <dt>{t("receive.ordered")}</dt>
            <dd><QuantityDisplay value={ordered} className="text-[var(--foreground)]" /></dd>
          </div>
          <div>
            <dt>{t("receive.received")}</dt>
            <dd><QuantityDisplay value={receivedToDate} className="text-[var(--foreground)]" /></dd>
          </div>
          <div>
            <dt>{t("receive.outstanding")}</dt>
            <dd><QuantityDisplay value={remaining} className="font-semibold text-[var(--foreground)]" /></dd>
          </div>
        </dl>
      </div>

      {complete ? (
        <div className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--success)]">
          <Check aria-hidden className="h-[13px] w-[13px]" /> {t("receive.lineFullyReceived")}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1" htmlFor={`${anchorId}-qty`}>
              <span className="text-[12px] font-semibold text-[var(--muted)]">{t("receive.receiveNow")}</span>
              <input
                id={`${anchorId}-qty`}
                inputMode="decimal"
                autoComplete="off"
                className={cn(inputCls, issue && "border-[var(--danger)]")}
                placeholder="0.000"
                value={line.quantity ?? ""}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? errId : undefined}
                onChange={(e) => onChange({ quantity: e.target.value })}
              />
            </label>
            {product?.track_batch ? (
              <label className="flex flex-col gap-1" htmlFor={`${anchorId}-lot`}>
                <span className="text-[12px] font-semibold text-[var(--muted)]">{t("task.lotNumber")}</span>
                <input
                  id={`${anchorId}-lot`}
                  autoComplete="off"
                  className={`${inputCls} mono`}
                  placeholder="LOT-…"
                  value={line.lot_no ?? ""}
                  onChange={(e) => onChange({ lot_no: e.target.value })}
                />
              </label>
            ) : null}
          </div>

          {product?.track_batch && product?.track_expiry ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DateField
                id={`${anchorId}-mfg`}
                label={t("task.mfgDate")}
                value={line.mfg_date ?? ""}
                onChange={(v) => onChange({ mfg_date: v })}
                inputClassName={inputCls}
              />
              <DateField
                id={`${anchorId}-exp`}
                label={t("task.expiryDate")}
                value={line.expiry_date ?? ""}
                onChange={(v) => onChange({ expiry_date: v })}
                inputClassName={inputCls}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span className="text-[var(--muted)]">
              {t("receive.remainingAfterReceipt")}{" "}
              <QuantityDisplay value={remainingAfter} className="font-semibold text-[var(--foreground)]" />
            </span>
            {expState ? (
              <span className="inline-flex items-center gap-1">
                <ExpiryBadge days={daysUntil(line.expiry_date || "")} isoDate={line.expiry_date} />
                <span
                  className={cn(
                    expState === "expired" && "text-[var(--danger)]",
                    (expState === "same-day" || expState === "near") && "text-[var(--warning)]",
                  )}
                >
                  {t(EXPIRY_KEY[expState])}
                </span>
              </span>
            ) : null}
          </div>

          {issue ? (
            <p id={errId} className="text-[12px] text-[var(--danger)]">
              {t(issue.key, issue.vars)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
