"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, ClipboardList, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { isApiError } from "@/lib/api/errors";
import { useProducts } from "@/lib/query/hooks";
import { resolveBarcode } from "@/lib/query/sales";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import { useCreateStockAdjustmentRequest } from "@/lib/query/stock-adjustment-requests";
import {
  ADJUSTMENT_REQUEST_ERROR_COPY,
  buildCreateAdjustmentRequestBody,
  createAdjustmentRequestInput,
  REASON_CODES,
  REASON_LABELS,
  type CreateAdjustmentRequestBody,
  type ReasonCode,
} from "@/lib/api/schemas/stock-adjustment-requests";

/** The single persisted "line" (id 0) — mirrors Stock Out's session shape.
 * Product/strategy-equivalent fields never change once a submit is in
 * flight; "Start new request" explicitly abandons the draft and rotates
 * the Idempotency-Key, same discipline as every other save-once console. */
interface RequestLine {
  productId: number;
  sku: string;
  name: string;
  barcode: string | null;
  observed: string;
  requested: string;
  reasonCode: ReasonCode;
  notes: string;
}

function buildPayload(lines: Record<number, RequestLine>): CreateAdjustmentRequestBody | null {
  const l = lines[0];
  if (!l) return null;
  return buildCreateAdjustmentRequestBody({
    product_id: l.productId,
    observed_quantity: l.observed,
    requested_quantity: l.requested,
    reason_code: l.reasonCode,
    notes: l.notes || undefined,
  });
}

const FIELD_CLS =
  "h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-60";

function rid(e: unknown): string | undefined {
  return isApiError(e) ? e.requestId : undefined;
}

