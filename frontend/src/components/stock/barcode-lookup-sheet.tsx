"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, PackagePlus, Plus, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { CameraBarcodeScanner } from "@/components/work/camera-barcode-scanner";
import { useBeep } from "@/components/work/use-beep";
import { useSession } from "@/components/session-provider";
import { canShowAction } from "@/lib/auth/permissions";
import { isApiError } from "@/lib/api/errors";
import { resolveBarcode } from "@/lib/query/sales";
import type { ScanResolve } from "@/lib/api/schemas/sales";
import type { ProductDetail } from "@/lib/api/schemas/products";
import { stockStatus } from "@/lib/stock-status";
import { useT } from "@/lib/i18n/client";
import { statusLabelKey } from "./stock-status-labels";
import { CreateProductDrawer } from "@/components/products/create-product";

/**
 * Stock page "Scan Barcode" — LOOKUP ONLY.
 *
 * Business rules this component enforces end to end:
 *  - a barcode scan never mutates stock, never creates a product by itself,
 *    and never starts a Stock In session; it only reads via the same
 *    read-only /scan/resolve?context=lookup endpoint Stock-In/Pick/Pack use.
 *  - "decoded, but Product Master has no match" is its OWN state — distinct
 *    from "could not read the barcode" and from "found" — never one generic
 *    error message for every case.
 *  - creating a Product Master from here still goes through the existing
 *    admin-only POST /products (RBAC is decided by the backend; the UI only
 *    hides the action it already knows will be refused).
 */
type Result =
  | { kind: "not_found"; barcode: string }
  | { kind: "found"; barcode: string; data: ScanResolve }
  | { kind: "error"; barcode: string; message: string }
  | { kind: "created"; barcode: string; product: ProductDetail };

export function StockScanButton({ onOpenDetail }: { onOpenDetail: (barcode: string) => void }) {
  const t = useT();
  const router = useRouter();
  const { user } = useSession();
  const canCreateProduct = canShowAction(user.role, "product:create");
  const { beepOk, beepBad } = useBeep();

  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  // Captured separately from `result` because opening Create closes the
  // lookup dialog (result -> null) in the same click.
  const [createBarcode, setCreateBarcode] = React.useState<string | undefined>(undefined);

  const handleDecode = React.useCallback(
    async (code: string) => {
      setCameraOpen(false);
      setResolving(true);
      try {
        const data = await resolveBarcode(code, "lookup");
        beepOk();
        setResult({ kind: "found", barcode: code, data });
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          beepBad();
          setResult({ kind: "not_found", barcode: code });
        } else {
          beepBad();
          setResult({
            kind: "error",
            barcode: code,
            message: isApiError(e) ? e.userMessage : t("lookup.readFailed"),
          });
        }
      } finally {
        setResolving(false);
      }
    },
    [beepOk, beepBad, t],
  );

  const close = () => setResult(null);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setCameraOpen(true)} disabled={resolving}>
        <ScanLine aria-hidden className="h-4 w-4" />
        {resolving ? t("lookup.lookingUp") : t("lookup.scanBarcode")}
      </Button>

      <CameraBarcodeScanner open={cameraOpen} onOpenChange={setCameraOpen} onDecode={(v) => void handleDecode(v)} />

      <Dialog open={!!result} onOpenChange={(v) => !v && close()}>
        <DialogContent title={t("lookup.title")}>
          {result?.kind === "found" ? (
            <FoundResult
              result={result}
              onOpenDetail={() => {
                close();
                onOpenDetail(result.barcode);
              }}
              onStockIn={() => {
                close();
                router.push(`/stock-in?product=${result.data.product.id}`);
              }}
            />
          ) : result?.kind === "not_found" ? (
            <NotFoundResult
              barcode={result.barcode}
              canCreate={canCreateProduct}
              onCreate={() => {
                setCreateBarcode(result.barcode);
                close();
                setCreateOpen(true);
              }}
            />
          ) : result?.kind === "created" ? (
            <CreatedResult
              product={result.product}
              onStockIn={() => {
                close();
                router.push(`/stock-in?product=${result.product.id}`);
              }}
            />
          ) : result?.kind === "error" ? (
            <ErrorResult message={result.message} />
          ) : null}
        </DialogContent>
      </Dialog>

      <CreateProductDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialBarcode={createBarcode}
        onCreated={(product) => setResult({ kind: "created", barcode: product.barcode ?? "", product })}
      />
    </>
  );
}

