"use client";

import * as React from "react";
import { Barcode, FileText, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { bffBinary } from "@/lib/api/binary";
import { isApiError } from "@/lib/api/errors";

type CodeKind = "barcode" | "qrcode" | "label";

const ENDPOINT: Record<CodeKind, (id: number) => string> = {
  barcode: (id) => `/api/bff/codes/products/${id}/barcode`,
  qrcode: (id) => `/api/bff/codes/products/${id}/qrcode`,
  label: (id) => `/api/bff/labels/product/${id}`,
};

/**
 * Opens backend-generated code artefacts. The frontend never draws a barcode
 * or QR itself — it previews the PNG the backend returns and can open the
 * label PDF in a new tab for printing.
 */
export function ProductCodes({ productId, hasBarcode }: { productId: number; hasBarcode: boolean }) {
  const [busy, setBusy] = React.useState<CodeKind | null>(null);
  const [previews, setPreviews] = React.useState<Partial<Record<"barcode" | "qrcode", string>>>({});

  React.useEffect(
    () => () => {
      Object.values(previews).forEach((u) => u && URL.revokeObjectURL(u));
    },
    [previews],
  );

  const run = async (kind: CodeKind) => {
    setBusy(kind);
    try {
      const { blob } = await bffBinary(ENDPOINT[kind](productId));
      const url = URL.createObjectURL(blob);
      if (kind === "label") {
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        setPreviews((p) => {
          const old = p[kind];
          if (old) URL.revokeObjectURL(old);
          return { ...p, [kind]: url };
        });
      }
    } catch (error) {
      const msg = isApiError(error)
        ? error.status === 404 && kind !== "label"
          ? "This product has no barcode yet — add one first."
          : error.userMessage
        : "Could not generate that.";
      const rid = isApiError(error) ? error.requestId : undefined;
      toast.error("Code generation failed", { description: rid ? `${msg} · Request ${rid}` : msg });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => run("barcode")} disabled={busy !== null || !hasBarcode}>
          {busy === "barcode" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Barcode aria-hidden className="h-4 w-4" />}
          View barcode
        </Button>
        <Button variant="secondary" onClick={() => run("qrcode")} disabled={busy !== null}>
          {busy === "qrcode" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <QrCode aria-hidden className="h-4 w-4" />}
          View QR
        </Button>
        <Button variant="secondary" onClick={() => run("label")} disabled={busy !== null}>
          {busy === "label" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <FileText aria-hidden className="h-4 w-4" />}
          Open label (PDF)
        </Button>
      </div>

      {!hasBarcode ? (
        <p className="text-[11px] text-[var(--faint)]">Add a barcode to this product to enable barcode output.</p>
      ) : null}

      {(previews.barcode || previews.qrcode) && (
        <div className="flex flex-wrap gap-4">
          {previews.barcode ? (
            <figure className="flex flex-col items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews.barcode} alt="Product barcode" className="max-h-24 rounded border border-[var(--border)] bg-white p-1" />
              <figcaption className="text-[10px] text-[var(--faint)]">Barcode (PNG)</figcaption>
            </figure>
          ) : null}
          {previews.qrcode ? (
            <figure className="flex flex-col items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews.qrcode} alt="Product QR code" className="max-h-24 rounded border border-[var(--border)] bg-white p-1" />
              <figcaption className="text-[10px] text-[var(--faint)]">QR (PNG)</figcaption>
            </figure>
          ) : null}
        </div>
      )}
    </div>
  );
}
