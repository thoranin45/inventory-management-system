"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, CheckCircle2, ChevronRight, PackagePlus, ScanLine, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { CameraBarcodeScanner } from "@/components/work/camera-barcode-scanner";
import { useScanner } from "@/components/work/use-scanner";
import { useBeep } from "@/components/work/use-beep";
import { isApiError } from "@/lib/api/errors";
import { businessToday, EXPIRY_STATE_LABEL, expiryState } from "@/lib/business-date";
import { useProducts } from "@/lib/query/hooks";
import { useProduct } from "@/lib/query/products";
import { resolveBarcode } from "@/lib/query/sales";
import { useSaveStockInSession } from "@/lib/query/stock";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import {
  buildStockInSaveBody,
  stockInSetupInput,
  STOCK_IN_ERROR_COPY,
  type StockInSaveBody,
} from "@/lib/api/schemas/stock-in";

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

interface TrailEntry {
  id: string;
  kind: "hit" | "undo";
  text: string;
  at: string;
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
  "h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-60";

function nowHM(): string {
  return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function rid(e: unknown): string | undefined {
  return isApiError(e) ? e.requestId : undefined;
}

type ScanFeedback =
  | { kind: "idle" }
  | { kind: "match"; text: string }
  | { kind: "wrong"; text: string }
  | { kind: "unknown"; text: string }
  | { kind: "error"; text: string };

/* --------------------------------------------------------------- console -- */

export function StockInConsole() {
  const router = useRouter();
  const { beepOk, beepBad, beepDone, enabled: soundOn, setEnabled: setSoundOn } = useBeep();

  const draft = useIdempotentDraft<SessionLine, StockInSaveBody>({
    scope: "stock-in:session",
    keyPrefix: "stockin-",
    buildPayload,
  });
  const line = draft.lines[0] as SessionLine | undefined;

  const saveMut = useSaveStockInSession();
  const [saved, setSaved] = React.useState<{ qty: string; onHand: string; name: string; lot: string | null } | null>(
    null,
  );
  const [mismatch, setMismatch] = React.useState(false);
  const [feedback, setFeedback] = React.useState<ScanFeedback>({ kind: "idle" });
  const [resolving, setResolving] = React.useState(false);
  const [cameraOpen, setCameraOpen] = React.useState(false);

  const phase: "setup" | "scanning" | "saved" = saved ? "saved" : line?.started ? "scanning" : "setup";

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
      sublabel: [p.sku, p.track_batch ? (p.track_expiry ? "batch + expiry" : "batch") : "non-batch"].join(" · "),
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
  const bump = React.useCallback(
    (delta: 1 | -1, text: string) => {
      const cur = draft.lines[0] as SessionLine | undefined;
      if (!cur) return;
      const nextCount = Math.max(0, cur.count + delta);
      if (delta === -1 && cur.count === 0) return;
      const entry: TrailEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        kind: delta === 1 ? "hit" : "undo",
        text,
        at: nowHM(),
      };
      draft.setLine(0, { count: nextCount, trail: [entry, ...cur.trail].slice(0, 12) });
    },
    [draft],
  );

  const handleScan = React.useCallback(
    async (code: string) => {
      const cur = draft.lines[0] as SessionLine | undefined;
      if (!cur || !cur.started || resolving || saveMut.isPending) return;
      setResolving(true);
      try {
        const res = await resolveBarcode(code, "stock_in");
        if (res.product.id === cur.productId) {
          bump(1, `barcode ${code} +1`);
          beepOk();
          setFeedback({ kind: "match", text: `Matched — scanned ${cur.count + 1}` });
        } else {
          beepBad();
          setFeedback({
            kind: "wrong",
            text: `Wrong product — that barcode is ${res.product.product_name}. Count unchanged.`,
          });
        }
      } catch (e) {
        beepBad();
        if (isApiError(e) && e.status === 404) {
          setFeedback({ kind: "unknown", text: `Barcode read ${code} — product not registered. Nothing was counted.` });
        } else {
          setFeedback({
            kind: "error",
            text: isApiError(e) ? e.userMessage : "Could not read that barcode. Nothing was counted.",
          });
        }
      } finally {
        setResolving(false);
        requestAnimationFrame(() => scanner.focus());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, resolving, saveMut.isPending, bump, beepOk, beepBad],
  );

  const scanner = useScanner({
    onScan: handleScan,
    disabled: phase !== "scanning" || resolving || saveMut.isPending,
  });

  const undoLast = () => {
    bump(-1, "undo -1");
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
    setMismatch(false);
    setFeedback({ kind: "idle" });
    setTerm("");
  };

  /* ------------------------------- SAVE (one authoritative mutation) --- */
  const overExpected =
    !!line?.expected && line.count > Number(line.expected) ? { expected: line.expected, count: line.count } : null;

  const save = () => {
    const body = draft.payload;
    if (!body || !line || line.count <= 0 || saveMut.isPending) return;
    saveMut.mutate(
      { body, idempotencyKey: draft.idempotencyKey },
      {
        onSuccess: (res) => {
          beepDone();
          setSaved({
            qty: res.savedQuantity,
            onHand: res.currentStock,
            name: line.name,
            lot: res.lotNo,
          });
          setMismatch(false);
          draft.commitSuccess(); // draft consumed — next session gets a fresh key
        },
        onError: (e) => {
          beepBad();
          if (isApiError(e) && e.status === 409 && /different payload/i.test(e.message)) {
            setMismatch(true);
            return;
          }
          const backend = isApiError(e) ? e.message : "";
          const copy =
            STOCK_IN_ERROR_COPY[backend] ??
            (isApiError(e) ? e.userMessage : "The stock-in was rejected. Nothing was saved.");
          toast.error("Save failed", { description: rid(e) ? `${copy} · Request ${rid(e)}` : copy });
        },
      },
    );
  };

  /* --------------------------------------------------------- render ---- */
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex items-center gap-1 text-[12px] text-[var(--muted)]" aria-label="Breadcrumb">
        <Link href="/stock" className="font-medium hover:text-[var(--foreground)]">
          Stock
        </Link>
        <ChevronRight aria-hidden className="h-3 w-3" />
        <span className="text-[var(--foreground)]">Stock In</span>
      </nav>

      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <div className="flex items-center gap-2 text-[16px] font-bold">
                <PackagePlus aria-hidden className="h-[18px] w-[18px] text-[var(--accent)]" />
                Stock In
              </div>
              <div className="text-[12px] text-[var(--muted)]">
                {phase === "setup"
                  ? "Choose a product, then scan its items. Scanning only counts — nothing is saved until you Save."
                  : phase === "scanning"
                    ? "Scan each physical item. Each scan verifies it matches the selected product."
                    : "Stock saved."}
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------- SETUP -- */}
          {phase === "setup" ? (
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
                  {line.trackBatch ? (
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      Lot number
                      <input
                        className={FIELD_CLS}
                        value={line.lot_no}
                        onChange={(e) => patch({ lot_no: e.target.value })}
                        autoComplete="off"
                        placeholder="LOT-…"
                      />
                    </label>
                  ) : null}

                  {line.trackExpiry ? (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                        Manufacturing date
                        <input
                          type="date"
                          className={FIELD_CLS}
                          value={line.mfg_date}
                          max={businessToday()}
                          onChange={(e) => patch({ mfg_date: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                        Expiry date
                        <input
                          type="date"
                          className={FIELD_CLS}
                          value={line.expiry_date}
                          onChange={(e) => patch({ expiry_date: e.target.value })}
                        />
                      </label>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      Expected quantity (optional)
                      <input
                        inputMode="decimal"
                        className={FIELD_CLS}
                        value={line.expected}
                        onChange={(e) => patch({ expected: e.target.value })}
                        placeholder="0.000"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
                      Note (optional)
                      <input
                        className={FIELD_CLS}
                        value={line.remark}
                        onChange={(e) => patch({ remark: e.target.value })}
                        maxLength={255}
                        placeholder="e.g. opening count"
                      />
                    </label>
                  </div>

                  {expState && expState !== "ok" ? (
                    <p
                      role="status"
                      className="flex items-start gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-subtle)] p-2 text-[12px] text-[var(--warning)]"
                    >
                      <TriangleAlert aria-hidden className="h-4 w-4 flex-none" />
                      {EXPIRY_STATE_LABEL[expState]} — accepted, not blocked.
                    </p>
                  ) : null}

                  <Button
                    variant="primary"
                    className="h-11"
                    disabled={!setupValid}
                    onClick={startScanning}
                  >
                    Start scanning
                  </Button>
                </>
              ) : (
                <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-5 text-center text-[12.5px] text-[var(--muted)]">
                  Pick the product you are stocking in. You choose it before scanning.
                </p>
              )}
            </div>
          ) : null}

          {/* ------------------------------------------------- SCANNING -- */}
          {phase === "scanning" && line ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[14px] font-semibold">{line.name}</div>
                  <div className="mt-[3px] flex flex-wrap items-center gap-x-3 text-[11.5px] text-[var(--muted)]">
                    <span className="mono">{line.sku}</span>
                    {line.trackBatch ? <span>lot {line.lot_no || "—"}</span> : <span>non-batch</span>}
                    {line.trackExpiry && line.expiry_date ? <span>exp {line.expiry_date}</span> : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearSession} disabled={saveMut.isPending}>
                  Clear session
                </Button>
              </div>

              {/* scan surface */}
              <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3">
                <ScanLine aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
                <input
                  {...scanner.inputProps}
                  placeholder={resolving ? "Reading…" : "Scan an item…"}
                  aria-label="Barcode scan input"
                  className="min-h-11 w-full min-w-0 bg-transparent text-[15px] tabular-nums outline-none"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={scanner.submit}
                  disabled={resolving || saveMut.isPending}
                >
                  Enter
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Scan with camera"
                  title="Scan with the device camera"
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
                  <span className="text-[var(--muted)]">Scanned </span>
                  <span className="text-[18px] font-bold tabular-nums">{line.count}</span>
                  {line.expected ? (
                    <span className="text-[var(--muted)]"> of {line.expected} expected</span>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={undoLast}
                  disabled={line.count === 0 || saveMut.isPending}
                >
                  <Undo2 aria-hidden className="h-3.5 w-3.5" /> Undo last scan
                </Button>
              </div>

              {feedback.kind !== "idle" ? (
                <p
                  role="status"
                  className={
                    feedback.kind === "match"
                      ? "flex items-center gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-subtle)] p-2 text-[12px] text-[var(--success)]"
                      : "flex items-center gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]"
                  }
                >
                  {feedback.kind === "match" ? (
                    <CheckCircle2 aria-hidden className="h-4 w-4 flex-none" />
                  ) : (
                    <TriangleAlert aria-hidden className="h-4 w-4 flex-none" />
                  )}
                  {feedback.text}
                </p>
              ) : null}

              {overExpected ? (
                <p className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-subtle)] p-2 text-[12px] text-[var(--warning)]">
                  <TriangleAlert aria-hidden className="h-4 w-4 flex-none" />
                  Over expected quantity — {overExpected.count} of {overExpected.expected}. You can still save.
                </p>
              ) : null}

              {mismatch ? (
                <div className="flex flex-col gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-subtle)] p-3 text-[12px] text-[var(--danger)]">
                  <span className="font-semibold">This session can no longer be saved.</span>
                  <span>
                    Its Idempotency-Key was already used for a different quantity or lot. Start a new stock-in session
                    to continue — a new key is issued only for a genuinely new session.
                  </span>
                  <Button variant="secondary" size="sm" className="self-start" onClick={clearSession}>
                    Start new stock-in session
                  </Button>
                </div>
              ) : null}

              <Button
                variant="primary"
                className="h-11"
                disabled={!draft.payload || line.count <= 0 || saveMut.isPending || mismatch}
                onClick={save}
              >
                {saveMut.isPending ? "Saving…" : `Save ${line.count} ${line.count === 1 ? "item" : "items"}`}
              </Button>
              {saveMut.isError && !mismatch ? (
                <p className="text-[12px] text-[var(--danger)]">
                  {isApiError(saveMut.error) ? saveMut.error.userMessage : "Save failed."}{" "}
                  {rid(saveMut.error) ? `· Request ${rid(saveMut.error)}` : null} The count and key are kept — press
                  Save to retry.
                </p>
              ) : null}

              {line.trail.length ? (
                <section>
                  <h3 className="wc-section-label mb-1">This session</h3>
                  <ul className="flex flex-col gap-[2px] text-[11.5px] text-[var(--muted)]">
                    {line.trail.map((t) => (
                      <li key={t.id} className="tabular-nums">
                        {t.kind === "hit" ? "✓" : "↶"} {t.at} · {t.text}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {/* --------------------------------------------------- SAVED -- */}
          {phase === "saved" && saved ? (
            <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[var(--success-subtle)] p-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--success)]">
                <CheckCircle2 aria-hidden className="h-5 w-5" />
                Stock saved
              </div>
              <p className="text-[12.5px] text-[var(--foreground)]">
                {saved.name}
                {saved.lot ? ` · lot ${saved.lot}` : ""} — added{" "}
                <span className="font-semibold">
                  <QuantityDisplay value={saved.qty} />
                </span>
                . On hand <QuantityDisplay value={saved.onHand} />.
              </p>
              <div className="flex gap-2">
                <Button variant="primary" className="h-11" onClick={clearSession}>
                  Scan next product
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => router.push("/stock")}>
                  Back to Stock
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="wc-receive-side">
          <div className="rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-[12px]">
            <h3 className="wc-section-label mb-2">Destination</h3>
            <p className="text-[var(--foreground)]">Main · Default</p>
            <p className="mt-1 text-[var(--muted)]">
              Stock in always lands in the operational MAIN / DEFAULT storage. Transit storage is never a
              stock-in target.
            </p>
            <h3 className="wc-section-label mb-2 mt-4">How it works</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[var(--muted)]">
              <li>Pick the product first — before any scanning.</li>
              <li>Each scan verifies that the physical item matches the selected product.</li>
              <li>Scanning only counts locally. No stock moves until you Save.</li>
              <li>Save is one backend-confirmed movement for the whole session.</li>
              <li>Expired or same-day lots are accepted and flagged, not blocked.</li>
            </ul>
          </div>

          <label className="flex items-center gap-[6px] text-[11px] text-[var(--muted)]">
            <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            audible scan feedback
          </label>
        </aside>
      </div>

      <CameraBarcodeScanner
        open={cameraOpen}
        onOpenChange={(v) => {
          setCameraOpen(v);
          if (!v) requestAnimationFrame(() => scanner.focus());
        }}
        title="Scan an item"
        onDecode={(value) => {
          setCameraOpen(false);
          void handleScan(value);
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- utils --- */

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
