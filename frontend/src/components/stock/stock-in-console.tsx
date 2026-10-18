"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownToLine, BookOpen, Camera, PackagePlus, ScanLine, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { LotChip } from "@/components/ui/lot-chip";
import { QuantityChange, QuantityDisplay } from "@/components/ui/quantity-display";
import { ReviewCell, ReviewSheet } from "@/components/ui/review-sheet";
import { Banner } from "@/components/ui/states";
import { StepIndicator } from "@/components/ui/step-indicator";
import { StockTriad } from "@/components/ui/stock-triad";
import { CameraBarcodeScanner } from "@/components/work/camera-barcode-scanner";
import { useBeep } from "@/components/work/use-beep";
import { isApiError } from "@/lib/api/errors";
import { businessToday, expiryState, type ExpiryState } from "@/lib/business-date";
import { sumDecimals } from "@/lib/decimal";
import { formatQtyDelta } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useProducts } from "@/lib/query/hooks";
import { useProduct } from "@/lib/query/products";
import { useSaveStockInSession } from "@/lib/query/stock";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import { useDebounced } from "@/lib/use-debounced";
import type { TrailEntry } from "@/lib/workflow/scan-count";
import { isLooseKeyMismatch, requestIdOf as rid } from "@/lib/workflow/submission-errors";
import { useIdempotentSubmission } from "@/lib/workflow/use-idempotent-submission";
import {
  buildStockInSaveBody,
  stockInSetupInput,
  STOCK_IN_ERROR_COPY,
  type StockInSaveBody,
} from "@/lib/api/schemas/stock-in";
import { useScanCountSession, type ScanFeedback } from "./use-scan-count-session";
import { DEFAULT_STORAGE_LABEL, StorageRow, useDefaultStorage } from "./stock-task-parts";
import { TrailList } from "./task-trail";

/* --------------------------------------------------------------- session -- */

/** The single persisted "line" (id 0) that is a whole Stock-In session. */
interface SessionLine {
  productId: number;
  sku: string;
  name: string;
  trackBatch: boolean;
  trackExpiry: boolean;
  lot_no: string;
  mfg_date: string;
  expiry_date: string;
  expected: string;
  remark: string;
  /** local scan tally — NO stock is moved until Save */
  count: number;
  /** setup confirmed, scanning has begun */
  started: boolean;
  /** small local activity trail (never an AuditLog) */
  trail: TrailEntry[];
}

function buildPayload(lines: Record<number, SessionLine>): StockInSaveBody | null {
  const s = lines[0];
  if (!s) return null;
  return buildStockInSaveBody(
    {
      product_id: s.productId,
      trackBatch: s.trackBatch,
      trackExpiry: s.trackExpiry,
      lot_no: s.lot_no || undefined,
      mfg_date: s.mfg_date || undefined,
      expiry_date: s.expiry_date || undefined,
      expected: s.expected || undefined,
      remark: s.remark || undefined,
    },
    s.count,
  );
}

const FIELD_CLS =
  "h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:opacity-60 max-[767.98px]:h-[46px] max-[767.98px]:text-[16px]";

/** the trail stores the scanned code; the wording is rendered in the UI language */
const hitTrailText = (code: string) => code;

const EXPIRY_STATE_KEY: Record<ExpiryState, MessageKey> = {
  expired: "task.expiryExpired",
  "same-day": "task.expirySameDay",
  near: "task.expiryNear",
  ok: "task.expiryOk",
};

/* --------------------------------------------------------------- console -- */