export function StockAdjustmentRequestForm() {
  const router = useRouter();

  const draft = useIdempotentDraft<RequestLine, CreateAdjustmentRequestBody>({
    scope: "stock-adjustment-request:session",
    keyPrefix: "adjreq-",
    buildPayload,
  });
  const line = draft.lines[0] as RequestLine | undefined;

  const createMut = useCreateStockAdjustmentRequest();
  const [submitted, setSubmitted] = React.useState<{ referenceNumber: string | null; status: string } | null>(null);
  const [mismatch, setMismatch] = React.useState(false);

  const phase: "form" | "submitted" = submitted ? "submitted" : "form";

  /* ------------------------------- product picker ------------------------ */
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const productQ = useProducts(
    debounced.trim().length >= 2 ? { page: 1, page_size: 20, search: debounced.trim() } : { page: 1, page_size: 20 },
  );
  const rowsById = React.useMemo(() => {
    const m = new Map<number, { id: number; sku: string; product_name: string; barcode?: string | null }>();
    for (const p of productQ.data?.items ?? []) m.set(p.id, p);
    return m;
  }, [productQ.data]);
  const comboItems: ComboboxItem[] = (productQ.data?.items ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, label: p.product_name, sublabel: p.sku }));

  const fetchAvailability = React.useCallback(async (barcode: string | null): Promise<string | null> => {
    if (!barcode) return null;
    try {
      const res = await resolveBarcode(barcode, "lookup");
      return res.product.operational_available_quantity;
    } catch {
      return null; // advisory prefill only — the operator can always correct it
    }
  }, []);

  // Same async-race guard as Stock Out's pickProduct: a ref token, never a
  // closed-over re-read of draft state inside the .then().
  const pickToken = React.useRef(0);

  const pickProduct = (item: ComboboxItem | null) => {
    if (!item) {
      draft.removeLine(0);
      return;
    }
    const row = rowsById.get(item.id);
    if (!row) return;
    const token = ++pickToken.current;
    draft.setLine(0, {
      productId: row.id,
      sku: row.sku,
      name: row.product_name,
      barcode: row.barcode ?? null,
      observed: "",
      requested: "",
      reasonCode: "CYCLE_COUNT_VARIANCE",
      notes: "",
    });
    void fetchAvailability(row.barcode ?? null).then((qty) => {
      if (pickToken.current === token && qty != null) draft.setLine(0, { observed: qty });
    });
  };

  const patch = (p: Partial<RequestLine>) => draft.setLine(0, p);

  const valid = React.useMemo(() => {
    if (!line) return false;
    return createAdjustmentRequestInput.safeParse({
      product_id: line.productId,
      observed_quantity: line.observed,
      requested_quantity: line.requested,
      reason_code: line.reasonCode,
      notes: line.notes || undefined,
    }).success;
  }, [line]);

  const diff =
    line && line.observed && line.requested && !Number.isNaN(Number(line.observed)) && !Number.isNaN(Number(line.requested))
      ? Number(line.requested) - Number(line.observed)
      : null;

  const startNew = () => {
    draft.commitSuccess();
    setSubmitted(null);
    setMismatch(false);
    setTerm("");
  };

  const submit = () => {
    const body = draft.payload;
    if (!body || createMut.isPending) return;
    createMut.mutate(
      { body, idempotencyKey: draft.idempotencyKey },
      {
        onSuccess: (res) => {
          setSubmitted({ referenceNumber: res.reference_number, status: res.status });
          setMismatch(false);
          draft.commitSuccess();
        },
        onError: (e) => {
          if (isApiError(e) && e.status === 409 && /different payload/i.test(e.message)) {
            setMismatch(true);
            return;
          }
          const backend = isApiError(e) ? e.message : "";
          const copy =
            ADJUSTMENT_REQUEST_ERROR_COPY[backend] ??
            (isApiError(e) ? e.userMessage : "The request could not be submitted.");
          toast.error("Submit failed", { description: rid(e) ? `${copy} · Request ${rid(e)}` : copy });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex items-center gap-1 text-[12px] text-[var(--muted)]" aria-label="Breadcrumb">
        <Link href="/stock-adjustments/mine" className="font-medium hover:text-[var(--foreground)]">
          Stock Adjustments
        </Link>
        <ChevronRight aria-hidden className="h-3 w-3" />
        <span className="text-[var(--foreground)]">New request</span>
      </nav>

      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <div className="flex items-center gap-2 text-[16px] font-bold">
                <ClipboardList aria-hidden className="h-[18px] w-[18px] text-[var(--accent)]" />
                New stock adjustment request
              </div>
              <div className="text-[12px] text-[var(--muted)]">
                Submitting never changes inventory — an admin reviews and decides.
              </div>
            </div>
          </div>

          {phase === "form" ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                Product
                <Combobox
                  ariaLabel="Search products"
                  value={line ? { id: line.productId, label: line.name, sublabel: line.sku } : null}
                  onChange={pickProduct}
                  onSearch={setTerm}
                  items={comboItems}
                  loading={productQ.isFetching}
                  placeholder="Search products by name or SKU…"
                  emptyText={debounced.trim().length < 2 ? "Type at least 2 characters" : "No products match"}
                />
              </label>

              {line ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      Observed quantity
                      <input
                        inputMode="decimal"
                        className={FIELD_CLS}
                        value={line.observed}
                        onChange={(e) => patch({ observed: e.target.value })}
                        placeholder="0.000"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      Requested (corrected) quantity
                      <input
                        inputMode="decimal"
                        className={FIELD_CLS}
                        value={line.requested}
                        onChange={(e) => patch({ requested: e.target.value })}
                        placeholder="0.000"
                      />
                    </label>
                  </div>

                  {/* before/after preview — live, client-side, no network round-trip */}
                  <div
                    className="flex items-center justify-between rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--sunken)] px-3 py-2 text-[13px]"
                    role="status"
                  >
                    <span className="text-[var(--muted)]">Observed → Requested</span>
                    <span className="font-semibold tabular-nums">
                      {line.observed ? <QuantityDisplay value={line.observed} /> : "—"}
                      {" → "}
                      {line.requested ? <QuantityDisplay value={line.requested} /> : "—"}
                      {diff != null ? (
                        <span className={diff < 0 ? "ml-2 text-[var(--danger)]" : "ml-2 text-[var(--success)]"}>
                          ({diff > 0 ? "+" : ""}
                          {diff.toFixed(3)})
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-[12px] text-[var(--muted)]">Reason</legend>
                    {REASON_CODES.map((code) => {
                      const copy = REASON_LABELS[code];
                      const active = line.reasonCode === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => patch({ reasonCode: code })}
                          className={
                            "flex flex-col items-start gap-[2px] rounded-[var(--r-sm)] border px-3 py-2 text-left transition-colors " +
                            (active
                              ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                              : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--accent)]")
                          }
                          aria-pressed={active}
                        >
                          <span className="text-[13.5px] font-semibold">{copy.labelTh}</span>
                          <span className="text-[11px] text-[var(--muted)]">{copy.label}</span>
                        </button>
                      );
                    })}
                  </fieldset>

                  <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                    Note {line.reasonCode === "OTHER" ? "(required)" : "(optional)"}
                    <input
                      className={FIELD_CLS}
                      value={line.notes}
                      onChange={(e) => patch({ notes: e.target.value })}
                      maxLength={500}
                      placeholder="e.g. counted 38 during weekly stocktake"
                    />
                  </label>

                  {mismatch ? (
                    <div className="flex flex-col gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-subtle)] p-3 text-[12px] text-[var(--danger)]">
                      <span className="font-semibold">This draft can no longer be submitted.</span>
                      <span>Its Idempotency-Key was already used for a different request. Start a new one.</span>
                      <Button variant="secondary" size="sm" className="self-start" onClick={startNew}>
                        Start new request
                      </Button>
                    </div>
                  ) : null}

                  <Button
                    variant="primary"
                    className="h-11"
                    disabled={!valid || createMut.isPending || mismatch}
                    onClick={submit}
                  >
                    {createMut.isPending ? "Submitting…" : "Submit request"}
                  </Button>
                  {createMut.isError && !mismatch ? (
                    <p className="text-[12px] text-[var(--danger)]">
                      {isApiError(createMut.error) ? createMut.error.userMessage : "Submit failed."}{" "}
                      {rid(createMut.error) ? `· Request ${rid(createMut.error)}` : null} Press Submit to retry.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-5 text-center text-[12.5px] text-[var(--muted)]">
                  Pick the product you counted or inspected.
                </p>
              )}
            </div>
          ) : null}

          {phase === "submitted" && submitted ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[var(--success-subtle)] p-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--success)]">
                <CheckCircle2 aria-hidden className="h-5 w-5" />
                Request submitted
              </div>
              <p className="text-[12.5px] text-[var(--foreground)]">
                {submitted.referenceNumber ?? "Your request"} is {submitted.status.toLowerCase()}. No stock has
                changed — an admin will review it.
              </p>
              <div className="flex gap-2">
                <Button variant="primary" className="h-11" onClick={startNew}>
                  Submit another
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => router.push("/stock-adjustments/mine")}>
                  View my requests
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="wc-receive-side">
          <div className="rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-[12px]">
            <h3 className="wc-section-label mb-2">How it works</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[var(--muted)]">
              <li>Submitting never changes inventory — only an admin&apos;s approval does.</li>
              <li>Multiple pending requests for the same product are allowed; approval checks the live balance.</li>
              <li>You can cancel your own request any time before it&apos;s decided.</li>
              <li>Batch-tracked products can&apos;t be corrected this way yet — use Batches or Stock Out instead.</li>
            </ul>
          </div>
          {line ? (
            <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--sunken)] px-3 py-2 text-[11.5px] text-[var(--muted)]">
              <TriangleAlert aria-hidden className="h-3.5 w-3.5 flex-none" />
              Observed quantity is prefilled from the last known availability — correct it if your physical count
              differs.
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
