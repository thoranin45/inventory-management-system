"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals, subtractDecimals, sumDecimals } from "@/lib/decimal";
import { useReturnSalesOrder, useSalesOrder } from "@/lib/query/sales";
import { useProductLookup } from "@/lib/query/sales";
import {
  salesReturnLineInput,
  shipErrorCopy,
  type SalesReturnItemResult,
  type SalesReturnLineInput,
} from "@/lib/api/schemas/sales";

const inputCls =
  "min-h-11 w-28 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

interface LineDraft {
  product_id: number;
  ordered: string;
  quantity: string; // "return now"
  reason: string;
  error?: string;
}

function ReturnBody({ id, onClose }: { id: number; onClose: () => void }) {
  const detailQ = useSalesOrder(id);
  const detail = detailQ.data;
  const ret = useReturnSalesOrder();

  const productIds = React.useMemo(() => (detail?.items ?? []).map((it) => it.product_id), [detail]);
  const lookup = useProductLookup(productIds);
  const name = (pid: number) => lookup.data?.[pid]?.product_name ?? `Product #${pid}`;
  const sku = (pid: number) => lookup.data?.[pid]?.sku ?? "";

  // session-local: how much the backend has told us is already returned per product
  const [alreadyReturned, setAlreadyReturned] = React.useState<Record<number, string>>({});
  const [lines, setLines] = React.useState<Record<number, LineDraft>>({});
  const [formError, setFormError] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [results, setResults] = React.useState<SalesReturnItemResult[] | null>(null);

  // seed a draft row per order item once the detail loads (adjust-during-render)
  const [seededFor, setSeededFor] = React.useState<number | null>(null);
  if (detail && seededFor !== detail.id) {
    setSeededFor(detail.id);
    const init: Record<number, LineDraft> = {};
    for (const it of detail.items) {
      init[it.product_id] = { product_id: it.product_id, ordered: String(it.quantity), quantity: "", reason: "" };
    }
    setLines(init);
  }

  // clears the line error on edit; an explicit `error` in the patch wins.
  const setLine = (pid: number, patch: Partial<LineDraft>) =>
    setLines((s) => ({ ...s, [pid]: { ...s[pid], error: undefined, ...patch } }));

  const remainingReturnable = (pid: number, ordered: string) => {
    const already = alreadyReturned[pid] ?? "0";
    return subtractDecimals(ordered, already, 3);
  };

  const activeLines = Object.values(lines).filter((l) => l.quantity.trim() !== "");
  const total = sumDecimals(activeLines.map((l) => l.quantity.trim()), 3);

  const submit = () => {
    setFormError(null);
    if (activeLines.length === 0) {
      setFormError({ message: "Enter a quantity on at least one line." });
      return;
    }
    let bad = false;
    const payloadItems: SalesReturnLineInput[] = [];
    for (const l of activeLines) {
      const parsed = salesReturnLineInput.safeParse({ product_id: l.product_id, quantity: l.quantity.trim(), reason: l.reason.trim() || undefined });
      if (!parsed.success) {
        setLine(l.product_id, { error: parsed.error.issues[0].message });
        bad = true;
        continue;
      }
      const ceiling = remainingReturnable(l.product_id, l.ordered);
      if (compareDecimals(parsed.data.quantity, ceiling) > 0) {
        setLine(l.product_id, { error: `Can't exceed ${ceiling} (ordered minus already returned)` });
        bad = true;
        continue;
      }
      payloadItems.push(parsed.data);
    }
    if (bad) return;

    ret.mutate(
      { id, input: { items: payloadItems } },
      {
        onSuccess: (data) => {
          setResults(data.returned_items);
          setAlreadyReturned((s) => {
            const next = { ...s };
            for (const r of data.returned_items) next[r.product_id] = r.total_returned;
            return next;
          });
          // clear the quantities we just submitted, keep the rows for further returns
          setLines((s) => {
            const next = { ...s };
            for (const r of data.returned_items) if (next[r.product_id]) next[r.product_id] = { ...next[r.product_id], quantity: "", reason: "" };
            return next;
          });
          toast.success("Return recorded", { description: `${data.returned_items.length} line${data.returned_items.length === 1 ? "" : "s"} returned to stock` });
        },
        onError: (error) => {
          // draft quantities are preserved — we do not clear `lines` on error
          if (isApiError(error)) {
            setFormError({ message: shipErrorCopy(error.message) ?? error.userMessage, requestId: error.requestId });
          } else {
            setFormError({ message: "The return was rejected. Your entries are kept." });
          }
        },
      },
    );
  };

  if (detailQ.isLoading) return <p className="py-6 text-[13px] text-[var(--muted)]">Loading order lines…</p>;
  if (detailQ.isError || !detail) return <p className="py-6 text-[13px] text-[var(--danger)]">Could not load the order.</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-[var(--muted)]">
        Returns restore stock to the original allocation — the backend picks the batch, you don&apos;t. A return is a
        stock and audit event; it does <strong>not</strong> change the order status or process a refund.
      </p>

      <div className="flex flex-col gap-3">
        {detail.items.map((it) => {
          const l = lines[it.product_id];
          if (!l) return null;
          const already = alreadyReturned[it.product_id];
          const ceiling = remainingReturnable(it.product_id, l.ordered);
          const afterThis = l.quantity.trim() ? subtractDecimals(ceiling, l.quantity.trim(), 3) : ceiling;
          return (
            <div key={it.id} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="mb-2">
                <div className="text-[13px] font-medium">{name(it.product_id)}</div>
                <div className="mono text-[11px] text-[var(--faint)]">{sku(it.product_id)}</div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
                <span>Ordered <QuantityDisplay value={l.ordered} className="font-medium text-[var(--foreground)]" /></span>
                <span>Shipped <QuantityDisplay value={l.ordered} className="font-medium text-[var(--foreground)]" /></span>
                <span>
                  Already returned{" "}
                  {already !== undefined ? (
                    <QuantityDisplay value={already} className="font-medium text-[var(--foreground)]" />
                  ) : (
                    <span className="text-[var(--faint)]" title="Not exposed by GET /sales-orders/{id}; the backend enforces the true total">unknown until you submit</span>
                  )}
                </span>
                <span>Remaining returnable <QuantityDisplay value={afterThis} className="font-medium text-[var(--foreground)]" /></span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--muted)]">Return now</span>
                  <input
                    aria-label={`Return quantity for ${name(it.product_id)}`}
                    inputMode="decimal"
                    className={inputCls}
                    placeholder="0.000"
                    value={l.quantity}
                    onChange={(e) => setLine(it.product_id, { quantity: e.currentTarget.value })}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--muted)]">Reason (optional)</span>
                  <input
                    aria-label={`Return reason for ${name(it.product_id)}`}
                    className={`${inputCls} w-full`}
                    maxLength={255}
                    value={l.reason}
                    onChange={(e) => setLine(it.product_id, { reason: e.currentTarget.value })}
                  />
                </label>
              </div>
              {l.error ? <p className="mt-1 text-[11px] text-[var(--danger)]">{l.error}</p> : null}
            </div>
          );
        })}
      </div>

      {results ? (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-subtle)] p-2 text-[11.5px] text-[var(--foreground)]">
          <div className="mb-1 font-semibold text-[var(--success)]">Recorded by the backend</div>
          {results.map((r) => (
            <div key={r.product_id} className="mono">
              {name(r.product_id)}: returned <QuantityDisplay value={r.returned_quantity} /> · total returned{" "}
              <QuantityDisplay value={r.total_returned} /> · remaining <QuantityDisplay value={r.remaining_returnable} />
            </div>
          ))}
        </div>
      ) : null}

      {formError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              Request ID: <span className="mono select-all">{formError.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <span className="text-[12px] text-[var(--muted)]">
          Returning <QuantityDisplay value={total} className="font-semibold text-[var(--foreground)]" />
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={submit} disabled={ret.isPending || activeLines.length === 0}>
            {ret.isPending ? "Submitting…" : "Record return"}
          </Button>
        </span>
      </div>
    </div>
  );
}

export function ReturnDrawer({
  id,
  soNumber,
  open,
  onOpenChange,
}: {
  id: number | null;
  soNumber: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={`Return items — ${soNumber ?? "sales order"}`}>
        {open && id != null ? <ReturnBody id={id} onClose={() => onOpenChange(false)} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
