"use client";

import * as React from "react";
import { Check, TriangleAlert } from "lucide-react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { compareDecimals, isDecimalString, subtractDecimals, type DecimalString } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import { DICTIONARIES, translate } from "@/lib/i18n/translate";
import type { BatchExpiryInfo } from "@/lib/query/transfers";
import type { ProductLite } from "@/lib/query/sales";
import { cn } from "@/lib/utils";
import type { LineIssue } from "@/components/purchase-orders/receive-line";

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] max-[767.98px]:min-h-[46px] max-[767.98px]:text-[16px]";

/** Client validation for one transfer receive line, as a message key. Never
 *  blocks an expired-in-transit batch — that receipt MUST still be allowed. */
export function transferReceiveLineIssue(quantity: string | undefined, outstanding: DecimalString): LineIssue | null {
  const q = (quantity ?? "").trim();
  if (!q) return null;
  if (!isDecimalString(q) || Number(q) <= 0) return { key: "receive.errQtyPositive" };
  if ((q.split(".")[1]?.length ?? 0) > 3) return { key: "receive.errQtyScale" };
  if (compareDecimals(q, outstanding) > 0) return { key: "receive.errOverOutstanding", vars: { outstanding } };
  return null;
}

/** The same rule as English text (the summary only needs "is there a problem"). */
export function validateTransferReceiveLine(quantity: string | undefined, outstanding: DecimalString): string | null {
  const issue = transferReceiveLineIssue(quantity, outstanding);
  return issue ? translate(DICTIONARIES.en, issue.key, issue.vars) : null;
}

export function TransferReceiveLine({
  anchorId,
  product,
  productId,
  batchId,
  batchExpiry,
  dispatched,
  received,
  outstanding,
  quantity,
  onChange,
  highlight,
}: {
  anchorId: string;
  product: ProductLite | undefined;
  productId: number;
  batchId: number | null;
  batchExpiry?: BatchExpiryInfo;
  dispatched: DecimalString;
  received: DecimalString;
  outstanding: DecimalString;
  quantity: string | undefined;
  onChange: (quantity: string) => void;
  highlight?: boolean;
}) {
  const t = useT();
  const done = compareDecimals(outstanding, "0") <= 0;
  const issue = transferReceiveLineIssue(quantity, outstanding);
  const q = (quantity ?? "").trim();
  const inTransitAfter =
    isDecimalString(q) && Number(q) > 0 && !issue ? subtractDecimals(outstanding, q, 3) : outstanding;
  const expiredInTransit = batchExpiry?.is_expired === true;
  const name = product?.product_name ?? t("receive.productFallback", { id: productId });
  const sku = product?.sku ?? String(productId);
  const errId = `${anchorId}-err`;

  return (
    <div
      id={anchorId}
      className={cn(
        "rounded-[var(--r-md)] border bg-[var(--surface)] p-[13px_15px]",
        done
          ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)]"
          : highlight
            ? "border-[var(--accent)] ring-2 ring-[var(--accent-subtle)]"
            : "border-[var(--border)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{name}</div>
          <div className="mt-[3px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--muted)]">
            <span className="mono">{sku}</span>
            <span className="mono">{batchId != null ? t("receive.batchFallback", { id: batchId }) : t("task.trackNone")}</span>
            {batchExpiry && (batchExpiry.expiry_date || batchExpiry.days_to_expiry != null) ? (
              <ExpiryBadge days={batchExpiry.days_to_expiry} isoDate={batchExpiry.expiry_date} />
            ) : null}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
          <div>
            <dt>{t("transfer.dispatchedLabel")}</dt>
            <dd><QuantityDisplay value={dispatched} className="text-[var(--foreground)]" /></dd>
          </div>
          <div>
            <dt>{t("receive.received")}</dt>
            <dd><QuantityDisplay value={received} className="text-[var(--foreground)]" /></dd>
          </div>
          <div>
            <dt>{t("receive.outstanding")}</dt>
            <dd><QuantityDisplay value={outstanding} className="font-semibold text-[var(--foreground)]" /></dd>
          </div>
        </dl>
      </div>

      {expiredInTransit && !done ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--warning)]">
          <TriangleAlert aria-hidden className="mt-[1px] h-3.5 w-3.5 flex-none" />
          {t("transfer.expiredInTransit")}
        </p>
      ) : null}

      {done ? (
        <div className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--success)]">
          <Check aria-hidden className="h-[13px] w-[13px]" /> {t("receive.lineFullyReceived")}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex max-w-[220px] flex-col gap-1" htmlFor={`${anchorId}-qty`}>
            <span className="text-[12px] font-semibold text-[var(--muted)]">{t("receive.receiveNow")}</span>
            <input
              id={`${anchorId}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className={cn(inputCls, issue && "border-[var(--danger)]")}
              placeholder="0.000"
              value={quantity ?? ""}
              aria-invalid={issue ? true : undefined}
              aria-describedby={issue ? errId : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
          <p className="text-[12px] text-[var(--muted)]">
            {t("receive.inTransitAfterReceipt")}{" "}
            <QuantityDisplay value={inTransitAfter} className="font-semibold text-[var(--foreground)]" />
          </p>
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
