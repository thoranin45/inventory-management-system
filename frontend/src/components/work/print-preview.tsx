"use client";

import * as React from "react";

import { LocalDate } from "@/components/ui/local-date";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useStatusLabel } from "@/components/orders/lifecycle-steps";
import { formatBusinessDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { usePackingSlipData, useShippingLabelData } from "@/lib/query/sales";
import type { PackingSlipData, ShippingLabelData } from "@/lib/api/schemas/sales";

/**
 * R5 (D-R5-8) — read-only previews of the backend's packing-slip and
 * shipping-label data, as structured documents instead of raw JSON. Only the
 * fields GET /sales-orders/{id}/packing-slip-data and /shipping-label-data
 * return are shown; a missing field reads "—". There is no print centre,
 * printer integration or auto-print — this is not a label generator.
 */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[13px]">
      <dt className="flex-none text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <>—</>;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  return <span className="mono">{zoned ? formatBusinessDateTime(iso) : <LocalDate iso={iso} isoInEnglish />}</span>;
}

function SlipDoc({ data, productName }: { data: PackingSlipData; productName: (id: number) => string }) {
  const t = useT();
  const statusLabel = useStatusLabel();
  return (
    <article aria-label={t("ship.packingSlip")} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <h3 className="wc-section-label mb-2">{t("ship.packingSlip")}</h3>
      <dl>
        <Field label={t("sales.colSoNumber")}>
          <span className="mono">{dash(data.so_number)}</span>
        </Field>
        <Field label={t("sales.colStatus")}>{statusLabel(data.status)}</Field>
        <Field label={t("sales.created")}>
          <When iso={data.created_at} />
        </Field>
        <Field label={t("sales.shipmentNumber")}>
          <span className="mono">{dash(data.shipment_number)}</span>
        </Field>
        <Field label={t("sales.customer")}>{dash(data.customer.name)}</Field>
        <Field label={t("ship.address")}>{dash(data.customer.address)}</Field>
        <Field label={t("ship.phone")}>
          <span className="mono">{dash(data.customer.phone)}</span>
        </Field>
      </dl>
      <h4 className="mt-3 text-[12px] font-semibold text-[var(--muted)]">{t("sales.items")}</h4>
      {data.items.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">—</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {data.items.map((it, i) => (
            <li key={`${it.product_id}-${i}`} className="flex items-baseline justify-between gap-3 py-[5px] text-[13px]">
              <span className="min-w-0">{productName(it.product_id)}</span>
              <QuantityDisplay value={it.quantity} className="font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function LabelDoc({ data }: { data: ShippingLabelData }) {
  const t = useT();
  const statusLabel = useStatusLabel();
  return (
    <article aria-label={t("ship.shippingLabel")} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <h3 className="wc-section-label mb-2">{t("ship.shippingLabel")}</h3>
      <div className="mb-2 rounded-[var(--r-sm)] bg-[var(--surface-sunken)] p-2 text-[13px]">
        <div className="text-[12px] text-[var(--muted)]">{t("ship.shipTo")}</div>
        <div className="font-semibold">{dash(data.ship_to.name)}</div>
        <div>{dash(data.ship_to.address)}</div>
        <div className="mono">{dash(data.ship_to.phone)}</div>
      </div>
      <dl>
        <Field label={t("sales.colSoNumber")}>
          <span className="mono">{dash(data.so_number)}</span>
        </Field>
        <Field label={t("sales.shipmentNumber")}>
          <span className="mono">{dash(data.shipment_number)}</span>
        </Field>
        <Field label={t("sales.colStatus")}>{statusLabel(data.status)}</Field>
        <Field label={t("sales.shippedAt")}>
          <When iso={data.shipped_at} />
        </Field>
        <Field label={t("orders.totalQuantity")}>
          <QuantityDisplay value={data.total_quantity} className="font-semibold" />
        </Field>
        <Field label={t("ship.orderBarcode")}>
          <span className="mono">{dash(data.order_barcode)}</span>
        </Field>
      </dl>
    </article>
  );
}

export function PrintPreview({
  orderId,
  enabled = true,
  productName,
}: {
  orderId: number;
  enabled?: boolean;
  /** resolves a product id to its name when the caller knows it; otherwise "Product #id" */
  productName?: (id: number) => string;
}) {
  const t = useT();
  const slip = usePackingSlipData(orderId, enabled);
  const label = useShippingLabelData(orderId, enabled);
  if (!enabled) return null;
  if (slip.isLoading || label.isLoading) return <LoadingState label={t("ship.loadingDocs")} />;
  if (slip.isError) return <ErrorState error={slip.error} onRetry={() => void slip.refetch()} compact />;
  if (label.isError) return <ErrorState error={label.error} onRetry={() => void label.refetch()} compact />;
  const name = productName ?? ((id: number) => t("receive.productFallback", { id }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[var(--muted)]">{t("ship.previewNote")}</p>
      {slip.data ? <SlipDoc data={slip.data} productName={name} /> : null}
      {label.data ? <LabelDoc data={label.data} /> : null}
    </div>
  );
}
