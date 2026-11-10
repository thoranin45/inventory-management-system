"use client";

import * as React from "react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/client";
import type { ProductLite } from "@/lib/query/sales";
import type { PurchaseOrderReceiveResult } from "@/lib/api/schemas/purchase-orders";

/**
 * Receipt history.
 *
 * BACKEND GAP: there is no endpoint that lists a PO's historical receipts. The
 * list row exposes a `receipt_count` + `last_receipt_at` only. So this panel
 * shows the receipts made **in this browser session** (from each receive
 * response) and states the limitation plainly — it never fabricates or
 * back-fills earlier receipts.
 */
export function ReceiptHistory({
  sessionReceipts,
  receiptCount,
  lookup,
}: {
  sessionReceipts: PurchaseOrderReceiveResult[];
  receiptCount: number;
  lookup: Record<number, ProductLite>;
}) {
  const t = useT();
  return (
    <section>
      <h3 className="wc-section-label mb-2">{t("receive.historyTitle")}</h3>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
        {sessionReceipts.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">
            {t("receive.historyEmpty")}
            {receiptCount > 0 ? ` ${t("receive.historyEarlier")}` : ""}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {sessionReceipts.map((r) => (
              <li key={r.receipt_number} className="py-[9px] text-[12px] first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="mono font-medium">{r.receipt_number}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--muted)]">
                  {r.received_items.map((it) => (
                    <span key={it.po_item_id}>
                      {lookup[it.product_id]?.sku ?? `#${it.product_id}`}{" "}
                      <QuantityDisplay value={it.received_quantity} className="text-[var(--foreground)]" />
                      {it.batch_id != null ? (
                        <span className="mono text-[var(--faint)]">
                          {" "}
                          · {r.received_batches.find((b) => b.batch_id === it.batch_id)?.lot_no ?? t("receive.batchFallback", { id: it.batch_id })}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--faint)]">
          {t("receive.historyApiNote", { n: receiptCount })}
        </p>
      </div>
    </section>
  );
}