function FoundResult({
  result,
  onOpenDetail,
  onStockIn,
}: {
  result: Extract<Result, { kind: "found" }>;
  onOpenDetail: () => void;
  onStockIn: () => void;
}) {
  const t = useT();
  const { product } = result.data;
  const status = stockStatus({
    operational_available_quantity: product.operational_available_quantity,
    minimum_stock: product.minimum_stock,
    safety_stock: product.safety_stock,
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--success)]">
        <CheckCircle2 aria-hidden className="h-4 w-4" />
        {t("lookup.found")}
      </div>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]">
        <div className="font-semibold">{product.product_name}</div>
        <div className="mt-1 flex flex-col gap-1 text-[12px] text-[var(--muted)]">
          <span>
            {t("lookup.skuLabel")} <span className="mono text-[var(--foreground)]">{product.sku}</span>
          </span>
          <span>
            {t("lookup.barcodeLabel")} <span className="mono text-[var(--foreground)]">{result.barcode}</span>
          </span>
          <span>
            {t("lookup.availableLabel")} <QuantityDisplay value={product.operational_available_quantity} className="font-medium text-[var(--foreground)]" />
          </span>
          <span className="mt-1">
            <StatusBadge tone={status.tone} label={t(statusLabelKey(status.key))} />
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onOpenDetail}>
          {t("lookup.viewDetail")}
        </Button>
        <Button variant="primary" onClick={onStockIn}>
          <PackagePlus aria-hidden className="h-4 w-4" />
          {t("lookup.stockIn")}
        </Button>
      </div>
    </div>
  );
}

function NotFoundResult({
  barcode,
  canCreate,
  onCreate,
}: {
  barcode: string;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--warning)]">
        <AlertTriangle aria-hidden className="h-4 w-4" />
        {t("lookup.notFound")}
      </div>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]">
        <span className="text-[var(--muted)]">{t("lookup.barcodeLabel")} </span>
        <span className="mono select-all">{barcode}</span>
        <p className="mt-2 text-[12px] text-[var(--muted)]">{t("lookup.notLinked")}</p>
      </div>
      <div className="flex justify-end">
        {canCreate ? (
          <Button variant="primary" onClick={onCreate}>
            <Plus aria-hidden className="h-4 w-4" />
            {t("lookup.createProduct")}
          </Button>
        ) : (
          <p className="text-[13px] text-[var(--muted)]">{t("lookup.askAdmin")}</p>
        )}
      </div>
    </div>
  );
}

function CreatedResult({ product, onStockIn }: { product: ProductDetail; onStockIn: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--success)]">
        <CheckCircle2 aria-hidden className="h-4 w-4" />
        {t("lookup.created")}
      </div>
      <p className="text-[12.5px] text-[var(--muted)]">
        {product.product_name} (<span className="mono">{product.sku}</span>) {t("lookup.canStockIn")}
      </p>
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t("lookup.close")}</Button>
        </DialogClose>
        <Button variant="primary" onClick={onStockIn}>
          <PackagePlus aria-hidden className="h-4 w-4" />
          {t("lookup.receiveIt")}
        </Button>
      </div>
    </div>
  );
}

function ErrorResult({ message }: { message: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--danger)]">
        <AlertTriangle aria-hidden className="h-4 w-4" />
        {t("lookup.error")}
      </div>
      <p className="text-[12.5px] text-[var(--muted)]">{message}</p>
      <div className="flex justify-end">
        <DialogClose asChild>
          <Button variant="ghost">{t("lookup.close")}</Button>
        </DialogClose>
      </div>
    </div>
  );
}
