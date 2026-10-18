"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StockTriad } from "@/components/ui/stock-triad";
import { Banner } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import { subtractDecimals } from "@/lib/decimal";
import { formatQty, formatQtyDelta } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { DICTIONARIES, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import { useAllProductStock, useProducts } from "@/lib/query/hooks";
import { useWarehouses } from "@/lib/query/warehouses";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import { useDebounced } from "@/lib/use-debounced";
import { isLooseKeyMismatch, requestIdOf as rid } from "@/lib/workflow/submission-errors";
import { useIdempotentSubmission } from "@/lib/workflow/use-idempotent-submission";
import { useCreateStockAdjustmentRequest } from "@/lib/query/stock-adjustment-requests";
import {
  ADJUSTMENT_REQUEST_ERROR_COPY,
  BATCH_REASON_CODES,
  batchAdjustmentErrorCopy,
  buildCreateAdjustmentRequestBody,
  compareQty,
  isQty,
  REASON_CODES,
  REASON_LABELS,
  type CreateAdjustmentRequestBody,
  type ReasonCode,
} from "@/lib/api/schemas/stock-adjustment-requests";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { Warehouse } from "@/lib/api/schemas/warehouses";
import { ExactBalancePicker, operationalBatchOptions, type BalanceOption } from "./exact-balance-picker";
import {
  adjustmentChecks,
  defaultBalancePrefill,
  pickBalancePatch,
  verifyBatchSelection,
  type SelectionState,
} from "./adjustment-request-logic";

/** The single persisted "line" (id 0) — mirrors Stock Out's session shape.
 * Product/strategy-equivalent fields never change once a submit is in
 * flight; "Start new request" explicitly abandons the draft and rotates
 * the Idempotency-Key, same discipline as every other save-once console. */
interface RequestLine {
  productId: number;
  sku: string;
  name: string;
  barcode: string | null;
  /** Phase 14D: batch-tracked products target one exact lot balance. */
  trackBatch: boolean;
  /** The chosen exact balance (batch products only). */
  warehouseId: number | null;
  locationId: number | null;
  batchId: number | null;
  batchExpired: boolean;
  /** On-hand of the chosen lot balance when it was picked (batch only);
   * absent on drafts saved before it existed, which then read as stale. */
  pickedOnHand?: string | null;
  reserved: string;
  observed: string;
  requested: string;
  reasonCode: ReasonCode;
  notes: string;
}

function buildPayload(lines: Record<number, RequestLine>): CreateAdjustmentRequestBody | null {
  const l = lines[0];
  if (!l) return null;
  if (l.trackBatch && l.batchId == null) return null;
  return buildCreateAdjustmentRequestBody({
    product_id: l.productId,
    ...(l.trackBatch && l.batchId != null && l.warehouseId != null && l.locationId != null
      ? { warehouse_id: l.warehouseId, location_id: l.locationId, batch_id: l.batchId }
      : {}),
    observed_quantity: l.observed,
    requested_quantity: l.requested,
    reason_code: l.reasonCode,
    notes: l.notes || undefined,
  });
}

/**
 * The shared validation rules (schema / logic modules) report English text;
 * this maps each known message to its dictionary key for display. The rules
 * themselves are untouched; an unknown message is shown as-is.
 */
function ruleMessage(message: string): { key: MessageKey; vars?: MessageVars } | null {
  if (message === "Quantity must be a number") return { key: "adjust.errQtyNumber" };
  if (message === "At most 3 decimal places") return { key: "receive.errQtyScale" };
  if (message.startsWith("Expiry write-off is only for a lot")) return { key: "adjust.errExpiryOnly" };
  const lower = /^(.*) must lower the quantity: requested must be below observed\.$/.exec(message);
  if (lower) {
    const code = (Object.keys(REASON_LABELS) as ReasonCode[]).find((c) => REASON_LABELS[c].label === lower[1]);
    if (code) return { key: "adjust.errMustLower", vars: { code } };
  }
  return null;
}

const FIELD_CLS =
  "h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:opacity-60 min-[768px]:text-[15px]";

function SelectionNotice({
  selection,
  onRetry,
  onUseRefreshed,
}: {
  selection: Exclude<SelectionState, { kind: "ok" }>;
  onRetry: () => void;
  onUseRefreshed: (option: BalanceOption) => void;
}) {
  const { t } = useI18n();
  if (selection.kind === "checking") {
    return (
      <p role="status" className="text-[12px] text-[var(--muted)]">
        {t("adjust.checkingBalance")}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-subtle)] p-3 text-[12px] text-[var(--danger)]"
    >
      {selection.kind === "error" ? (
        <>
          <span>{t("adjust.refreshFailed")}</span>
          <Button variant="secondary" size="sm" className="self-start" onClick={onRetry}>
            {t("adjust.refreshBalance")}
          </Button>
        </>
      ) : selection.kind === "missing" ? (
        <span>{t("adjust.lotMissing")}</span>
      ) : (
        <>
          <span>
            {t("adjust.lotChanged", { onHand: formatQty(selection.option.onHand), reserved: formatQty(selection.option.reserved) })}
          </span>
          <Button variant="secondary" size="sm" className="self-start" onClick={() => onUseRefreshed(selection.option)}>
            {t("adjust.useRefreshed")}
          </Button>
        </>
      )}
    </div>
  );
}

