"use client";

import * as React from "react";
import { ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/errors";
import {
  IMAGE_ACCEPT_ATTR,
  IMAGE_MAX_BYTES,
  productErrorCopy,
  validateImageFile,
} from "@/lib/api/schemas/products";
import { useUploadProductImage } from "@/lib/query/products";

/** Minimal shape both ProductRow and ProductDetail satisfy. */
interface ImageProduct {
  id: number;
  product_name: string;
  image_url: string | null | undefined;
}

/**
 * The backend stores `image_url` as `/uploads/products/product_<id>.<ext>`
 * (server root, outside /api/v1). We render it through the BFF passthrough so
 * the browser never talks to FastAPI directly.
 */
function imageSrc(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const m = /uploads\/products\/([A-Za-z0-9._-]+)$/.exec(imageUrl);
  return m ? `/api/bff/uploads/products/${m[1]}` : null;
}

export function ProductImagePanel({
  product,
  canEdit,
}: {
  product: ImageProduct;
  canEdit: boolean;
}) {
  const upload = useUploadProductImage();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  // image_url returned by a successful upload — the drawer's `product` prop is
  // a stale list row, so we track the fresh value locally too.
  const [uploadedUrl, setUploadedUrl] = React.useState<string | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<{ message: string; requestId?: string } | null>(null);

  React.useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const stored = imageSrc(uploadedUrl ?? product.image_url);
  const shown = preview ?? stored;
  const hasImage = !!(uploadedUrl ?? product.image_url);

  const pick = (file: File | undefined) => {
    setServerError(null);
    setLocalError(null);
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      setLocalError(problem);
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    upload.mutate(
      { id: product.id, file },
      {
        onSuccess: (data) => {
          toast.success("Product image updated");
          setUploadedUrl(data.image_url ?? null);
          setPreview((p) => {
            if (p) URL.revokeObjectURL(p);
            return null;
          });
        },
        onError: (error) => {
          setPreview((p) => {
            if (p) URL.revokeObjectURL(p);
            return null;
          });
          if (isApiError(error)) {
            const msg =
              error.status === 413
                ? "Image is too large. The limit is 5 MiB."
                : productErrorCopy(error.message) ?? error.userMessage;
            setServerError({ message: msg, requestId: error.requestId });
          } else {
            setServerError({ message: "Upload failed." });
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid h-40 w-full place-items-center overflow-hidden rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)]">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={`${product.product_name} image`} className="h-full w-full object-contain" />
        ) : (
          <span className="text-[12px] text-[var(--faint)]">No image</span>
        )}
      </div>

      {canEdit ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            className="sr-only"
            aria-label="Choose a product image"
            onChange={(e) => pick(e.currentTarget.files?.[0])}
          />
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="self-start"
          >
            {upload.isPending ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <ImageUp aria-hidden className="h-4 w-4" />
            )}
            {upload.isPending ? "Uploading…" : hasImage ? "Replace image" : "Upload image"}
          </Button>
          <p className="text-[11px] text-[var(--faint)]">
            JPEG, PNG or WebP · up to {Math.round(IMAGE_MAX_BYTES / (1024 * 1024))} MiB. The backend
            re-verifies the file and names it itself.
          </p>
          {localError ? <p role="alert" className="text-[11px] text-[var(--danger)]">{localError}</p> : null}
          {serverError ? (
            <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[11px] text-[var(--danger)]">
              {serverError.message}
              {serverError.requestId ? (
                <span className="mt-1 block text-[var(--muted)]">
                  Request ID: <span className="mono select-all">{serverError.requestId}</span>
                </span>
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
