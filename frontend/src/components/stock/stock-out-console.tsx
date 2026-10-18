"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, BookOpen, Camera, PackageMinus, ScanLine, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { QuantityChange, QuantityDisplay } from "@/components/ui/quantity-display";
import { ReviewCell, ReviewSheet } from "@/components/ui/review-sheet";
import { Banner } from "@/components/ui/states";
import { StepIndicator } from "@/components/ui/step-indicator";
import { StockTriad } from "@/components/ui/stock-triad";
import { CameraBarcodeScanner } from "@/components/work/camera-barcode-scanner";
import { useBeep } from "@/components/work/use-beep";
import { isApiError } from "@/lib/api/errors";
import { subtractDecimals } from "@/lib/decimal";
import { formatQtyDelta } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useProducts } from "@/lib/query/hooks";
import { resolveBarcode } from "@/lib/query/sales";
import { useSaveStockOutSession } from "@/lib/query/stock";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import { useDebounced } from "@/lib/use-debounced";
import type { TrailEntry } from "@/lib/workflow/scan-count";
import { isLooseKeyMismatch, requestIdOf as rid } from "@/lib/workflow/submission-errors";
import { useIdempotentSubmission } from "@/lib/workflow/use-idempotent-submission";
import {
  buildStockOutSaveBody,
  stockOutSetupInput,
  STOCK_OUT_ERROR_COPY,
  type StockOutSaveBody,
  type StockOutStrategy,
} from "@/lib/api/schemas/stock-out";
import { useScanCountSession, type ScanFeedback } from "./use-scan-count-session";
import { DEFAULT_STORAGE_LABEL, LotPreview, StorageRow, useDefaultStorage } from "./stock-task-parts";
import { TrailList } from "./task-trail";

/* --------------------------------------------------------------- session -- */

/** The single persisted "line" (id 0) that is a whole Stock-Out session.
 *
 * `strategy` and `productId` are only ever written while `started` is false
 * (the setup phase, below) — once a session starts, neither the setup form
 * nor the scanning screen expose a control that can change them. The only
 * way to pick a different product or strategy is "Clear session", which
 * explicitly abandons the current draft and rotates to a brand new
 * Idempotency-Key. This is the whole mechanism behind Phase 14A's safety
 * requirement that a pending operation's product/strategy never changes
 * without the operator resolving or abandoning it first — there is no
 * separate guard to read because the UI structure itself is the guard.
 */
interface SessionLine {
  productId: number;
  sku: string;
  name: string;
  barcode: string | null;
  /** last known availability, refreshed on pick/scan — advisory only; the
   *  backend's InsufficientStockException/InsufficientBatchStockException
   *  are the real, authoritative check at Save time. */
  availableQty: string | null;
  strategy: StockOutStrategy;
  expected: string;
  remark: string;
  /** local scan tally — NO stock moves until Save */
  count: number;
  /** setup confirmed, scanning has begun */
  started: boolean;
  trail: TrailEntry[];
}

function buildPayload(lines: Record<number, SessionLine>): StockOutSaveBody | null {
  const s = lines[0];
  if (!s) return null;
  return buildStockOutSaveBody(
    { product_id: s.productId, strategy: s.strategy, expected: s.expected || undefined, remark: s.remark || undefined },
    String(s.count),
  );
}

const FIELD_CLS =
  "h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:opacity-60 max-[767.98px]:h-[46px] max-[767.98px]:text-[16px]";

/** the trail stores the scanned code; the wording is rendered in the UI language */
const hitTrailText = (code: string) => code;

/* --------------------------------------------------------------- console -- */

