"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals, sumDecimals } from "@/lib/decimal";
import { formatBusinessDateTime, formatQty } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { attentionMessage, scanErrorKey } from "@/lib/order-copy";
import { queryKeys } from "@/lib/query/keys";
import {
  resolveBarcode,
  useCompletePacking,
  useCompletePicking,
  useProductLookup,
  useSalesOrder,
  useSalesOrders,
  useScanPack,
  useScanPick,
  useStartPicking,
  useUndoPack,
  useUndoPick,
  type ProductLite,
} from "@/lib/query/sales";
import { READY_MESSAGE, initialScanContext, scanReducer, type AmbiguityCandidate, type ScanContext } from "./scan-machine";
import { useScanner } from "./use-scanner";
import { useBeep } from "./use-beep";
import { CameraBarcodeScanner } from "./camera-barcode-scanner";
import { englishConsoleMessage, renderConsoleMessage, type ConsoleMessage, type MessageVar } from "./console-message";
import { WorkConsoleLayout } from "./work-console-layout";
import { ScanPanel } from "./scan-panel";
import { WorkLine } from "./work-line";
import { ProgressRing } from "./progress-ring";
import { AllocationPicker } from "./allocation-picker";
import { PrintPreview } from "./print-preview";
import {
  allocationsWithLocal,
  buildAmbiguityCandidates,
  buildCompletePayload,
  everyAllocationDone,
  findItemByAllocation,
  fulfillmentFailureIsDefinitive,
  mergeScanResult,
  reconcileAfterResync,
  seqAfter,
  type LocalProgress,
  type LocalSeq,
} from "./fulfillment-logic";

type Mode = "pick" | "pack";

interface ModeCfg {
  queueHref: string;
  requiredStatus: string;
  doneField: "picked_quantity" | "packed_quantity";
  limitField: "quantity" | "picked_quantity";
  /** suffix of this mode's message keys ("Pick" | "Pack") */
  k: "Pick" | "Pack";
}
const MODES: Record<Mode, ModeCfg> = {
  pick: { queueHref: "/picking", requiredStatus: "PICKING", doneField: "picked_quantity", limitField: "quantity", k: "Pick" },
  pack: { queueHref: "/packing", requiredStatus: "PACKING", doneField: "packed_quantity", limitField: "picked_quantity", k: "Pack" },
};

const EMPTY_LOOKUP: Record<number, ProductLite> = {};

/** R5 (D-R5-5): a GET-only refresh after a scan / undo whose outcome is unknown. */
type Resync =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; at: string }
  | { status: "failed" }
  /** the GET succeeded, but it cannot prove the earlier request has finished on the server */
  | { status: "unconfirmed"; at: string };

/**
 * An unresolved scan / undo outcome. While one exists every fulfilment
 * mutation is blocked. `settled` is true only while every unresolved failure
 * carried the backend's X-Request-ID: the backend sets it on every response
 * it produces (app/middleware/request_id.py), only after the handler's
 * UnitOfWork has committed or rolled back; the BFF forwards no inbound
 * X-Request-ID and its own 502 carries none. A later order GET therefore
 * reflects that request's final effect. Without that proof (network loss, BFF
 * or proxy failure) the request may still commit after any GET, so no GET can
 * resolve it and the lock stays.
 */
type Unresolved = { settled: boolean };
const backendSettled = (err: unknown): boolean => isApiError(err) && err.kind !== "network" && !!err.requestId;

