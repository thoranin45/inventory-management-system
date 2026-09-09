"use client";

import * as React from "react";
import { Pencil, Power, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { QuantityDisplay, MoneyDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { isApiError } from "@/lib/api/errors";
import { useProductStock } from "@/lib/query/hooks";
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
        toast.success(isActive ? `${product.sku} deactivated` : `${product.sku} restored`);
        onOpenChange(false);
        onDone();
      },
      onError: (error) => {
        if (isApiError(error)) setErr({ message: productErrorCopy(error.message) ?? error.userMessage, requestId: error.requestId });
        else setErr({ message: "Something went wrong." });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isActive ? `Deactivate ${product.sku}?` : `Restore ${product.sku}?`}
        description={
          isActive
            ? "The product is hidden from the active catalogue and can't be added to new orders. Its stock, batches and history stay intact. You can restore it later."
            : "The product returns to the active catalogue. Existing stock and history are unchanged."
        }
      >
        {err ? (
          <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
            {err.message}
            {err.requestId ? (
              <span className="mt-1 block text-[11px] text-[var(--muted)]">
                Request ID: <span className="mono select-all">{err.requestId}</span>
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="mt-1 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Keep as is</Button>
          </DialogClose>
          <Button variant={isActive ? "danger" : "primary"} onClick={run} disabled={pending}>
            {pending ? "Working…" : isActive ? "Deactivate product" : "Restore product"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- body ==== */

function ProductDetailBody({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const { user } = useSession();
  const canWrite = canShowAction(user.role, "product:update");
  const stock = useProductStock(product.id);
  const categoriesQ = useAllCategories();
  const detailQ = useProduct(product.id);

  const [editing, setEditing] = React.useState(false);
  const [activationOpen, setActivationOpen] = React.useState(false);

  const categoryName =
    product.category_id == null
      ? "—"
      : categoriesQ.data?.find((c) => c.id === product.category_id)?.category_name ?? `Category #${product.category_id}`;

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold">Edit {product.sku}</div>
        </div>
        {detailQ.isLoading ? (
          <LoadingState label="Loading product…" />
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
        <StatusBadge tone={product.is_active ? "success" : "neutral"} label={product.is_active ? "Active" : "Inactive"} />
      </div>

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="h-4 w-4" />
            Edit
          </Button>
          {product.is_active ? (
            <Button variant="danger" onClick={() => setActivationOpen(true)}>
              <Power aria-hidden className="h-4 w-4" />
              Deactivate
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setActivationOpen(true)}>
              <RotateCcw aria-hidden className="h-4 w-4" />
              Restore
            </Button>
          )}
        </div>
      ) : null}

      <Section title="Identity">
        <Row label="Product name">{product.product_name}</Row>
        <Row label="SKU"><span className="mono">{product.sku}</span></Row>
        <Row label="Barcode"><span className="mono">{product.barcode ?? "—"}</span></Row>
        <Row label="Category">{categoryName}</Row>
        <Row label="Product ID"><span className="mono">{product.id}</span></Row>
        <Row label="Active">{product.is_active ? "Yes" : "No"}</Row>
        <Row label="Unit price">{product.price ? <MoneyDisplay value={product.price} /> : "—"}</Row>
      </Section>

      <Section title="Inventory">
        <Row label="Owned (stock_qty)"><QuantityDisplay value={product.owned_quantity} /></Row>
        <Row label="Operational available"><QuantityDisplay value={product.operational_available_quantity} /></Row>
        <Row label="Reserved"><QuantityDisplay value={product.reserved_quantity} /></Row>
        <Row label="Expired">
          <QuantityDisplay value={product.expired_quantity} className={cn(!isZero(product.expired_quantity) && "text-[var(--danger)]")} />
        </Row>
        <Row label="Near expiry (≤ 90 days)">
          <QuantityDisplay value={product.near_expiry_quantity} className={cn(!isZero(product.near_expiry_quantity) && "text-[var(--warning)]")} />
        </Row>
        <Row label="In transit"><QuantityDisplay value={product.transit_quantity} /></Row>
        <Row label="As of"><span className="mono">{formatIsoDate(product.as_of_date)}</span></Row>
      </Section>

      <Section title="Tracking">
        <Row label="Batch tracked">{product.track_batch ? "Yes" : "No"}</Row>
        <Row label="Expiry tracked">{product.track_expiry ? "Yes" : "No"}</Row>
        <Row label="Shelf-life days">
          <span className="text-[var(--faint)]" title="Not part of the live backend contract">
            not tracked
          </span>
        </Row>
      </Section>

      <Section title="Stock thresholds">
        <Row label="Minimum stock"><QuantityDisplay value={product.minimum_stock} /></Row>
        <Row label="Safety stock"><QuantityDisplay value={product.safety_stock} /></Row>
        <Row label="Maximum stock"><QuantityDisplay value={product.maximum_stock} /></Row>
        <p className="py-[7px] text-[11px] text-[var(--faint)]">
          Operational low-stock threshold = safety stock if &gt; 0, else minimum stock, else the
          backend default of 10. These values are read-only — no endpoint updates them.
        </p>
      </Section>

      <Section title="Image">
        <div className="py-3">
          <ProductImagePanel product={product} canEdit={canWrite} />
        </div>
      </Section>

      <Section title="Codes &amp; labels">
        <div className="py-3">
          <ProductCodes productId={product.id} hasBarcode={!!product.barcode} />
        </div>
      </Section>

      <Section title="Batches &amp; locations">
        {stock.isLoading ? (
          <LoadingState />
        ) : stock.isError ? (
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} compact className="my-3" />
        ) : !stock.data || stock.data.items.length === 0 ? (
          <div className="py-4 text-[12px] text-[var(--muted)]">No stock-balance records for this product.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {stock.data.items.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-[9px] text-[12px]">
                <span className="mono text-[var(--muted)]">
                  wh {b.warehouse_id ?? "—"} · loc {b.location_id ?? "—"} · batch {b.batch_id ?? "—"}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <span>on-hand <QuantityDisplay value={b.on_hand_qty} className="font-medium" /></span>
                  <span>avail <QuantityDisplay value={b.available_qty} className="font-medium" /></span>
                  <ExpiryBadge days={b.days_to_expiry} isoDate={b.batch_expiry_date} />
                </span>
              </div>
            ))}
          </div>
        )}
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
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={product ? product.product_name : "Product"}>
        {product ? (
          <ProductDetailBody product={product} onClose={() => onOpenChange(false)} />
        ) : (
          <EmptyState message="No product selected." />
        )}
      </DrawerContent>
    </Drawer>
  );
}