export function StockAdjustmentRequestForm() {
  const router = useRouter();
  const { t, locale } = useI18n();

  const draft = useIdempotentDraft<RequestLine, CreateAdjustmentRequestBody>({
    scope: "stock-adjustment-request:session",
    keyPrefix: "adjreq-",
    buildPayload,
  });
  const line = draft.lines[0] as RequestLine | undefined;

  const createMut = useCreateStockAdjustmentRequest();
  // a reused key whose stored request differs forces a new request (never silently re-keys)
  const submission = useIdempotentSubmission({ draft, mutate: createMut.mutate, isMismatch: isLooseKeyMismatch });
  const { mismatch } = submission;
  const [submitted, setSubmitted] = React.useState<{ referenceNumber: string | null; status: string } | null>(null);

  const phase: "form" | "submitted" = submitted ? "submitted" : "form";

  /* ------------------------------- product picker ------------------------ */
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const productQ = useProducts(
    debounced.trim().length >= 2 ? { page: 1, page_size: 20, search: debounced.trim() } : { page: 1, page_size: 20 },
  );
  const rowsById = React.useMemo(() => {
    const m = new Map<number, { id: number; sku: string; product_name: string; barcode?: string | null; track_batch: boolean }>();
    for (const p of productQ.data?.items ?? []) m.set(p.id, p);
    return m;
  }, [productQ.data]);
  const comboItems: ComboboxItem[] = (productQ.data?.items ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, label: p.product_name, sublabel: p.sku }));

  // Exact balances for the chosen product + the warehouse directory (names,
  // active flags), across EVERY page. B2: "observed" is always prefilled
  // from ON-HAND -- the value approval compares against -- never available.
  const stockQ = useAllProductStock(line?.productId ?? null);
  const directoryQ = useWarehouses(false);
  const balances: StockBalanceRow[] = React.useMemo(() => stockQ.data?.items ?? [], [stockQ.data]);
  const directory: Warehouse[] = React.useMemo(() => directoryQ.data ?? [], [directoryQ.data]);
  const batchOptions = React.useMemo(() => operationalBatchOptions(balances, directory), [balances, directory]);

  const pickProduct = (item: ComboboxItem | null) => {
    if (!item) {
      draft.removeLine(0);
      return;
    }
    const row = rowsById.get(item.id);
    if (!row) return;
    prefilledFor.current = null;
    draft.setLine(0, {
      productId: row.id,
      sku: row.sku,
      name: row.product_name,
      barcode: row.barcode ?? null,
      trackBatch: row.track_batch,
      warehouseId: null,
      locationId: null,
      batchId: null,
      batchExpired: false,
      pickedOnHand: null,
      reserved: "0",
      observed: "",
      requested: "",
      reasonCode: "CYCLE_COUNT_VARIANCE",
      notes: "",
    });
  };

  // Non-batch (unchanged default-storage path): prefill on-hand of the
  // unbatched balance at MAIN/DEFAULT -- an absent balance reads as 0.000,
  // exactly as approval treats it. Only fills an untouched field.
  const prefilledFor = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!line || line.trackBatch || line.observed !== "" || !stockQ.data || !directoryQ.data) return;
    if (prefilledFor.current === line.productId) return; // once per chosen product
    prefilledFor.current = line.productId;
    draft.setLine(0, defaultBalancePrefill(balances, directory));
  }, [line, stockQ.data, directoryQ.data, directory, balances, draft]);

  // B2: observed is the lot's on-hand, never available
  const pickBalance = (option: BalanceOption) => draft.setLine(0, pickBalancePatch(option, line?.reasonCode));

  const patch = (p: Partial<RequestLine>) => draft.setLine(0, p);

  // A batch selection is only submittable while it is verified against the
  // LATEST successful balance + directory load: same product, warehouse,
  // location and batch, still operational, and unchanged since it was
  // picked. Approval re-checks the live balance regardless.
  const selection = React.useMemo(
    (): SelectionState | null =>
      verifyBatchSelection(
        line,
        batchOptions,
        { isError: stockQ.isError, isFetching: stockQ.isFetching, loaded: !!stockQ.data },
        { isError: directoryQ.isError, isFetching: directoryQ.isFetching, loaded: !!directoryQ.data },
      ),
    [line, stockQ.isError, stockQ.data, stockQ.isFetching, directoryQ.isError, directoryQ.data, directoryQ.isFetching, batchOptions],
  );

  const { ruleError, belowReserved, observedError, requestedError, valid } = adjustmentChecks(line, selection);

  const reasonOptions: readonly ReasonCode[] = line?.trackBatch ? BATCH_REASON_CODES : REASON_CODES;
  const reasonText = (code: ReasonCode) => (locale === "th" ? REASON_LABELS[code].labelTh : REASON_LABELS[code].label);
  const localize = (message: string) => {
    const m = ruleMessage(message);
    if (!m) return message;
    const vars = m.vars?.code ? { reason: reasonText(m.vars.code as ReasonCode) } : m.vars;
    return t(m.key, vars);
  };

  // exact decimal difference; only once both sides are complete quantities
  const diff = line && isQty(line.observed) && isQty(line.requested) ? subtractDecimals(line.requested.trim(), line.observed.trim(), 3) : null;
  const diffSign = line && diff != null ? compareQty(line.requested, line.observed) : 0;

  // the selected exact lot balance (batch) — shown as an on hand / reserved / available triad
  const pickedOption = line?.trackBatch && selection?.kind === "ok" ? selection.option : null;

  const startNew = () => {
    draft.commitSuccess();
    setSubmitted(null);
    submission.clearMismatch();
    setTerm("");
  };

  const submit = () => {
    const body = draft.payload;
    if (!body || !valid || createMut.isPending) return;
    // success consumes the draft (fresh key for the next request)
    submission.submit(
      { body },
      {
        onSuccess: (res) => {
          setSubmitted({ referenceNumber: res.reference_number, status: res.status });
        },
        onError: (e, isMismatch) => {
          if (isMismatch) return;
          const backend = isApiError(e) ? e.message : "";
          const copy =
            ADJUSTMENT_REQUEST_ERROR_COPY[backend] ??
            batchAdjustmentErrorCopy(backend) ??
            (isApiError(e) ? e.userMessage : t("adjust.submitFallback"));
          toast.error(t("adjust.submitFailed"), { description: rid(e) ? `${copy} · ${t("task.requestRef", { id: rid(e)! })}` : copy });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <h1 className="flex items-center gap-2 text-[18px] font-semibold">
                <ClipboardList aria-hidden className="h-[18px] w-[18px] text-[var(--accent)]" />
                {t("adjust.formTitle")}
              </h1>
              <div className="text-[13px] text-[var(--muted)]">{t("adjust.formSubtitle")}</div>
            </div>
          </div>

          {phase === "form" ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                {t("adjust.product")}
                <Combobox
                  ariaLabel={t("adjust.searchProducts")}
                  value={line ? { id: line.productId, label: line.name, sublabel: line.sku } : null}
                  onChange={pickProduct}
                  onSearch={setTerm}
                  items={comboItems}
                  loading={productQ.isFetching}
                  placeholder={t("adjust.searchPlaceholder")}
                  emptyText={debounced.trim().length < 2 ? t("adjust.typeTwo") : t("adjust.noProducts")}
                />
              </label>

              {line ? (
                <>
                  {line.trackBatch ? (
                    <ExactBalancePicker
                      options={batchOptions}
                      loading={stockQ.isLoading || directoryQ.isLoading}
                      error={stockQ.isError || directoryQ.isError}
                      selectedKey={line.batchId != null ? `${line.warehouseId}:${line.locationId}:${line.batchId}` : null}
                      onPick={pickBalance}
                    />
                  ) : null}

                  {line.trackBatch && line.batchId == null ? null : (
                    <>
                      {pickedOption ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[12px] text-[var(--muted)]">{t("adjust.selectedBalance")}</span>
                          <StockTriad
                            compact
                            onHand={pickedOption.onHand}
                            reserved={pickedOption.reserved}
                            available={pickedOption.available}
                          />
                        </div>
                      ) : null}

                      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                        <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                          {t("adjust.observedQty")}
                          <input
                            inputMode="decimal"
                            className={FIELD_CLS}
                            value={line.observed}
                            onChange={(e) => patch({ observed: e.target.value })}
                            placeholder="0.000"
                            aria-invalid={observedError ? true : undefined}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                          {t("adjust.requestedQty")}
                          <input
                            inputMode="decimal"
                            className={FIELD_CLS}
                            value={line.requested}
                            onChange={(e) => patch({ requested: e.target.value })}
                            placeholder="0.000"
                            aria-invalid={requestedError ? true : undefined}
                          />
                        </label>
                      </div>
                      {observedError ? (
                        <p role="alert" className="text-[12px] text-[var(--danger)]">
                          {t("adjust.observedError", { msg: localize(observedError) })}
                        </p>
                      ) : null}
                      {requestedError ? (
                        <p role="alert" className="text-[12px] text-[var(--danger)]">
                          {t("adjust.requestedError", { msg: localize(requestedError) })}
                        </p>
                      ) : null}

                      {/* before/after preview — live, client-side, no network round-trip */}
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[13px]"
                        role="status"
                      >
                        <span className="text-[var(--muted)]">{t("adjust.observedToRequested")}</span>
                        <span className="font-semibold tabular-nums">
                          {line.observed ? <QuantityDisplay value={line.observed} /> : "—"}
                          {" → "}
                          {line.requested ? <QuantityDisplay value={line.requested} /> : "—"}
                          {diff != null ? (
                            <span
                              className={
                                diffSign < 0 ? "ml-2 text-[var(--danger)]" : diffSign > 0 ? "ml-2 text-[var(--success)]" : "ml-2 text-[var(--muted)]"
                              }
                            >
                              ({formatQtyDelta(diff)})
                            </span>
                          ) : null}
                        </span>
                      </div>

                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1 text-[12px] text-[var(--muted)]">{t("adjust.reason")}</legend>
                        {reasonOptions.map((code) => {
                          const copy = REASON_LABELS[code];
                          const active = line.reasonCode === code;
                          const disabled = code === "EXPIRY_WRITE_OFF" && !line.batchExpired;
                          return (
                            <button
                              key={code}
                              type="button"
                              disabled={disabled}
                              title={disabled ? t("adjust.expiryOnlyTitle") : undefined}
                              onClick={() => patch({ reasonCode: code })}
                              className={
                                "flex min-h-11 flex-col items-start gap-[2px] rounded-[var(--r-sm)] border px-3 py-2 text-left transition-colors disabled:opacity-60 " +
                                (active
                                  ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                                  : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--accent)]")
                              }
                              aria-pressed={active}
                            >
                              <span className="text-[14px] font-semibold">{locale === "th" ? copy.labelTh : copy.label}</span>
                              <span className="text-[12px] text-[var(--muted)]">{locale === "th" ? copy.label : copy.labelTh}</span>
                            </button>
                          );
                        })}
                      </fieldset>

                      {ruleError ? (
                        <p role="alert" className="text-[12px] text-[var(--danger)]">
                          {localize(ruleError)}
                        </p>
                      ) : null}
                      {belowReserved ? (
                        <p role="alert" className={`text-[12px] ${line.trackBatch ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>
                          {t("adjust.belowReserved", { reserved: formatQty(line.reserved) })}
                        </p>
                      ) : null}

                      <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                        {t(line.reasonCode === "OTHER" ? "adjust.noteRequired" : "adjust.noteOptional")}
                        <input
                          className={FIELD_CLS}
                          value={line.notes}
                          onChange={(e) => patch({ notes: e.target.value })}
                          maxLength={500}
                          placeholder={t("adjust.notePlaceholder")}
                        />
                      </label>

                      {selection && selection.kind !== "ok" ? (
                        <SelectionNotice
                          selection={selection}
                          onRetry={() => {
                            void stockQ.refetch();
                            void directoryQ.refetch();
                          }}
                          onUseRefreshed={pickBalance}
                        />
                      ) : null}

                      {mismatch ? (
                        <Banner
                          tone="danger"
                          title={t("adjust.mismatchTitle")}
                          actions={
                            <Button variant="secondary" size="sm" onClick={startNew}>
                              {t("adjust.startNew")}
                            </Button>
                          }
                        >
                          {t("adjust.mismatchBody")}
                        </Banner>
                      ) : null}

                      <Button variant="primary" className="h-11" disabled={!valid || createMut.isPending || mismatch} onClick={submit}>
                        {createMut.isPending ? t("receive.submitting") : t("adjust.submitRequest")}
                      </Button>
                    </>
                  )}
                  {createMut.isError && !mismatch ? (
                    <p className="text-[12px] text-[var(--danger)]">
                      {isApiError(createMut.error) ? createMut.error.userMessage : t("adjust.submitFailedShort")}{" "}
                      {rid(createMut.error) ? `· ${t("task.requestRef", { id: rid(createMut.error)! })}` : null} {t("adjust.pressSubmit")}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-5 text-center text-[13px] text-[var(--muted)]">
                  {t("adjust.pickProduct")}
                </p>
              )}
            </div>
          ) : null}

          {phase === "submitted" && submitted ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[var(--success-subtle)] p-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--success)]">
                <CheckCircle2 aria-hidden className="h-5 w-5" />
                {t("adjust.submittedTitle")}
              </div>
              <p className="text-[13px] text-[var(--foreground)]">
                {t("adjust.submittedBody", {
                  ref: submitted.referenceNumber ?? t("adjust.yourRequest"),
                  status: submitted.status in DICTIONARIES.en.status ? t(`status.${submitted.status}` as MessageKey) : submitted.status,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" className="h-11" onClick={startNew}>
                  {t("adjust.submitAnother")}
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => router.push("/stock-adjustments/mine")}>
                  {t("adjust.viewMine")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="wc-receive-side">
          <div className="rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-[12px]">
            <h2 className="wc-section-label mb-2">{t("adjust.howItWorks")}</h2>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[var(--muted)]">
              <li>{t("adjust.how1")}</li>
              <li>{t("adjust.how2")}</li>
              <li>{t("adjust.how3")}</li>
              <li>{t("adjust.how4")}</li>
            </ul>
          </div>
          {line ? (
            <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[12px] text-[var(--muted)]">
              <TriangleAlert aria-hidden className="h-3.5 w-3.5 flex-none" />
              {t("adjust.prefillNote")}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