export function FulfillmentConsole({ orderId, mode }: { orderId: number; mode: Mode }) {
  const cfg = MODES[mode];
  const t = useT();
  const copy = useOrderCopy();
  /** this mode's variant of a message key, e.g. mk("fulfil.complete") → "fulfil.completePick" */
  const mk = React.useCallback((base: string) => `${base}${cfg.k}` as MessageKey, [cfg.k]);
  const verb = t(mk("fulfil.verb"));
  const router = useRouter();
  const detailQ = useSalesOrder(orderId);
  const detail = detailQ.data;

  const productIds = React.useMemo(() => (detail ? detail.items.map((i) => i.product_id) : []), [detail]);
  const lookupQ = useProductLookup(productIds);
  const lookup = React.useMemo(() => lookupQ.data ?? EMPTY_LOOKUP, [lookupQ.data]);
  const productNameOf = React.useCallback(
    (id: number) => lookup[id]?.product_name ?? t("receive.productFallback", { id }),
    [lookup, t],
  );

  // Compose the order-level attention reason from the work-queue row (the
  // detail endpoint doesn't expose it — same gap handled in Phase 3).
  const attnQ = useSalesOrders(
    detail?.so_number ? { page: 1, page_size: 5, search: detail.so_number } : { page: 1, page_size: 1 },
  );
  const attentionReason = (detail && attnQ.data?.items.find((r) => r.id === orderId)?.attention_reason) || null;

  // Resolve each distinct line barcode once for lot / expiry visibility (FEFO).
  const barcodes = React.useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(lookup)
            .map((p) => p.barcode)
            .filter((b): b is string => !!b),
        ),
      ),
    [lookup],
  );
  const resolveQs = useQueries({
    queries: barcodes.map((b) => ({
      queryKey: queryKeys.scanResolve(b, mode === "pick" ? "pick" : "pack"),
      queryFn: () => resolveBarcode(b, mode === "pick" ? "pick" : "pack"),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const batchInfo = React.useMemo(() => {
    // batch_id -> { lot_no, expiry_date, days_to_expiry, is_expired, is_near_expiry }
    const map: Record<number, { lot_no: string | null; expiry_date: string | null; days_to_expiry: number | null; is_expired: boolean; is_near_expiry: boolean }> = {};
    for (const q of resolveQs) {
      for (const b of q.data?.batches ?? []) {
        map[b.id] = {
          lot_no: b.lot_no,
          expiry_date: b.expiry_date,
          days_to_expiry: b.days_to_expiry,
          is_expired: b.is_expired,
          is_near_expiry: b.is_near_expiry,
        };
      }
    }
    return map;
  }, [resolveQs]);

  const [local, setLocal] = React.useState<LocalProgress>({});
  // R5: when each local entry was recorded (D-R5-5 reconciliation)
  const seqRef = React.useRef(0);
  const localSeqRef = React.useRef<LocalSeq>({});
  const [resync, setResync] = React.useState<Resync>({ status: "idle" });
  const resyncIdRef = React.useRef(0);
  // the mutation lock: a ref so every handler reads it synchronously (no stale render), mirrored for rendering
  const unresolvedRef = React.useRef<Unresolved | null>(null);
  const [unresolved, setUnresolved] = React.useState<Unresolved | null>(null);

  const [flash, setFlash] = React.useState<Record<number, "hit" | "miss">>({});
  const [lineActivity, setLineActivity] = React.useState<Record<number, ConsoleMessage>>({});
  // the key spec behind the scan machine's current message (rendered in the UI language)
  const [scanSpec, setScanSpec] = React.useState<ConsoleMessage | null>(null);
  const [targetItemId, setTargetItemId] = React.useState<number | null>(null);
  const refocusRef = React.useRef<() => void>(() => {});
  const [scan, dispatch] = React.useReducer(scanReducer, initialScanContext);
  const [kbActive, setKbActive] = React.useState(false);
  const [ambig, setAmbig] = React.useState<{ code: string; productName: string; candidates: AmbiguityCandidate[] } | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [cameraOpen, setCameraOpen] = React.useState(false);

  const { enabled: soundOn, setEnabled: setSoundOn, beepOk, beepBad } = useBeep();

  const startMut = useStartPicking();
  const scanPickMut = useScanPick();
  const scanPackMut = useScanPack();
  const completePickMut = useCompletePicking();
  const completePackMut = useCompletePacking();
  const undoPickMut = useUndoPick();
  const undoPackMut = useUndoPack();
  const scanMut = mode === "pick" ? scanPickMut : scanPackMut;
  const completeMut = mode === "pick" ? completePickMut : completePackMut;
  const undoMut = mode === "pick" ? undoPickMut : undoPackMut;
  const resyncing = resync.status === "pending";
  const locked = unresolved !== null;

  /** an uncertain scan / undo: lock fulfilment mutations until it is reconciled */
  const markUnresolved = React.useCallback((err: unknown) => {
    const next = { settled: (unresolvedRef.current?.settled ?? true) && backendSettled(err) };
    unresolvedRef.current = next;
    setUnresolved(next);
  }, []);

  const say = React.useCallback((spec: ConsoleMessage) => {
    setScanSpec(spec);
    return englishConsoleMessage(spec);
  }, []);

  /** record a confirmed backend response for its allocation (the response is the authority) */
  const recordResult = React.useCallback((data: Parameters<typeof mergeScanResult>[1]) => {
    seqRef.current += 1;
    localSeqRef.current = { ...localSeqRef.current, [data.allocation_id]: seqRef.current };
    setLocal((p) => mergeScanResult(p, data));
  }, []);

  /**
   * D-R5-5: refresh progress from the existing order GET after an uncertain
   * scan / undo. It never repeats the mutation. Only a successful, validated
   * response is applied, and only to overlay entries older than the GET; a
   * newer resync supersedes an older one. A failed GET keeps the warning AND
   * the mutation lock; a successful GET lifts the lock only when every
   * unresolved failure is known to have finished on the server.
   */
  const startResync = React.useCallback(async () => {
    const id = ++resyncIdRef.current;
    const startSeq = seqRef.current;
    setResync({ status: "pending" });
    // a rejected refetch counts as a failed refresh — the console must never stay paused
    const result = await Promise.resolve()
      .then(() => detailQ.refetch())
      .catch(() => null);
    if (id !== resyncIdRef.current) return; // superseded by a newer refresh
    if (result?.isSuccess && result.data) {
      // read the LIVE sequence map: a response confirmed while the GET was in
      // flight is newer than the snapshot and must survive reconciliation
      const seqNow = localSeqRef.current;
      localSeqRef.current = seqAfter(seqNow, startSeq);
      setLocal((current) => reconcileAfterResync(current, seqNow, startSeq).local);
      const at = new Date().toISOString();
      if (unresolvedRef.current && !unresolvedRef.current.settled) {
        setResync({ status: "unconfirmed", at });
      } else {
        unresolvedRef.current = null;
        setUnresolved(null);
        setResync({ status: "done", at });
      }
    } else {
      setResync({ status: "failed" });
    }
    refocusRef.current();
  }, [detailQ]);

  const flashLine = React.useCallback((allocId: number, kind: "hit" | "miss") => {
    setFlash((f) => ({ ...f, [allocId]: kind }));
    window.setTimeout(
      () =>
        setFlash((f) => {
          const n = { ...f };
          delete n[allocId];
          return n;
        }),
      650,
    );
  }, []);

  const allocations = React.useMemo(() => (detail ? allocationsWithLocal(detail, local) : []), [detail, local]);
  const allComplete = allocations.length > 0 && everyAllocationDone(allocations, cfg.doneField);

  const productByBarcode = React.useCallback(
    (code: string) => Object.values(lookup).find((p) => p.barcode === code) ?? null,
    [lookup],
  );

  const openAmbiguity = React.useCallback(
    async (code: string) => {
      const product = productByBarcode(code);
      const item = detail?.items.find((i) => i.product_id === product?.id);
      const allocs = item?.fulfillment_allocations ?? [];
      let resolved: Awaited<ReturnType<typeof resolveBarcode>> | null = null;
      try {
        resolved = await resolveBarcode(code, mode === "pick" ? "pick" : "pack");
      } catch {
        /* expiry metadata is a bonus — proceed without it */
      }
      const candidates: AmbiguityCandidate[] = buildAmbiguityCandidates(allocs, resolved, local, cfg.doneField);
      dispatch({ type: "AMBIGUOUS", message: say({ key: "fulfil.errAllocationRequired" }), candidates });
      setAmbig({ code, productName: product?.product_name ?? code, candidates });
    },
    [productByBarcode, detail, local, cfg.doneField, mode, say],
  );

  const runScan = React.useCallback(
    (code: string, allocationId?: number, opts: { quantity?: string } = {}) => {
      if (!detail) return;
      if (unresolvedRef.current) {
        beepBad(); // blocked: nothing is sent while an earlier outcome is unresolved
        return;
      }
      dispatch({ type: "SUBMIT", code });
      scanMut.mutate(
        { id: orderId, barcode: code, allocation_id: allocationId, quantity: opts.quantity },
        {
          onSuccess: (data) => {
            recordResult(data);
            flashLine(data.allocation_id, "hit");
            beepOk();
            setTargetItemId(null);
            const item = findItemByAllocation(detail, data.allocation_id);
            const done = formatQty(data[cfg.doneField]);
            const of = formatQty(data.quantity);
            {
              const itId = item?.id;
              if (itId != null) setLineActivity((m) => ({ ...m, [itId]: { key: mk("fulfil.lineCounted"), vars: { done, of } } }));
            }
            const merged = allocationsWithLocal(detail, mergeScanResult(local, data));
            const allDone = everyAllocationDone(merged, cfg.doneField);
            const name = lookup[item?.product_id ?? -1]?.product_name;
            dispatch(
              allDone
                ? { type: "COMPLETE", message: say({ key: mk("fulfil.everyLineDone") }) }
                : {
                    type: "MATCH",
                    message: say({
                      key: "fulfil.counted",
                      vars: { name: name ?? { k: "fulfil.item" }, id: data.allocation_id, done, of },
                    }),
                  },
            );
          },
          onError: (err) => {
            const backendCode = isApiError(err) ? err.message : "";
            if (backendCode === "ALLOCATION_IDENTIFICATION_REQUIRED") {
              void openAmbiguity(code);
              return;
            }
            const product = productByBarcode(code);
            const item = detail.items.find((i) => i.product_id === product?.id);
            const firstAlloc = item?.fulfillment_allocations[0]?.id;
            if (firstAlloc != null) flashLine(firstAlloc, "miss");
            beepBad();
            const rid = isApiError(err) ? err.requestId : undefined;
            if (!fulfillmentFailureIsDefinitive(isApiError(err) ? err : null)) {
              // D-R5-5: the outcome is unknown — never "nothing counted"; refresh from the server
              markUnresolved(err);
              dispatch({ type: "ERROR", message: say({ key: "fulfil.scanUncertain", rid }), code: backendCode || null });
              void startResync();
              return;
            }
            const key = scanErrorKey(backendCode);
            const spec: ConsoleMessage = key
              ? { key, rid }
              : isApiError(err)
                ? { verbatim: err.userMessage, rid }
                : { key: "fulfil.scanFailed", rid };
            dispatch({ type: "ERROR", message: say(spec), code: backendCode || null });
          },
          onSettled: () => refocusRef.current(),
        },
      );
    },
    [detail, orderId, local, lookup, cfg, mk, say, flashLine, beepOk, beepBad, openAmbiguity, productByBarcode, scanMut, recordResult, startResync, markUnresolved],
  );

  const runUndo = React.useCallback(
    (allocationId: number, itemId: number) => {
      if (!detail || undoMut.isPending || unresolvedRef.current) return;
      undoMut.mutate(
        { id: orderId, allocation_id: allocationId, quantity: "1" },
        {
          onSuccess: (data) => {
            recordResult(data);
            beepOk();
            const done = formatQty(data[cfg.doneField]);
            const of = formatQty(data.quantity);
            setLineActivity((m) => ({ ...m, [itemId]: { key: mk("fulfil.lineUndone"), vars: { done, of } } }));
            dispatch({ type: "MATCH", message: say({ key: mk("fulfil.undoneMessage"), vars: { id: data.allocation_id, done, of } }) });
          },
          onError: (err) => {
            beepBad();
            const rid = isApiError(err) ? err.requestId : undefined;
            const uncertain = !fulfillmentFailureIsDefinitive(isApiError(err) ? err : null);
            if (uncertain) markUnresolved(err);
            const message: MessageVar = uncertain ? { k: "fulfil.undoUncertain" } : isApiError(err) ? err.userMessage : { k: "fulfil.undoFailedShort" };
            const msg = typeof message === "object" ? t(message.k) : String(message);
            const activity: ConsoleMessage = rid
              ? { key: "fulfil.undoFailedRequest", vars: { id: rid } }
              : { key: "fulfil.undoFailedMsg", vars: { message } };
            setLineActivity((m) => ({ ...m, [itemId]: activity }));
            toast.error(t(mk("fulfil.undoFailed")), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
            if (uncertain) void startResync();
          },
          onSettled: () => refocusRef.current(),
        },
      );
    },
    [detail, orderId, undoMut, cfg.doneField, mk, t, say, beepOk, beepBad, recordResult, startResync, markUnresolved],
  );

  // Global hardware-wedge / typed / camera scans go through here. When a line
  // is targeted (operator tapped [Scan +1]) the scan is attributed to that
  // line's single allocation; otherwise the backend resolves it. Either way
  // it is one scan → one backend round-trip → authoritative response.
  const handleScannerInput = React.useCallback(
    (code: string) => {
      if (targetItemId != null && detail) {
        const it = detail.items.find((x) => x.id === targetItemId);
        const single = it && it.fulfillment_allocations.length === 1 ? it.fulfillment_allocations[0].id : undefined;
        runScan(code, single);
        return;
      }
      runScan(code);
    },
    [targetItemId, detail, runScan],
  );

  const scanner = useScanner({ onScan: handleScannerInput, disabled: !detail });
  React.useEffect(() => {
    refocusRef.current = scanner.focus;
  }, [scanner.focus]);

  const targetName =
    targetItemId != null
      ? (lookup[detail?.items.find((i) => i.id === targetItemId)?.product_id ?? -1]?.product_name ?? t("fulfil.itemLower"))
      : null;

  const chooseAllocation = (allocationId: number) => {
    const code = ambig?.code;
    setAmbig(null);
    if (unresolvedRef.current) {
      dispatch({ type: "AMBIGUITY_CANCELLED" }); // the choice would send a scan: blocked
      beepBad();
      return;
    }
    if (code) runScan(code, allocationId);
  };

  const runComplete = () => {
    if (!detail || unresolvedRef.current) return;
    completeMut.mutate(
      { id: orderId, allocations: buildCompletePayload(allocations) },
      {
        onSuccess: (data) => {
          toast.success(t(mk("fulfil.completedToast"), { order: data.so_number ?? t("sales.order") }));
          router.push(mode === "pick" ? `/packing/${orderId}` : "/packing");
        },
        onError: (err) => {
          const msg = isApiError(err) ? err.userMessage : t("fulfil.couldNotComplete");
          const rid = isApiError(err) ? err.requestId : undefined;
          toast.error(t(mk("fulfil.completeFailed")), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
        },
      },
    );
  };

  /** the operator-facing text of the scan state (machine messages are shown in the UI language) */
  const scanMessage = (s: ScanContext): string => {
    if (s.state === "SCANNING" && s.code) return t("fulfil.checking", { code: s.code });
    if (scanSpec && englishConsoleMessage(scanSpec) === s.message) return renderConsoleMessage(scanSpec, t);
    if (s.message === READY_MESSAGE) return t("fulfil.readyMessage");
    if (s.message === "Cancelled — scan again.") return t("fulfil.cancelledScanAgain");
    return s.message;
  };

  /* ----------------- render guards ----------------- */
  if (detailQ.isLoading) return <LoadingState label={t(mk("fulfil.loadingConsole"))} />;
  if (detailQ.isError && !detail) return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detail) return <EmptyState message={t("fulfil.orderNotFound")} />;

  const status = detail.status.toUpperCase();

  // pick mode: allow starting from CONFIRMED
  if (mode === "pick" && status === "CONFIRMED") {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb mode={mode} soNumber={detail.so_number} />
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <h1 className="mono text-[18px] font-semibold">{detail.so_number}</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">{t("fulfil.readyToPick")}</p>
          <Button
            className="mt-4 h-11"
            variant="primary"
            disabled={startMut.isPending}
            onClick={() =>
              startMut.mutate(orderId, {
                onSuccess: () => toast.success(t("fulfil.pickingStarted", { order: detail.so_number ?? "" })),
                onError: (err) => {
                  const msg = isApiError(err) ? err.userMessage : t("fulfil.startFailedFallback");
                  const rid = isApiError(err) ? err.requestId : undefined;
                  toast.error(t("fulfil.startFailed"), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
                },
              })
            }
          >
            {startMut.isPending ? t("fulfil.starting") : t("fulfil.startPicking")}
          </Button>
        </div>
      </div>
    );
  }

  if (status !== cfg.requiredStatus) {
    const elsewhere = status === "PACKING" ? "/packing/" + orderId : status === "PICKING" ? "/picking/" + orderId : "/sales";
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb mode={mode} soNumber={detail.so_number} />
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[13px] text-[var(--muted)]">{t(mk("fulfil.notInStage"), { order: detail.so_number ?? "" })}</span>
          </div>
          <Button asChild className="mt-4 h-11" variant="secondary">
            <Link href={elsewhere}>
              {status === "PACKING" ? t("fulfil.openPacking") : status === "PICKING" ? t("fulfil.openPicking") : t("fulfil.viewOrder")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const totalRequired = sumDecimals(detail.items.map((i) => i.quantity), 3);
  const totalDone = sumDecimals(
    allocations.map((a) => a[cfg.doneField]),
    3,
  );
  const linesDone = detail.items.filter((it) => {
    const own = allocations.filter((a) => it.fulfillment_allocations.some((x) => x.id === a.id));
    return own.length > 0 && everyAllocationDone(own, cfg.doneField);
  }).length;

  const lockReason = !locked ? undefined : resyncing ? t("fulfil.refreshing") : t("fulfil.refreshProgress");

  const lines = detail.items.map((it) => {
    const itemAllocs = allocations.filter((a) => it.fulfillment_allocations.some((x) => x.id === a.id));
    const done = sumDecimals(itemAllocs.map((a) => a[cfg.doneField]), 3);
    const p = lookup[it.product_id];
    const singleBatch = it.batch_allocations.length === 1 ? it.batch_allocations[0].batch_id : null;
    const bi = singleBatch != null ? batchInfo[singleBatch] : undefined;
    const anyExpired = itemAllocs.some((a) => a.batch_id != null && batchInfo[a.batch_id]?.is_expired);
    const flashKey = itemAllocs[0]?.id;
    const singleAlloc = it.fulfillment_allocations.length === 1 ? it.fulfillment_allocations[0].id : undefined;
    // Undo needs one specific allocation. For a single-allocation line that's
    // unambiguous; a multi-allocation line undoes the first with progress.
    const undoAlloc =
      singleAlloc ?? itemAllocs.find((a) => compareDecimals(a[cfg.doneField], "0") > 0)?.id ?? itemAllocs[0]?.id;
    return (
      <WorkLine
        key={it.id}
        anchorId={`wc-line-${it.id}`}
        name={p?.product_name ?? t("receive.productFallback", { id: it.product_id })}
        sku={p?.sku ?? String(it.product_id)}
        // the line already prefixes "lot", so an unresolved batch is just its id ("lot #7")
        lotLabel={bi?.lot_no ?? (singleBatch != null ? `#${singleBatch}` : null)}
        expiry={
          bi
            ? { days: bi.days_to_expiry, iso: bi.expiry_date, isExpired: bi.is_expired }
            : anyExpired
              ? { days: -1, iso: null, isExpired: true }
              : null
        }
        done={done}
        required={it.quantity}
        verb={verb}
        targeted={targetItemId === it.id}
        onTargetScan={() => {
          setTargetItemId((cur) => (cur === it.id ? null : it.id));
          refocusRef.current();
        }}
        onUndo={undoAlloc != null ? () => runUndo(undoAlloc, it.id) : undefined}
        undoDisabledReason={undoMut.isPending ? t("fulfil.undoInProgress") : lockReason}
        targetDisabledReason={lockReason}
        lastActivity={lineActivity[it.id] ? renderConsoleMessage(lineActivity[it.id], t) : null}
        busy={scanMut.isPending || undoMut.isPending || locked}
        flash={flashKey != null ? (flash[flashKey] ?? null) : null}
      />
    );
  });

  const resyncBanner =
    resync.status === "pending" ? (
      <Banner tone="info" title={t("fulfil.refreshingTitle")}>
        {t("fulfil.refreshingBody")}
      </Banner>
    ) : resync.status === "done" ? (
      <Banner tone="warning" title={t("fulfil.refreshedTitle")}>
        {t("fulfil.refreshedBody", { at: formatBusinessDateTime(resync.at) })}
      </Banner>
    ) : resync.status === "unconfirmed" ? (
      <Banner
        tone="danger"
        title={t("fulfil.refreshedTitle")}
        actions={
          <Button size="sm" variant="secondary" onClick={() => void startResync()}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            {t("fulfil.refreshProgress")}
          </Button>
        }
      >
        <p>{t("fulfil.refreshedBody", { at: formatBusinessDateTime(resync.at) })}</p>
        <p className="mt-1">{t("fulfil.refreshFailedBody")}</p>
      </Banner>
    ) : resync.status === "failed" ? (
      <Banner
        tone="danger"
        title={t("fulfil.refreshFailedTitle")}
        actions={
          <Button size="sm" variant="secondary" onClick={() => void startResync()}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            {t("fulfil.refreshProgress")}
          </Button>
        }
      >
        {t("fulfil.refreshFailedBody")}
      </Banner>
    ) : null;

  const side = (
    <>
      <ScanPanel
        scanState={scan.state}
        message={scanMessage(scan)}
        scanner={scanner}
        onFocusChange={setKbActive}
        onCameraOpen={() => {
          if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur();
          setKbActive(false);
          setCameraOpen(true);
        }}
        sound={{ enabled: soundOn, setEnabled: setSoundOn }}
        disabled={(scanMut.isPending && scan.state === "SCANNING") || locked}
        targeting={targetName ? { label: t("fulfil.scanTarget", { name: targetName }), onClear: () => setTargetItemId(null) } : undefined}
        hint={t("fulfil.scanHint")}
      />
      <Button
        variant="primary"
        className="h-11 w-full"
        disabled={!allComplete || completeMut.isPending || locked}
        title={allComplete ? undefined : t(mk("fulfil.enabledOnce"))}
        onClick={runComplete}
      >
        {completeMut.isPending ? t("sales.completing") : t(mk("fulfil.complete"))}
      </Button>
      <p className="wc-console-hint text-[12px] text-[var(--muted)]">
        {allComplete ? t("fulfil.allDoneHint") : t(mk("fulfil.enabledOnly"))}
      </p>

      {mode === "pack" ? (
        <div className="wc-preview-panel">
          <h2 className="wc-section-label mb-2">{t("fulfil.printData")}</h2>
          <PrintPreview orderId={orderId} productName={productNameOf} />
        </div>
      ) : null}

      {/* iPhone: preview lives behind a secondary action, not in the scan dock */}
      {mode === "pack" ? (
        <div className="hidden max-[1023.98px]:block">
          <Button variant="secondary" className="h-11 w-full" onClick={() => setPreviewOpen(true)}>
            {t("fulfil.slipAndLabel")}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <WorkConsoleLayout
        kbActive={kbActive}
        breadcrumb={<Breadcrumb mode={mode} soNumber={detail.so_number} />}
        header={
          <div className="wc-work-head">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[var(--muted)]">{t(mk("fulfil.taskEyebrow"))}</div>
              <h1 className="mono text-[18px] font-semibold">{detail.so_number}</h1>
              <div className="text-[13px] text-[var(--muted)]">
                {t("fulfil.linesDone", { done: linesDone, total: detail.items.length })}
              </div>
            </div>
            <div className="ml-auto">
              <ProgressRing done={totalDone} total={totalRequired} label={t(mk("fulfil.progress"))} />
            </div>
          </div>
        }
        lines={
          <>
            {attentionReason ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[var(--warning-subtle)] p-3 text-[13px]"
              >
                <TriangleAlert aria-hidden className="h-4 w-4 flex-none text-[var(--warning)]" />
                <span>{copy(attentionMessage(attentionReason))}</span>
              </div>
            ) : null}
            {resyncBanner}
            {lines}
          </>
        }
        side={side}
      />

      {ambig ? (
        <AllocationPicker
          open={!!ambig}
          onOpenChange={(v) => !v && setAmbig(null)}
          productName={ambig.productName}
          candidates={ambig.candidates}
          onChoose={chooseAllocation}
          onCancel={() => {
            setAmbig(null);
            dispatch({ type: "AMBIGUITY_CANCELLED" });
          }}
        />
      ) : null}

      <CameraBarcodeScanner
        open={cameraOpen}
        onOpenChange={(v) => {
          setCameraOpen(v);
          if (!v) scanner.focus();
        }}
        title={t(mk("fulfil.cameraTitle"))}
        onDecode={(value) => {
          setCameraOpen(false);
          handleScannerInput(value);
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent title={t("fulfil.printData")} description={t("fulfil.printDataDescription")}>
          <PrintPreview orderId={orderId} enabled={previewOpen} productName={productNameOf} />
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost">{t("common.close")}</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Breadcrumb({ mode, soNumber }: { mode: Mode; soNumber: string | null }) {
  const t = useT();
  const cfg = MODES[mode];
  return (
    <nav className="flex items-center gap-1 text-[12px] text-[var(--muted)]" aria-label={t("fulfil.breadcrumb")}>
      <Link href={cfg.queueHref} className="inline-flex min-h-11 items-center font-medium hover:text-[var(--foreground)] min-[1024px]:min-h-0">
        {t(`fulfil.stage${cfg.k}` as MessageKey)}
      </Link>
      <ChevronRight aria-hidden className="h-3 w-3" />
      <span className="mono text-[var(--foreground)]">{soNumber ?? "—"}</span>
    </nav>
  );
}
