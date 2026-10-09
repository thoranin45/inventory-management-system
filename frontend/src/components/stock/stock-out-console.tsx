"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, ChevronRight, PackageMinus, ScanLine, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { CameraBarcodeScanner } from "@/components/work/camera-barcode-scanner";
import { useScanner } from "@/components/work/use-scanner";
import { useBeep } from "@/components/work/use-beep";
import { isApiError } from "@/lib/api/errors";
import { useProducts } from "@/lib/query/hooks";
import { resolveBarcode } from "@/lib/query/sales";
import { useSaveStockOutSession } from "@/lib/query/stock";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import {
  buildStockOutSaveBody,
  stockOutSetupInput,
  STOCK_OUT_ERROR_COPY,
  STOCK_OUT_STRATEGY_LABELS,
  type StockOutSaveBody,
  type StockOutStrategy,
} from "@/lib/api/schemas/stock-out";

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

interface TrailEntry {
  id: string;
  kind: "hit" | "undo";
  text: string;
  at: string;
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

export function StockOutConsole() {
  const router = useRouter();
  const { beepOk, beepBad, beepDone, enabled: soundOn, setEnabled: setSoundOn } = useBeep();

  const draft = useIdempotentDraft<SessionLine, StockOutSaveBody>({
    scope: "stock-out:session",
    keyPrefix: "stockout-",
    buildPayload,
  });
  const line = draft.lines[0] as SessionLine | undefined;

  const saveMut = useSaveStockOutSession();
  const [saved, setSaved] = React.useState<{ qty: string; onHand: string; name: string } | null>(null);
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
        const res = await resolveBarcode(code, "lookup");
        if (res.product.id === cur.productId) {
          bump(1, `barcode ${code} +1`);
          beepOk();
          setFeedback({ kind: "match", text: `Matched — ready to issue ${cur.count + 1}` });
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
  const overAvailable =
    line?.availableQty != null && line.count > Number(line.availableQty)
      ? { available: line.availableQty, count: line.count }
      : null;

  const save = () => {
    const body = draft.payload;
    if (!body || !line || line.count <= 0 || saveMut.isPending) return;
    saveMut.mutate(
      { body, idempotencyKey: draft.idempotencyKey },
      {
        onSuccess: (res) => {
          beepDone();
          setSaved({ qty: res.difference, onHand: res.current_stock, name: line.name });
          setMismatch(false);
          draft.commitSuccess(); // draft consumed — next session gets a fresh key
        },
        onError: (e) => {
          beepBad();
          // Never silently mint a new key when the original result is
          // uncertain: a reused key whose stored receipt no longer matches
          // this request (quantity/strategy/product changed, e.g. after a
          // timeout-then-retry) always surfaces as "start a new session" —
          // the operator must explicitly abandon it, not have the console
          // paper over the ambiguity on their behalf.
          if (isApiError(e) && e.status === 409 && /different payload/i.test(e.message)) {
            setMismatch(true);
            return;
          }
          const backend = isApiError(e) ? e.message : "";
          const copy =
            STOCK_OUT_ERROR_COPY[backend] ??
            (isApiError(e) ? e.userMessage : "The stock-out was rejected. Nothing was deducted.");
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
        <span className="text-[var(--foreground)]">Stock Out</span>
      </nav>

      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <div className="flex items-center gap-2 text-[16px] font-bold">
                <PackageMinus aria-hidden className="h-[18px] w-[18px] text-[var(--accent)]" />
                Stock Out
              </div>
              <div className="text-[12px] text-[var(--muted)]">
                {phase === "setup"
                  ? "Choose a product and a strategy, then scan the items you're removing. Scanning only counts — nothing is deducted until you Save."
                  : phase === "scanning"
                    ? "Scan each physical item you're removing. Each scan verifies it matches the selected product."
                    : "Stock issued."}
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
                  <div
                    className="flex items-center justify-between rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--sunken)] px-3 py-2 text-[12.5px]"
                    role="status"
                  >
                    <span className="text-[var(--muted)]">Available to issue</span>
                    <span className="font-semibold tabular-nums">
                      {line.availableQty != null ? <QuantityDisplay value={line.availableQty} /> : "—"}
                    </span>
                  </div>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-[12px] text-[var(--muted)]">Strategy</legend>
                    {(["fefo", "fifo"] as const).map((s) => {
                      const copy = STOCK_OUT_STRATEGY_LABELS[s];
                      const active = line.strategy === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => patch({ strategy: s })}
                          className={
                            "flex flex-col items-start gap-[2px] rounded-[var(--r-sm)] border px-3 py-2 text-left transition-colors " +
                            (active
                              ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                              : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--accent)]")
                          }
                          aria-pressed={active}
                        >
                          <span className="text-[13.5px] font-semibold">{copy.labelTh}</span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {copy.label} — {copy.sub}
                          </span>
                        </button>
                      );
                    })}
                  </fieldset>

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
                        placeholder="e.g. order pick"
                      />
                    </label>
                  </div>

                  <Button variant="primary" className="h-11" disabled={!setupValid} onClick={startScanning}>
                    Start scanning
                  </Button>
                </>
              ) : (
                <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-5 text-center text-[12.5px] text-[var(--muted)]">
                  Pick the product you are issuing. You choose it — and the FIFO/FEFO strategy — before scanning.
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
                    <span>{STOCK_OUT_STRATEGY_LABELS[line.strategy].labelTh}</span>
                    {line.availableQty != null ? (
                      <span>
                        available <QuantityDisplay value={line.availableQty} />
                      </span>
                    ) : null}
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
                  <span className="text-[var(--muted)]">Ready to issue </span>
                  <span className="text-[18px] font-bold tabular-nums">{line.count}</span>
                  {line.expected ? (
                    <span className="text-[var(--muted)]"> of {line.expected} expected</span>
                  ) : null}
                </div>
                <Button variant="ghost" size="sm" onClick={undoLast} disabled={line.count === 0 || saveMut.isPending}>
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

              {overAvailable ? (
                <p className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-subtle)] p-2 text-[12px] text-[var(--warning)]">
                  <TriangleAlert aria-hidden className="h-4 w-4 flex-none" />
                  Over the last-known available quantity — {overAvailable.count} of {overAvailable.available}. The
                  backend re-checks at Save; this is only a heads-up.
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
                    Its Idempotency-Key was already used for a different quantity, product, or strategy. Start a new
                    stock-out session to continue — a new key is issued only for a genuinely new session.
                  </span>
                  <Button variant="secondary" size="sm" className="self-start" onClick={clearSession}>
                    Start new stock-out session
                  </Button>
                </div>
              ) : null}

              <Button
                variant="primary"
                className="h-11"
                disabled={!draft.payload || line.count <= 0 || saveMut.isPending || mismatch}
                onClick={save}
              >
                {saveMut.isPending ? "Saving…" : `Issue ${line.count} ${line.count === 1 ? "item" : "items"}`}
              </Button>
              {saveMut.isError && !mismatch ? (
                <p className="text-[12px] text-[var(--danger)]">
                  {isApiError(saveMut.error) ? saveMut.error.userMessage : "Save failed."}{" "}
                  {rid(saveMut.error) ? `· Request ${rid(saveMut.error)}` : null} The count and key are kept — press
                  Issue to retry.
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
                Stock issued
              </div>
              <p className="text-[12.5px] text-[var(--foreground)]">
                {saved.name} — issued{" "}
                <span className="font-semibold">
                  <QuantityDisplay value={saved.qty} />
                </span>
                . On hand <QuantityDisplay value={saved.onHand} />.
              </p>
              <div className="flex gap-2">
                <Button variant="primary" className="h-11" onClick={clearSession}>
                  Issue next product
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
            <h3 className="wc-section-label mb-2">Source</h3>
            <p className="text-[var(--foreground)]">Main · Default</p>
            <p className="mt-1 text-[var(--muted)]">
              Stock out always draws from the operational MAIN / DEFAULT storage. Transit storage is never a
              stock-out source.
            </p>
            <h3 className="wc-section-label mb-2 mt-4">How it works</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[var(--muted)]">
              <li>Pick the product and the strategy first — before any scanning.</li>
              <li>FEFO issues the stock closest to expiry first; FIFO issues the oldest-received stock first.</li>
              <li>Each scan verifies that the physical item matches the selected product.</li>
              <li>Scanning only counts locally. Nothing is deducted until you Save.</li>
              <li>Save is one backend-confirmed deduction for the whole session.</li>
              <li>Expired lots are never selected, even by FEFO.</li>
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
