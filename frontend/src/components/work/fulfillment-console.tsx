"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals, sumDecimals, type DecimalString } from "@/lib/decimal";
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
  type ProductLite,
} from "@/lib/query/sales";
import {
  SCAN_ERROR_COPY,
  SO_ATTENTION_LABEL,
  type SalesOrderDetail,
} from "@/lib/api/schemas/sales";
import {
  initialScanContext,
  scanReducer,
  type AmbiguityCandidate,
} from "./scan-machine";
import { useScanner } from "./use-scanner";
import { useBeep } from "./use-beep";
import { WorkConsoleLayout } from "./work-console-layout";
import { ScanPanel } from "./scan-panel";
import { WorkLine } from "./work-line";
import { ProgressRing } from "./progress-ring";
import { AllocationPicker } from "./allocation-picker";
import { PrintPreview } from "./print-preview";

type Mode = "pick" | "pack";

interface ModeCfg {
  label: string;
  queueHref: string;
  requiredStatus: string;
  doneField: "picked_quantity" | "packed_quantity";
  limitField: "quantity" | "picked_quantity";
  verb: string;
}
const MODES: Record<Mode, ModeCfg> = {
  pick: {
    label: "Picking",
    queueHref: "/picking",
    requiredStatus: "PICKING",
    doneField: "picked_quantity",
    limitField: "quantity",
    verb: "Picked",
  },
  pack: {
    label: "Packing",
    queueHref: "/packing",
    requiredStatus: "PACKING",
    doneField: "packed_quantity",
    limitField: "picked_quantity",
    verb: "Packed",
  },
};

type LocalProgress = Record<number, { picked_quantity: DecimalString; packed_quantity: DecimalString }>;

const EMPTY_LOOKUP: Record<number, ProductLite> = {};

/** merge the immediate scan response over the server detail (no optimism) */
function allocationsWithLocal(detail: SalesOrderDetail, local: LocalProgress) {
  return detail.items.flatMap((it) =>
    it.fulfillment_allocations.map((a) => {
      const patch = local[a.id];
      return {
        ...a,
        product_id: it.product_id,
        item_quantity: it.quantity,
        picked_quantity: patch?.picked_quantity ?? a.picked_quantity,
        packed_quantity: patch?.packed_quantity ?? a.packed_quantity,
      };
    }),
  );
}