export function StockOutConsole() {
  const t = useT();
  const router = useRouter();
  const { beepOk, beepBad, beepDone, enabled: soundOn, setEnabled: setSoundOn } = useBeep();

  const draft = useIdempotentDraft<SessionLine, StockOutSaveBody>({
    scope: "stock-out:session",
    keyPrefix: "stockout-",
    buildPayload,
  });
  const line = draft.lines[0] as SessionLine | undefined;

  const saveMut = useSaveStockOutSession();
  // a reused key whose stored request differs forces a new session (no silent new key)
  const submission = useIdempotentSubmission({ draft, mutate: saveMut.mutate, isMismatch: isLooseKeyMismatch });
  const { mismatch } = submission;
  const [saved, setSaved] = React.useState<{ qty: string; onHand: string; name: string; productId: number } | null>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  // R4 review before commit: opening it sends nothing; Confirm runs `save`
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewError, setReviewError] = React.useState<string | null>(null);

  const phase: "setup" | "scanning" | "saved" = saved ? "saved" : line?.started ? "scanning" : "setup";
  const storage = useDefaultStorage(line ? line.productId : null);

  const strategyLabel = (s: StockOutStrategy) => t(s === "fefo" ? "task.fefo" : "task.fifo");
  const strategyHint = (s: StockOutStrategy) => t(s === "fefo" ? "task.fefoHint" : "task.fifoHint");

  const feedbackText = (feedback: Exclude<ScanFeedback, { kind: "idle" }>): string => {
    switch (feedback.kind) {
      case "match":
        return t("task.matchedOut", { n: feedback.count });
      case "wrong":
        return t("task.wrongProduct", { name: feedback.productName });
      case "unknown":
        return t("task.unknownBarcode", { code: feedback.code });
      case "error":
        return feedback.userMessage ?? t("task.scanReadError");
    }
  };

  /* ------------------------------- SETUP: product picker ---------------- */
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const productQ = useProducts(
    debounced.trim().length >= 2
      ? { page: 1, page_size: 20, search: debounced.trim() }
      : { page: 1, page_size: 20 },
  );
  const rowsById = React.useMemo(() => {
    const m = new Map<number, { id: number; sku: string; product_name: string; barcode?: string | null }>();
    for (const p of productQ.data?.items ?? []) m.set(p.id, p);
    return m;
  }, [productQ.data]);
  const comboItems: ComboboxItem[] = (productQ.data?.items ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, label: p.product_name, sublabel: p.sku }));

  /** Shared by both the Combobox pick and a setup-phase barcode scan. */
  const fetchAvailability = React.useCallback(async (barcode: string | null): Promise<string | null> => {
    if (!barcode) return null;
    try {
      const res = await resolveBarcode(barcode, "lookup");
      return res.product.operational_available_quantity;
    } catch {
      return null; // advisory only — Save-time is the authoritative check
    }
  }, []);

  // Guards the async availability fetch against a race where the operator
  // picks a different product while the first lookup is still in flight.
  // (`draft.setLine` is async React state — reading `draft.lines[0]` back
  // synchronously inside the .then() would see the pre-pick snapshot from
  // this closure, not the committed value, so a plain ref token is used
  // instead of re-reading the draft.)
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
      availableQty: null,
      strategy: "fefo",
      expected: "",
      remark: "",
      count: 0,
      started: false,
      trail: [],
    });
    void fetchAvailability(row.barcode ?? null).then((qty) => {
      if (pickToken.current === token) draft.setLine(0, { availableQty: qty });
    });
  };

  const patch = (p: Partial<SessionLine>) => draft.setLine(0, p);

  const setupValid = React.useMemo(() => {
    if (!line) return false;
    return stockOutSetupInput.safeParse({
      product_id: line.productId,
      strategy: line.strategy,
      expected: line.expected || undefined,
      remark: line.remark || undefined,
    }).success;
  }, [line]);

  /* ------------------------------- SCAN SESSION ------------------------- */
  // each scan verifies the item (read-only "lookup"); nothing is deducted until Save.
  // While the review sheet is open the scanner is off: the count cannot change under review.
  const { feedback, setFeedback, resolving, bump, handleScan, scanner } = useScanCountSession({
    draft,
    purpose: "lookup",
    scanning: phase === "scanning" && !reviewOpen,
    busy: saveMut.isPending,
    beepOk,
    beepBad,
    hitTrailText,
  });

  const undoLast = () => {
    bump(-1, "");
    setFeedback({ kind: "idle" });
    requestAnimationFrame(() => scanner.focus());
  };

  const startScanning = () => {
    if (!setupValid) return;
    patch({ started: true });
    setFeedback({ kind: "idle" });
    requestAnimationFrame(() => scanner.focus());
  };

  const clearSession = () => {
    draft.commitSuccess(); // clears the persisted draft + rotates the key
    setSaved(null);
    submission.clearMismatch();
    setFeedback({ kind: "idle" });
    setTerm("");
  };

  /* ------------------------------- SAVE (one authoritative mutation) --- */
  const overExpected =
    !!line?.expected && line.count > Number(line.expected) ? { expected: line.expected, count: line.count } : null;
  const overAvailable =
    line?.availableQty != null && line.count > Number(line.availableQty)
      ? { available: line.availableQty, count: line.count }
      : null;
  const canReview = !!draft.payload && !!line && line.count > 0 && !saveMut.isPending && !mismatch;

  const save = () => {
    const body = draft.payload;
    if (!body || !line || line.count <= 0 || saveMut.isPending) return;
    setReviewError(null);
    // success consumes the draft — next session gets a fresh key
    submission.submit(
      { body },
      {
        onSuccess: (res) => {
          beepDone();
          setReviewOpen(false);
          setSaved({ qty: res.difference, onHand: res.current_stock, name: line.name, productId: line.productId });
        },
        onError: (e, isMismatch) => {
          beepBad();
          // Never silently mint a new key when the original result is
          // uncertain: a reused key whose stored receipt no longer matches
          // this request (quantity/strategy/product changed, e.g. after a
          // timeout-then-retry) always surfaces as "start a new session" —
          // the operator must explicitly abandon it, not have the console
          // paper over the ambiguity on their behalf.
          if (isMismatch) {
            setReviewOpen(false);
            return;
          }
          const backend = isApiError(e) ? e.message : "";
          const copy = STOCK_OUT_ERROR_COPY[backend] ?? (isApiError(e) ? e.userMessage : t("task.outRejected"));
          const withId = rid(e) ? `${copy} · ${t("task.requestRef", { id: rid(e)! })}` : copy;
          setReviewError(withId);
          toast.error(t("task.saveFailed"), { description: withId });
        },
      },
    );
  };

  const openReview = () => {
    if (!canReview) return;
    setReviewError(null);
    setReviewOpen(true);
  };

  const steps = [t("task.stepDetails"), t("task.stepScan"), t("task.stepReview"), t("task.stepDone")];
  const stepIndex = phase === "saved" ? 3 : reviewOpen ? 2 : phase === "scanning" ? 1 : 0;
  const countQty = line ? String(line.count) : "0";
  const afterQty = storage.status === "ready" ? subtractDecimals(storage.onHand, countQty, 3) : null;

  /* --------------------------------------------------------- render ---- */
  return (
    <div className="flex flex-col gap-4">
      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <h1 className="flex items-center gap-2 text-[18px] font-semibold">
                <PackageMinus aria-hidden className="h-[18px] w-[18px] text-[var(--accent)]" />
                {t("nav.stockOut")}
              </h1>
              <div className="text-[13px] text-[var(--muted)]">
                {phase === "setup" ? t("task.outSetupHint") : phase === "scanning" ? t("task.outScanHint") : t("task.outSavedHint")}
              </div>
            </div>
          </div>

          <StepIndicator steps={steps} current={stepIndex} />

          {/* ---------------------------------------------------- SETUP -- */}
          {phase === "setup" ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                {t("task.product")}
                <Combobox
                  ariaLabel={t("task.searchProducts")}
                  value={line ? { id: line.productId, label: line.name, sublabel: line.sku } : null}
                  onChange={pickProduct}
                  onSearch={setTerm}
                  items={comboItems}
                  loading={productQ.isFetching}
                  placeholder={t("task.searchPlaceholder")}
                  emptyText={debounced.trim().length < 2 ? t("task.typeTwo") : t("task.noProducts")}
                />
              </label>

              {line ? (
                <>
                  <div
                    className="flex items-center justify-between rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[13px]"
                    role="status"
                  >
                    <span className="text-[var(--muted)]">{t("task.availableToIssue")}</span>
                    <span className="font-semibold tabular-nums">
                      {line.availableQty != null ? <QuantityDisplay value={line.availableQty} /> : "—"}
                    </span>
                  </div>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-[12px] text-[var(--muted)]">{t("task.strategy")}</legend>
                    <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
                      {(["fefo", "fifo"] as const).map((s) => {
                        const active = line.strategy === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => patch({ strategy: s })}
                            className={
                              "flex min-h-11 flex-col items-start gap-[2px] rounded-[var(--r-sm)] border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus)] " +
                              (active
                                ? "border-[var(--accent)] bg-[var(--accent-subtle)] shadow-[inset_0_0_0_1px_var(--accent)]"
                                : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--accent)]")
                            }
                            aria-pressed={active}
                          >
                            <span className="text-[14px] font-semibold">{strategyLabel(s)}</span>
                            <span className="text-[12px] text-[var(--muted)]">{strategyHint(s)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <LotPreview storage={storage} strategy={line.strategy} />

                  <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      {t("task.expectedQty")}
                      <input
                        inputMode="decimal"
                        className={FIELD_CLS}
                        value={line.expected}
                        onChange={(e) => patch({ expected: e.target.value })}
                        placeholder="0.000"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      {t("task.note")}
                      <input
                        className={FIELD_CLS}
                        value={line.remark}
                        onChange={(e) => patch({ remark: e.target.value })}
                        maxLength={255}
                        placeholder={t("task.outNotePlaceholder")}
                      />
                    </label>
                  </div>

                  <Button variant="primary" className="h-11" disabled={!setupValid} onClick={startScanning}>
                    {t("task.startScanning")}
                  </Button>
                </>
              ) : (
                <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-5 text-center text-[13px] text-[var(--muted)]">
                  {t("task.outPickHint")}
                </p>
              )}
            </div>
          ) : null}

          {/* ------------------------------------------------- SCANNING -- */}
          {phase === "scanning" && line ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{line.name}</div>
                  <div className="mt-[3px] flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--muted)]">
                    <span className="mono">{line.sku}</span>
                    <span>{strategyLabel(line.strategy)}</span>
                    {line.availableQty != null ? (
                      <span>
                        {t("task.availableShort")} <QuantityDisplay value={line.availableQty} />
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearSession} disabled={saveMut.isPending}>
                  {t("task.clearSession")}
                </Button>
              </div>

              {/* scan surface */}
              <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 focus-within:border-[var(--accent)] focus-within:outline-2 focus-within:outline-[var(--focus)]">
                <ScanLine aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
                <input
                  {...scanner.inputProps}
                  placeholder={resolving ? t("task.reading") : t("task.scanPlaceholder")}
                  aria-label={t("task.scanInput")}
                  className="min-h-11 w-full min-w-0 bg-transparent text-[16px] tabular-nums outline-none"
                />
                <Button type="button" variant="secondary" size="sm" onClick={scanner.submit} disabled={resolving || saveMut.isPending}>
                  {t("task.enter")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label={t("task.scanWithCamera")}
                  title={t("task.scanWithCameraTitle")}
                  onClick={() => {
                    if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur();
                    setCameraOpen(true);
                  }}
                  disabled={resolving || saveMut.isPending}
                >
                  <Camera aria-hidden className="h-4 w-4" />
                </Button>
              </div>

              {/* count + inline feedback */}
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px]">
                  <span className="text-[var(--muted)]">{t("task.toIssue")} </span>
                  <span className="text-[20px] font-bold tabular-nums">{line.count}</span>
                  {line.expected ? <span className="text-[var(--muted)]"> {t("task.ofExpected", { n: line.expected })}</span> : null}
                </div>
                <Button variant="ghost" size="sm" onClick={undoLast} disabled={line.count === 0 || saveMut.isPending}>
                  <Undo2 aria-hidden className="h-3.5 w-3.5" /> {t("task.undoLastScan")}
                </Button>
              </div>

              {feedback.kind !== "idle" ? (
                <Banner tone={feedback.kind === "match" ? "good" : "danger"} title={feedbackText(feedback)} />
              ) : null}

              {overExpected ? (
                <Banner tone="warning" title={t("task.overExpected", { count: overExpected.count, expected: overExpected.expected })} />
              ) : null}

              {overAvailable ? (
                <Banner tone="warning" title={t("task.overAvailable", { count: overAvailable.count, available: overAvailable.available })} />
              ) : null}

              {mismatch ? (
                <Banner
                  tone="danger"
                  title={t("task.outMismatchTitle")}
                  actions={
                    <Button variant="secondary" size="sm" onClick={clearSession}>
                      {t("task.outStartNew")}
                    </Button>
                  }
                >
                  {t("task.outMismatchBody")}
                </Banner>
              ) : null}

              <div className="wc-task-action flex flex-col gap-2">
                <Button variant="primary" className="h-11" disabled={!canReview} onClick={openReview}>
                  <ShieldCheck aria-hidden className="h-4 w-4" />
                  {saveMut.isPending ? t("task.saving") : t("task.reviewOut", { n: line.count })}
                </Button>
                {saveMut.isError && !mismatch && !reviewOpen ? (
                  <p className="text-[12px] text-[var(--danger)]">
                    {isApiError(saveMut.error) ? saveMut.error.userMessage : t("task.saveFailed")}{" "}
                    {rid(saveMut.error) ? `· ${t("task.requestRef", { id: rid(saveMut.error)! })}` : null} {t("task.keptRetry")}
                  </p>
                ) : null}
              </div>

              <TrailList trail={line.trail} />
            </div>
          ) : null}

          {/* --------------------------------------------------- SAVED -- */}
          {phase === "saved" && saved ? (
            <Banner
              tone="good"
              title={t("task.outSaved")}
              actions={
                <>
                  <Button variant="primary" className="h-11" onClick={clearSession}>
                    {t("task.issueNext")}
                  </Button>
                  <Button variant="secondary" className="h-11" asChild>
                    <Link href={`/inventory/ledger?product_id=${saved.productId}`}>
                      <BookOpen aria-hidden className="h-4 w-4" />
                      {t("review.viewInLedger")}
                    </Link>
                  </Button>
                  <Button variant="ghost" className="h-11" onClick={() => router.push("/stock")}>
                    {t("task.backToStock")}
                  </Button>
                </>
              }
            >
              <p className="text-[13px]">
                {saved.name} — {t("task.issued")} <QuantityDisplay value={saved.qty} signed className="font-semibold" />.{" "}
                {t("task.onHandNow")} <QuantityDisplay value={saved.onHand} className="font-semibold" />.
              </p>
            </Banner>
          ) : null}
        </div>

        <aside className="wc-receive-side">
          {line ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <div>
                <div className="wc-section-label">{t("task.selectedItem")}</div>
                <div className="text-[14px] font-semibold">{line.name}</div>
                <div className="mono text-[12px] text-[var(--muted)]">{line.sku}</div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-[var(--muted)]">{t("task.atDefault", { storage: DEFAULT_STORAGE_LABEL })}</span>
                {storage.status === "ready" ? (
                  <StockTriad onHand={storage.onHand} reserved={storage.reserved} available={storage.available} compact />
                ) : (
                  <p className="text-[12px] text-[var(--muted)]">
                    {storage.status === "error" ? t("task.balanceUnavailable") : t("task.balanceLoading")}
                  </p>
                )}
              </div>
            </div>
          ) : null}
          <div className="rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-[13px]">
            <StorageRow direction="out" />
            <h2 className="wc-section-label mb-2 mt-4">{t("task.howItWorks")}</h2>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[var(--muted)]">
              <li>{t("task.outHow1")}</li>
              <li>{t("task.outHow2")}</li>
              <li>{t("task.outHow3")}</li>
              <li>{t("task.outHow4")}</li>
              <li>{t("task.outHow5")}</li>
            </ul>
          </div>

          <label className="flex items-center gap-[6px] text-[12px] text-[var(--muted)]">
            <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            {t("task.audibleFeedback")}
          </label>
        </aside>
      </div>

      {line ? (
        <ReviewSheet
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          title={t("task.reviewOutTitle")}
          description={t("review.checkBefore")}
          confirmLabel={t("task.confirmMinus", { q: formatQtyDelta(`-${countQty}`) })}
          onConfirm={save}
          pending={saveMut.isPending}
          confirmDisabled={!draft.payload || line.count <= 0 || mismatch}
          error={reviewError ? <Banner tone="danger" title={reviewError}>{t("review.failedKept")}</Banner> : undefined}
          returnFocusRef={scanner.inputProps.ref}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-[var(--warning-subtle)] px-2 py-1 text-[12px] font-semibold text-[var(--warning)]">
              <ArrowUpFromLine aria-hidden className="h-3.5 w-3.5" />
              {t("task.removesStock")}
            </span>
            <span className="mono text-[12px] text-[var(--muted)]">{line.sku}</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold">{line.name}</div>
            <div className="text-[26px] font-semibold">
              <QuantityDisplay value={`-${countQty}`} signed />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            <ReviewCell label={t("task.source")}>
              <span className="mono">{DEFAULT_STORAGE_LABEL}</span>
            </ReviewCell>
            <ReviewCell label={t("task.onHandAt", { storage: DEFAULT_STORAGE_LABEL })}>
              {storage.status === "ready" && afterQty ? (
                <QuantityChange before={storage.onHand} after={afterQty} estimate />
              ) : (
                <span className="text-[var(--muted)]">—</span>
              )}
            </ReviewCell>
          </div>
          <ReviewCell label={t("task.strategy")}>{strategyLabel(line.strategy)}</ReviewCell>
          <LotPreview storage={storage} strategy={line.strategy} />
          {line.remark ? <ReviewCell label={t("task.noteLabel")}>{line.remark}</ReviewCell> : null}
          <p className="text-[12px] text-[var(--muted)]">{t("review.estimateNote")}</p>
        </ReviewSheet>
      ) : null}

      <CameraBarcodeScanner
        open={cameraOpen}
        onOpenChange={(v) => {
          setCameraOpen(v);
          if (!v) requestAnimationFrame(() => scanner.focus());
        }}
        title={t("task.scanAnItem")}
        onDecode={(value) => {
          setCameraOpen(false);
          void handleScan(value);
        }}
      />
    </div>
  );
}