export function StockInConsole() {
  const t = useT();
  const router = useRouter();
  const { beepOk, beepBad, beepDone, enabled: soundOn, setEnabled: setSoundOn } = useBeep();

  const draft = useIdempotentDraft<SessionLine, StockInSaveBody>({
    scope: "stock-in:session",
    keyPrefix: "stockin-",
    buildPayload,
  });
  const line = draft.lines[0] as SessionLine | undefined;

  const saveMut = useSaveStockInSession();
  // a reused key whose stored request differs forces a new session (no silent new key)
  const submission = useIdempotentSubmission({ draft, mutate: saveMut.mutate, isMismatch: isLooseKeyMismatch });
  const { mismatch } = submission;
  const [saved, setSaved] = React.useState<{ qty: string; onHand: string; name: string; lot: string | null; productId: number } | null>(
    null,
  );
  const [cameraOpen, setCameraOpen] = React.useState(false);
  // R4 review before commit: opening it sends nothing; Confirm runs `save`
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewError, setReviewError] = React.useState<string | null>(null);

  const phase: "setup" | "scanning" | "saved" = saved ? "saved" : line?.started ? "scanning" : "setup";
  const storage = useDefaultStorage(line ? line.productId : null);

  const feedbackText = (feedback: Exclude<ScanFeedback, { kind: "idle" }>): string => {
    switch (feedback.kind) {
      case "match":
        return t("task.matchedIn", { n: feedback.count });
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
    const m = new Map<number, { id: number; sku: string; product_name: string; track_batch: boolean; track_expiry: boolean }>();
    for (const p of productQ.data?.items ?? []) m.set(p.id, p);
    return m;
  }, [productQ.data]);
  const comboItems: ComboboxItem[] = (productQ.data?.items ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({
      id: p.id,
      label: p.product_name,
      sublabel: [p.sku, t(p.track_batch ? (p.track_expiry ? "task.trackBatchExpiry" : "task.trackBatch") : "task.trackNone")].join(" · "),
    }));

  const pickProduct = (item: ComboboxItem | null) => {
    if (!item) {
      draft.removeLine(0);
      return;
    }
    const row = rowsById.get(item.id);
    if (!row) return;
    draft.setLine(0, {
      productId: row.id,
      sku: row.sku,
      name: row.product_name,
      trackBatch: row.track_batch,
      trackExpiry: row.track_expiry,
      lot_no: "",
      mfg_date: "",
      expiry_date: "",
      expected: "",
      remark: "",
      count: 0,
      started: false,
      trail: [],
    });
  };

  // Deep-link from Stock / the "new product" onboarding flow: `?product=<id>`
  // preselects the product exactly as the combobox would, without starting a
  // scan session on its own — the operator still confirms Start scanning.
  const searchParams = useSearchParams();
  const preselectId = React.useMemo(() => {
    const raw = searchParams.get("product");
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [searchParams]);
  const preselectQ = useProduct(line ? null : preselectId);
  const preselectApplied = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!preselectQ.data || line || preselectApplied.current === preselectQ.data.id) return;
    preselectApplied.current = preselectQ.data.id;
    const d = preselectQ.data;
    draft.setLine(0, {
      productId: d.id,
      sku: d.sku,
      name: d.product_name,
      trackBatch: d.track_batch,
      trackExpiry: d.track_expiry,
      lot_no: "",
      mfg_date: "",
      expiry_date: "",
      expected: "",
      remark: "",
      count: 0,
      started: false,
      trail: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectQ.data, line]);

  const patch = (p: Partial<SessionLine>) => draft.setLine(0, p);

  const setupValid = React.useMemo(() => {
    if (!line) return false;
    return stockInSetupInput.safeParse({
      product_id: line.productId,
      trackBatch: line.trackBatch,
      trackExpiry: line.trackExpiry,
      lot_no: line.lot_no || undefined,
      mfg_date: line.mfg_date || undefined,
      expiry_date: line.expiry_date || undefined,
      expected: line.expected || undefined,
      remark: line.remark || undefined,
    }).success;
  }, [line]);

  const expState = line?.expiry_date ? expiryState(line.expiry_date) : null;

  /* ------------------------------- SCAN SESSION ------------------------- */
  // each scan verifies the item (read-only "stock_in" lookup); nothing moves until Save.
  // While the review sheet is open the scanner is off: the count cannot change under review.
  const { feedback, setFeedback, resolving, bump, handleScan, scanner } = useScanCountSession({
    draft,
    purpose: "stock_in",
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
          setSaved({
            qty: res.savedQuantity,
            onHand: res.currentStock,
            name: line.name,
            lot: res.lotNo,
            productId: line.productId,
          });
        },
        onError: (e, isMismatch) => {
          beepBad();
          if (isMismatch) {
            // the existing recovery panel takes over: start a new session
            setReviewOpen(false);
            return;
          }
          const backend = isApiError(e) ? e.message : "";
          const copy =
            STOCK_IN_ERROR_COPY[backend] ?? (isApiError(e) ? e.userMessage : t("task.inRejected"));
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
  const afterQty = storage.status === "ready" ? sumDecimals([storage.onHand, countQty], 3) : null;

  /* --------------------------------------------------------- render ---- */
  return (
    <div className="flex flex-col gap-4">
      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <h1 className="flex items-center gap-2 text-[18px] font-semibold">
                <PackagePlus aria-hidden className="h-[18px] w-[18px] text-[var(--accent)]" />
                {t("nav.stockIn")}
              </h1>
              <div className="text-[13px] text-[var(--muted)]">
                {phase === "setup" ? t("task.inSetupHint") : phase === "scanning" ? t("task.inScanHint") : t("task.inSavedHint")}
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
                  {line.trackBatch ? (
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      {t("task.lotNumber")}
                      <input
                        className={`${FIELD_CLS} mono`}
                        value={line.lot_no}
                        onChange={(e) => patch({ lot_no: e.target.value })}
                        autoComplete="off"
                        placeholder="LOT-…"
                      />
                    </label>
                  ) : null}

                  {line.trackExpiry ? (
                    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                      <DateField
                        id="stock-in-mfg"
                        label={t("task.mfgDate")}
                        value={line.mfg_date}
                        max={businessToday()}
                        onChange={(v) => patch({ mfg_date: v })}
                        inputClassName={FIELD_CLS}
                      />
                      <DateField
                        id="stock-in-exp"
                        label={t("task.expiryDate")}
                        value={line.expiry_date}
                        onChange={(v) => patch({ expiry_date: v })}
                        inputClassName={FIELD_CLS}
                      />
                    </div>
                  ) : null}

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
                        placeholder={t("task.inNotePlaceholder")}
                      />
                    </label>
                  </div>

                  {expState && expState !== "ok" ? (
                    <Banner tone="warning" title={`${t(EXPIRY_STATE_KEY[expState])} — ${t("task.acceptedNotBlocked")}`} />
                  ) : null}

                  <Button variant="primary" className="h-11" disabled={!setupValid} onClick={startScanning}>
                    {t("task.startScanning")}
                  </Button>
                </>
              ) : (
                <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-5 text-center text-[13px] text-[var(--muted)]">
                  {t("task.inPickHint")}
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
                    {line.trackBatch ? <span className="mono">{t("task.lotShort", { lot: line.lot_no || "—" })}</span> : <span>{t("task.trackNone")}</span>}
                    {line.trackExpiry && line.expiry_date ? <span>{t("task.expShort", { date: line.expiry_date })}</span> : null}
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
                  <span className="text-[var(--muted)]">{t("task.scanned")} </span>
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

              {mismatch ? (
                <Banner
                  tone="danger"
                  title={t("task.inMismatchTitle")}
                  actions={
                    <Button variant="secondary" size="sm" onClick={clearSession}>
                      {t("task.inStartNew")}
                    </Button>
                  }
                >
                  {t("task.inMismatchBody")}
                </Banner>
              ) : null}

              <div className="wc-task-action flex flex-col gap-2">
                <Button variant="primary" className="h-11" disabled={!canReview} onClick={openReview}>
                  <ShieldCheck aria-hidden className="h-4 w-4" />
                  {saveMut.isPending ? t("task.saving") : t("task.reviewIn", { n: line.count })}
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
              title={t("task.inSaved")}
              actions={
                <>
                  <Button variant="primary" className="h-11" onClick={clearSession}>
                    {t("task.scanNext")}
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
                {saved.name}
                {saved.lot ? <> · {t("task.lotShort", { lot: saved.lot })}</> : null} — {t("task.added")}{" "}
                <QuantityDisplay value={saved.qty} className="font-semibold" />. {t("task.onHandNow")}{" "}
                <QuantityDisplay value={saved.onHand} className="font-semibold" />.
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
            <StorageRow direction="in" />
            <h2 className="wc-section-label mb-2 mt-4">{t("task.howItWorks")}</h2>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[var(--muted)]">
              <li>{t("task.inHow1")}</li>
              <li>{t("task.inHow2")}</li>
              <li>{t("task.inHow3")}</li>
              <li>{t("task.inHow4")}</li>
              <li>{t("task.inHow5")}</li>
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
          title={t("task.reviewInTitle")}
          description={t("review.checkBefore")}
          confirmLabel={t("task.confirmPlus", { q: formatQtyDelta(countQty) })}
          onConfirm={save}
          pending={saveMut.isPending}
          confirmDisabled={!draft.payload || line.count <= 0 || mismatch}
          error={reviewError ? <Banner tone="danger" title={reviewError}>{t("review.failedKept")}</Banner> : undefined}
          returnFocusRef={scanner.inputProps.ref}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-[var(--success-subtle)] px-2 py-1 text-[12px] font-semibold text-[var(--success)]">
              <ArrowDownToLine aria-hidden className="h-3.5 w-3.5" />
              {t("task.addsStock")}
            </span>
            <span className="mono text-[12px] text-[var(--muted)]">{line.sku}</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold">{line.name}</div>
            <div className="text-[26px] font-semibold">
              <QuantityDisplay value={countQty} signed />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            <ReviewCell label={t("task.destination")}>
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
          {line.trackBatch ? (
            <ReviewCell label={t("task.newLot")}>
              <LotChip lot={line.lot_no || null} />
              {line.trackExpiry ? (
                <div className="mt-1 text-[12px] font-normal text-[var(--muted)]">
                  {t("task.mfgDate")} {line.mfg_date || "—"} · {t("task.expiryDate")} {line.expiry_date || "—"}
                </div>
              ) : null}
            </ReviewCell>
          ) : null}
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