export function FulfillmentConsole({ orderId, mode }: { orderId: number; mode: Mode }) {
  const cfg = MODES[mode];
  const router = useRouter();
  const detailQ = useSalesOrder(orderId);
  const detail = detailQ.data;

  const productIds = React.useMemo(
    () => (detail ? detail.items.map((i) => i.product_id) : []),
    [detail],
  );
  const lookupQ = useProductLookup(productIds);
  const lookup = React.useMemo(() => lookupQ.data ?? EMPTY_LOOKUP, [lookupQ.data]);

  // Compose the order-level attention reason from the work-queue row (the
  // detail endpoint doesn't expose it — same gap handled in Phase 3).
  const attnQ = useSalesOrders(
    detail?.so_number ? { page: 1, page_size: 5, search: detail.so_number } : { page: 1, page_size: 1 },
  );
  const attentionReason =
    (detail && attnQ.data?.items.find((r) => r.id === orderId)?.attention_reason) || null;

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
  const [flash, setFlash] = React.useState<Record<number, "hit" | "miss">>({});
  const refocusRef = React.useRef<() => void>(() => {});
  const [scan, dispatch] = React.useReducer(scanReducer, initialScanContext);
  const [kbActive, setKbActive] = React.useState(false);
  const [ambig, setAmbig] = React.useState<{ code: string; productName: string; candidates: AmbiguityCandidate[] } | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const { enabled: soundOn, setEnabled: setSoundOn, beepOk, beepBad } = useBeep();

  const startMut = useStartPicking();
  const scanPickMut = useScanPick();
  const scanPackMut = useScanPack();
  const completePickMut = useCompletePicking();
  const completePackMut = useCompletePacking();
  const scanMut = mode === "pick" ? scanPickMut : scanPackMut;
  const completeMut = mode === "pick" ? completePickMut : completePackMut;

  const flashLine = React.useCallback((allocId: number, kind: "hit" | "miss") => {
    setFlash((f) => ({ ...f, [allocId]: kind }));
    window.setTimeout(() => setFlash((f) => {
      const n = { ...f };
      delete n[allocId];
      return n;
    }), 650);
  }, []);

  const allocations = React.useMemo(
    () => (detail ? allocationsWithLocal(detail, local) : []),
    [detail, local],
  );
  const allComplete =
    allocations.length > 0 &&
    allocations.every((a) => compareDecimals(a[cfg.doneField], a.quantity) >= 0);

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
      const candidates: AmbiguityCandidate[] = allocs.map((a) => {
        const b = a.batch_id != null ? resolved?.batches.find((x) => x.id === a.batch_id) : undefined;
        const patch = local[a.id];
        return {
          allocation_id: a.id,
          batch_id: a.batch_id,
          quantity: a.quantity,
          done: (patch?.[cfg.doneField] ?? a[cfg.doneField]) as string,
          lot_no: b?.lot_no ?? null,
          expiry_date: b?.expiry_date ?? null,
          days_to_expiry: b?.days_to_expiry ?? null,
          is_expired: b?.is_expired,
          is_near_expiry: b?.is_near_expiry,
        };
      });
      dispatch({ type: "AMBIGUOUS", message: SCAN_ERROR_COPY.ALLOCATION_IDENTIFICATION_REQUIRED, candidates });
      setAmbig({ code, productName: product?.product_name ?? code, candidates });
    },
    [productByBarcode, detail, local, cfg.doneField, mode],
  );

  const runScan = React.useCallback(
    (code: string, allocationId?: number, opts: { quantity?: string } = {}) => {
      if (!detail) return;
      dispatch({ type: "SUBMIT", code });
      scanMut.mutate(
        { id: orderId, barcode: code, allocation_id: allocationId, quantity: opts.quantity },
        {
          onSuccess: (data) => {
            setLocal((p) => ({
              ...p,
              [data.allocation_id]: {
                picked_quantity: data.picked_quantity,
                packed_quantity: data.packed_quantity,
              },
            }));
            flashLine(data.allocation_id, "hit");
            beepOk();
            const merged = allocationsWithLocal(detail, {
              ...local,
              [data.allocation_id]: {
                picked_quantity: data.picked_quantity,
                packed_quantity: data.packed_quantity,
              },
            });
            const done = merged.every((a) => compareDecimals(a[cfg.doneField], a.quantity) >= 0);
            const name = lookup[
              detail.items.find((it) =>
                it.fulfillment_allocations.some((a) => a.id === data.allocation_id),
              )?.product_id ?? -1
            ]?.product_name;
            dispatch(
              done
                ? { type: "COMPLETE", message: `Every line is ${cfg.verb.toLowerCase()}. Review and complete ${cfg.label.toLowerCase()}.` }
                : {
                    type: "MATCH",
                    message: `${name ?? "Item"} counted — allocation ${data.allocation_id} now ${data[cfg.doneField]} / ${data.quantity}.`,
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
            const msg =
              SCAN_ERROR_COPY[backendCode] ??
              (isApiError(err) ? err.userMessage : "Scan failed. Nothing was counted.");
            const rid = isApiError(err) ? err.requestId : undefined;
            dispatch({
              type: "ERROR",
              message: rid ? `${msg} · Request ${rid}` : msg,
              code: backendCode || null,
            });
          },
          onSettled: () => refocusRef.current(),
        },
      );
    },
    [detail, orderId, local, lookup, cfg, flashLine, beepOk, beepBad, openAmbiguity, productByBarcode, scanMut],
  );

  const scanner = useScanner({ onScan: runScan, disabled: !detail });
  React.useEffect(() => {
    refocusRef.current = scanner.focus;
  }, [scanner.focus]);

  const chooseAllocation = (allocationId: number) => {
    const code = ambig?.code;
    setAmbig(null);
    if (code) runScan(code, allocationId);
  };

  const runComplete = () => {
    if (!detail) return;
    completeMut.mutate(
      { id: orderId, allocations: allocations.map((a) => ({ allocation_id: a.id, quantity: a.quantity })) },
      {
        onSuccess: (data) => {
          toast.success(
            mode === "pick" ? `${data.so_number ?? "Order"} → Packing` : `${data.so_number ?? "Order"} → Ready to ship`,
          );
          router.push(mode === "pick" ? `/packing/${orderId}` : "/packing");
        },
        onError: (err) => {
          const msg = isApiError(err) ? err.userMessage : "Could not complete.";
          const rid = isApiError(err) ? err.requestId : undefined;
          toast.error(`Complete ${cfg.label.toLowerCase()} failed`, {
            description: rid ? `${msg} · Request ${rid}` : msg,
          });
        },
      },
    );
  };

  /* ----------------- render guards ----------------- */
  if (detailQ.isLoading) return <LoadingState label={`Loading ${cfg.label.toLowerCase()} console…`} />;
  if (detailQ.isError)
    return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detail) return <EmptyState message="Order not found." />;

  const status = detail.status.toUpperCase();

  // pick mode: allow starting from CONFIRMED
  if (mode === "pick" && status === "CONFIRMED") {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb mode={mode} soNumber={detail.so_number} />
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-[15px] font-semibold">{detail.so_number}</h2>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            This order is confirmed and ready to pick. Starting picking locks its allocations for the
            floor.
          </p>
          <Button
            className="mt-4"
            variant="primary"
            disabled={startMut.isPending}
            onClick={() =>
              startMut.mutate(orderId, {
                onSuccess: () => toast.success(`${detail.so_number} — picking started`),
                onError: (err) => {
                  const msg = isApiError(err) ? err.userMessage : "Could not start picking.";
                  const rid = isApiError(err) ? err.requestId : undefined;
                  toast.error("Start picking failed", { description: rid ? `${msg} · Request ${rid}` : msg });
                },
              })
            }
          >
            {startMut.isPending ? "Starting…" : "Start picking"}
          </Button>
        </div>
      </div>
    );
  }

  if (status !== cfg.requiredStatus) {
    const elsewhere =
      status === "PACKING" ? "/packing/" + orderId : status === "PICKING" ? "/picking/" + orderId : "/sales";
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb mode={mode} soNumber={detail.so_number} />
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[13px] text-[var(--muted)]">
              {detail.so_number} is not in {cfg.label.toLowerCase()}.
            </span>
          </div>
          <Button asChild className="mt-4" variant="secondary">
            <Link href={elsewhere}>
              {status === "PACKING" ? "Open packing console" : status === "PICKING" ? "Open picking console" : "View order"}
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

  const lines = detail.items.map((it) => {
    const itemAllocs = allocations.filter((a) =>
      it.fulfillment_allocations.some((x) => x.id === a.id),
    );
    const done = sumDecimals(itemAllocs.map((a) => a[cfg.doneField]), 3);
    const p = lookup[it.product_id];
    const singleBatch = it.batch_allocations.length === 1 ? it.batch_allocations[0].batch_id : null;
    const bi = singleBatch != null ? batchInfo[singleBatch] : undefined;
    const anyExpired = itemAllocs.some((a) => a.batch_id != null && batchInfo[a.batch_id]?.is_expired);
    const flashKey = itemAllocs[0]?.id;
    return (
      <WorkLine
        key={it.id}
        anchorId={`wc-line-${it.id}`}
        name={p?.product_name ?? `Product #${it.product_id}`}
        sku={p?.sku ?? String(it.product_id)}
        lotLabel={bi?.lot_no ?? (singleBatch != null ? `batch #${singleBatch}` : null)}
        expiry={
          bi
            ? { days: bi.days_to_expiry, iso: bi.expiry_date, isExpired: bi.is_expired }
            : anyExpired
              ? { days: -1, iso: null, isExpired: true }
              : null
        }
        done={done}
        required={it.quantity}
        verb={cfg.verb}
        onPlusOne={() => {
          const barcode = p?.barcode;
          if (!barcode) {
            toast.error("No barcode on file for this product — scan it instead.");
            return;
          }
          const single = it.fulfillment_allocations.length === 1 ? it.fulfillment_allocations[0].id : undefined;
          runScan(barcode, single, { quantity: "1" });
        }}
        plusDisabledReason={p?.barcode ? undefined : "No barcode on file — use the scanner"}
        busy={scanMut.isPending}
        flash={flashKey != null ? flash[flashKey] ?? null : null}
      />
    );
  });

  const side = (
    <>
      <ScanPanel
        scanState={scan.state}
        message={scan.message}
        scanner={scanner}
        onFocusChange={setKbActive}
        sound={{ enabled: soundOn, setEnabled: setSoundOn }}
        disabled={scanMut.isPending && scan.state === "SCANNING"}
        hint={
          <>
            Scan every line to its required quantity. Wrong item, unknown barcode and over-scan are
            all rejected by the backend — nothing is counted.
          </>
        }
      />
      <Button
        variant="primary"
        className="h-11 w-full"
        disabled={!allComplete || completeMut.isPending}
        title={allComplete ? undefined : `Enabled once every line is fully ${cfg.verb.toLowerCase()}`}
        onClick={runComplete}
      >
        {completeMut.isPending ? "Completing…" : `Complete ${cfg.label.toLowerCase()}`}
      </Button>
      <p className="wc-console-hint text-[11px] text-[var(--muted)]">
        {allComplete
          ? "All lines done — this moves the order forward and locks the quantities."
          : `Enabled only when every line is fully ${cfg.verb.toLowerCase()}.`}
      </p>

      {mode === "pack" ? (
        <div className="wc-preview-panel">
          <h4 className="wc-section-label mb-2">Print data</h4>
          <PrintPreview orderId={orderId} />
        </div>
      ) : null}

      {/* iPhone: preview lives behind a secondary action, not in the scan dock */}
      {mode === "pack" ? (
        <div className="hidden max-[1023.98px]:block">
          <Button variant="secondary" className="w-full" onClick={() => setPreviewOpen(true)}>
            Packing slip &amp; label data
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
            <div>
              <div className="mono text-[16px] font-bold">{detail.so_number}</div>
              <div className="text-[12px] text-[var(--muted)]">
                {detail.items.length} lines · {cfg.label.toLowerCase()}
              </div>
            </div>
            <div className="ml-auto">
              <ProgressRing done={totalDone} total={totalRequired} label={`${cfg.verb} progress`} />
            </div>
          </div>
        }
        lines={
          <>
            {attentionReason ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[var(--warning-subtle)] p-3 text-[12px]"
              >
                <TriangleAlert aria-hidden className="h-4 w-4 flex-none text-[var(--warning)]" />
                <span>{SO_ATTENTION_LABEL[attentionReason] ?? `Needs attention: ${attentionReason.replace(/_/g, " ")}.`}</span>
              </div>
            ) : null}
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

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent title="Print data" description="Read-only data from the backend.">
          <PrintPreview orderId={orderId} enabled={previewOpen} />
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost">Close</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Breadcrumb({ mode, soNumber }: { mode: Mode; soNumber: string | null }) {
  const cfg = MODES[mode];
  return (
    <nav className="flex items-center gap-1 text-[12px] text-[var(--muted)]" aria-label="Breadcrumb">
      <Link href={cfg.queueHref} className="font-medium hover:text-[var(--foreground)]">
        {cfg.label}
      </Link>
      <ChevronRight aria-hidden className="h-3 w-3" />
      <span className="mono text-[var(--foreground)]">{soNumber ?? "—"}</span>
    </nav>
  );
}
