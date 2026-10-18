"use client";

import * as React from "react";
import Link from "next/link";
import { PackagePlus, Pencil, Power, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QuantityDisplay, MoneyDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { StockTriad } from "@/components/ui/stock-triad";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { isApiError } from "@/lib/api/errors";
import { useT } from "@/lib/i18n/client";
import { useAllCategories } from "@/lib/query/master-data";
import { useDeactivateProduct, useProduct, useRestoreProduct } from "@/lib/query/products";
import { canShowAction } from "@/lib/auth/permissions";
import { productErrorCopy, type ProductRow } from "@/lib/api/schemas/products";
import { isZero } from "@/lib/decimal";
import { formatIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProductEditForm } from "./edit-product";
import { ProductImagePanel } from "./product-image";
import { ProductCodes } from "./product-codes";
import { ProductBalances } from "./product-balances";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[12.5px] last:border-b-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="wc-section-label mb-2">{title}</h4>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3">{children}</div>
    </section>
  );
}

/* --------------------------------------------------- deactivate / restore === */

function ActivationDialog({
  product,
  open,
  onOpenChange,
  onDone,
}: {
  product: ProductRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const deactivate = useDeactivateProduct();
  const restore = useRestoreProduct();
  const pending = deactivate.isPending || restore.isPending;
  const [err, setErr] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (err) setErr(null);
  }

  const isActive = product.is_active;
  const run = () => {
    setErr(null);
    const m = isActive ? deactivate : restore;
    m.mutate(product.id, {
      onSuccess: () => {
        toast.success(t(isActive ? "product.deactivated" : "product.restored", { sku: product.sku }));
        onOpenChange(false);
        onDone();
      },
      onError: (error) => {
        if (isApiError(error)) setErr({ message: productErrorCopy(error.message) ?? error.userMessage, requestId: error.requestId });
        else setErr({ message: t("common.somethingWrong") });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t(isActive ? "product.deactivateTitle" : "product.restoreTitle", { sku: product.sku })}
        description={t(isActive ? "product.deactivateBody" : "product.restoreBody")}
      >
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
            <Button variant="ghost">{t("product.keepAsIs")}</Button>
          </DialogClose>
          <Button variant={isActive ? "danger" : "primary"} onClick={run} disabled={pending}>
            {pending ? t("product.working") : t(isActive ? "product.deactivateProduct" : "product.restoreProduct")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- body ==== */

function ProductDetailBody({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const t = useT();
  const { user } = useSession();
  const canWrite = canShowAction(user.role, "product:update");
  const categoriesQ = useAllCategories();
  const detailQ = useProduct(product.id);

  const [editing, setEditing] = React.useState(false);
  const [activationOpen, setActivationOpen] = React.useState(false);

  const categoryName =
    product.category_id == null
      ? "—"
      : categoriesQ.data?.find((c) => c.id === product.category_id)?.category_name ??
        t("product.categoryFallback", { id: product.category_id });
  const yesNo = (v: boolean) => t(v ? "product.yes" : "product.no");

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold">{t("product.editTitle", { sku: product.sku })}</div>
        </div>
        {detailQ.isLoading ? (
          <LoadingState label={t("product.loadingProduct")} />
        ) : detailQ.isError ? (
          <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />
        ) : detailQ.data ? (
          <ProductEditForm
            product={detailQ.data}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              void detailQ.refetch();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold">{product.product_name}</div>
          <div className="mono text-[12px] text-[var(--muted)]">{product.sku}</div>
        </div>
        <StatusBadge status={product.is_active ? "active" : "inactive"} />
      </div>

      <StockTriad
        onHand={product.owned_quantity}
        reserved={product.reserved_quantity}
        available={product.operational_available_quantity}
      />

      <div className="flex flex-wrap gap-2">
        {product.is_active ? (
          <Button variant="primary" asChild>
            <Link href={`/stock-in?product=${product.id}`}>
              <PackagePlus aria-hidden className="h-4 w-4" />
              {t("nav.stockIn")}
            </Link>
          </Button>
        ) : null}
        {canWrite ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden className="h-4 w-4" />
              {t("product.edit")}
            </Button>
            {product.is_active ? (
              <Button variant="danger" onClick={() => setActivationOpen(true)}>
                <Power aria-hidden className="h-4 w-4" />
                {t("product.deactivate")}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setActivationOpen(true)}>
                <RotateCcw aria-hidden className="h-4 w-4" />
                {t("product.restore")}
              </Button>
            )}
          </>
        ) : null}
      </div>

      <Section title={t("stock.lotsAndLocations")}>
        <ProductBalances productId={product.id} />
      </Section>

      <Section title={t("product.identity")}>
        <Row label={t("product.productName")}>{product.product_name}</Row>
        <Row label={t("product.sku")}><span className="mono">{product.sku}</span></Row>
        <Row label={t("product.barcode")}><span className="mono">{product.barcode ?? "—"}</span></Row>
        <Row label={t("product.category")}>{categoryName}</Row>
        <Row label={t("product.productId")}><span className="mono">{product.id}</span></Row>
        <Row label={t("product.active")}>{yesNo(product.is_active)}</Row>
        <Row label={t("product.unitPrice")}>{product.price ? <MoneyDisplay value={product.price} /> : "—"}</Row>
      </Section>

      <Section title={t("product.inventory")}>
        <Row label={t("product.owned")}><QuantityDisplay value={product.owned_quantity} /></Row>
        <Row label={t("product.operationalAvailable")}><QuantityDisplay value={product.operational_available_quantity} /></Row>
        <Row label={t("qty.reserved")}><QuantityDisplay value={product.reserved_quantity} /></Row>
        <Row label={t("product.expired")}>
          <QuantityDisplay value={product.expired_quantity} className={cn(!isZero(product.expired_quantity) && "text-[var(--danger)]")} />
        </Row>
        <Row label={t("product.nearExpiry")}>
          <QuantityDisplay value={product.near_expiry_quantity} className={cn(!isZero(product.near_expiry_quantity) && "text-[var(--warning)]")} />
        </Row>
        <Row label={t("stock.inTransit")}><QuantityDisplay value={product.transit_quantity} /></Row>
        <Row label={t("product.asOf")}><span className="mono">{formatIsoDate(product.as_of_date)}</span></Row>
      </Section>

      <Section title={t("product.tracking")}>
        <Row label={t("product.batchTracked")}>{yesNo(product.track_batch)}</Row>
        <Row label={t("product.expiryTracked")}>{yesNo(product.track_expiry)}</Row>
        <Row label={t("product.shelfLife")}>
          <span className="text-[var(--faint)]" title={t("product.notInContract")}>
            {t("product.notTracked")}
          </span>
        </Row>
      </Section>

      <Section title={t("product.thresholds")}>
        <Row label={t("product.minimumStock")}><QuantityDisplay value={product.minimum_stock} /></Row>
        <Row label={t("product.safetyStock")}><QuantityDisplay value={product.safety_stock} /></Row>
        <Row label={t("product.maximumStock")}><QuantityDisplay value={product.maximum_stock} /></Row>
        <p className="py-[7px] text-[11px] text-[var(--faint)]">{t("product.thresholdNote")}</p>
      </Section>

      <Section title={t("product.image")}>
        <div className="py-3">
          <ProductImagePanel product={product} canEdit={canWrite} />
        </div>
      </Section>

      <Section title={t("product.codes")}>
        <div className="py-3">
          <ProductCodes productId={product.id} hasBarcode={!!product.barcode} />
        </div>
      </Section>

      {canWrite ? (
        <ActivationDialog product={product} open={activationOpen} onOpenChange={setActivationOpen} onDone={onClose} />
      ) : null}
    </div>
  );
}

export function ProductDetailDrawer({
  product,
  open,
  onOpenChange,
}: {
  product: ProductRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={product ? product.product_name : t("product.product")}>
        {product ? (
          <ProductDetailBody product={product} onClose={() => onOpenChange(false)} />
        ) : (
          <EmptyState message={t("product.noneSelected")} />
        )}
      </DrawerContent>
    </Drawer>
  );
}
