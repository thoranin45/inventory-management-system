"use client";

import * as React from "react";
import Link from "next/link";
import { PackagePlus, PanelRightOpen, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { StockTriad } from "@/components/ui/stock-triad";
import { ProductBalances } from "@/components/products/product-balances";
import { useT } from "@/lib/i18n/client";
import type { ProductRow } from "@/lib/api/schemas/products";
import { stockStatus } from "@/lib/stock-status";
import { statusLabelKey } from "./stock-status-labels";

/**
 * Concept B desktop detail pane (split list/detail, ≥1200 px): the selected
 * product's status, On hand / Reserved / Available and its lots and locations
 * (verified pages, load more on request). The full product record, editing and
 * deactivation stay in the existing detail drawer ("All details").
 */
export function StockDetailPane({ product, onOpenDetails }: { product: ProductRow | null; onOpenDetails: () => void }) {
  const t = useT();
  if (!product) {
    return (
      <section className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 text-[13px] text-[var(--muted)]">
        {t("stock.selectHint")}
      </section>
    );
  }
  const s = stockStatus(product);
  return (
    <section
      aria-label={product.product_name}
      className="sticky top-4 flex max-h-[calc(100dvh-120px)] flex-col gap-4 overflow-y-auto rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{product.product_name}</h2>
          <div className="mono text-[12px] text-[var(--muted)]">
            {product.sku} · {product.barcode ?? "—"}
          </div>
        </div>
        <StatusBadge tone={s.tone} label={t(statusLabelKey(s.key))} />
      </div>
      <StockTriad onHand={product.owned_quantity} reserved={product.reserved_quantity} available={product.operational_available_quantity} />
      <div>
        <h3 className="wc-section-label mb-1">{t("stock.lotsAndLocations")}</h3>
        <ProductBalances productId={product.id} />
      </div>
      <div className="flex flex-wrap gap-2">
        {product.is_active ? (
          <Button variant="primary" size="sm" asChild>
            <Link href={`/stock-in?product=${product.id}`}>
              <PackagePlus aria-hidden className="h-4 w-4" />
              {t("nav.stockIn")}
            </Link>
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" asChild>
          <Link href="/stock-adjustments/new">
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {t("stock.adjustLot")}
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenDetails}>
          <PanelRightOpen aria-hidden className="h-4 w-4" />
          {t("stock.allDetails")}
        </Button>
      </div>
    </section>
  );
}
