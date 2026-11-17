"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { subtractDecimals } from "@/lib/decimal";
import { useIdempotentDraft } from "@/lib/idempotent-draft";
import { useReturnSalesOrder, useSalesOrder } from "@/lib/query/sales";
import { useProductLookup } from "@/lib/query/sales";
import { useT } from "@/lib/i18n/client";
import { formMessage, shipErrorMessage } from "@/lib/order-copy";
import { type SalesReturnItemResult } from "@/lib/api/schemas/sales";
import {
  clearReturnedLines,
  isReturnKeyConflict,
  mergeReturnedTotals,
  returnTotal,
  validateReturnLines,
  type ReturnLineDraft,
} from "@/lib/workflow/return-submission";
import { useIdempotentSubmission } from "@/lib/workflow/use-idempotent-submission";

// The draft hook is used only for its persisted per-intent Idempotency-Key; the
// drawer keeps its own line state, so there is no draft payload.
const noDraftPayload = () => null;

const inputCls =
  "min-h-11 w-28 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)]";

/** The drawer's running total; "—" while any entered quantity is not yet a number. */
function ReturningTotal({ total }: { total: string | null }) {
  return total !== null ? (
    <QuantityDisplay value={total} className="font-semibold text-[var(--foreground)]" />
  ) : (
    <span className="font-semibold text-[var(--foreground)]">—</span>
  );
}

type LineDraft = ReturnLineDraft;

function ReturnBody({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useT();
  const copy = useOrderCopy();
  const detailQ = useSalesOrder(id);
  const detail = detailQ.data;
  const ret = useReturnSalesOrder();
  // V1-H1: one Idempotency-Key per return intent, kept (sessionStorage) across
  // errors, timeouts and reloads so resubmitting the same return replays it
  // instead of restocking twice; rotated only after a confirmed success or an
  // explicit "Start a new return".
  const draft = useIdempotentDraft<never, null>({
    scope: `sales-return:${id}`,
    keyPrefix: "so-ret-",
    buildPayload: noDraftPayload,
  });
  // a 409 key conflict blocks resubmission until the operator starts a new return
  const submission = useIdempotentSubmission({ draft, mutate: ret.mutate, isMismatch: isReturnKeyConflict });
  const keyConflict = submission.mismatch;

  const productIds = React.useMemo(() => (detail?.items ?? []).map((it) => it.product_id), [detail]);
  const lookup = useProductLookup(productIds);
  const name = (pid: number) => lookup.data?.[pid]?.product_name ?? t("receive.productFallback", { id: pid });
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
  // A quantity still being typed ("1.") or invalid ("abc") is not a number: the
  // total is unknown (shown as "—"), never computed (that threw during render)
  // and never counted as zero. Submit still validates every line.
  const total = returnTotal(activeLines);

  const submit = () => {
    setFormError(null);
    if (activeLines.length === 0) {
      setFormError({ message: t("sales.returnEnterQty") });
      return;
    }
    const checked = validateReturnLines(activeLines, (l) => remainingReturnable(l.product_id, l.ordered));
    if (!checked.ok) {
      for (const [pid, problem] of Object.entries(checked.problems)) {
        setLine(Number(pid), {
          error:
            problem.kind === "invalid"
              ? copy(formMessage(problem.message))
              : t("sales.returnCeiling", { ceiling: problem.ceiling }),
        });
      }
      return;
    }

    // recorded: the next return is a new intent with a new key (commitSuccess)
    submission.submit(
      { id, input: { items: checked.items } },
      {
        onSuccess: (data) => {
          setResults(data.returned_items);
          setAlreadyReturned((s) => mergeReturnedTotals(s, data.returned_items));
          // clear the quantities we just submitted, keep the rows for further returns
          setLines((s) => clearReturnedLines(s, data.returned_items));
          toast.success(t("sales.returnRecorded"), { description: t(data.returned_items.length === 1 ? "sales.returnLineToStock" : "sales.returnLinesToStock", { n: data.returned_items.length }) });
        },
        onError: (error) => {
          // draft quantities and the Idempotency-Key are preserved — resubmitting the
          // same return reuses the key, so an already-recorded return is replayed
          if (isApiError(error)) {
            const m = shipErrorMessage(error.message);
            setFormError({ message: m ? copy(m) : error.userMessage, requestId: error.requestId });
          } else {
            setFormError({ message: t("sales.returnRejectedKept") });
          }
        },
      },
    );
  };

  if (detailQ.isLoading) return <p className="py-6 text-[13px] text-[var(--muted)]">{t("sales.loadingLines")}</p>;
  if (detailQ.isError || !detail) return <p className="py-6 text-[13px] text-[var(--danger)]">{t("sales.loadOrderFailed")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-[var(--muted)]">{t("sales.returnIntro")}</p>

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
                <div className="mono text-[12px] text-[var(--faint)]">{sku(it.product_id)}</div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
                <span>{t("receive.ordered")} <QuantityDisplay value={l.ordered} className="font-medium text-[var(--foreground)]" /></span>
                <span>{t("status.SHIPPED")} <QuantityDisplay value={l.ordered} className="font-medium text-[var(--foreground)]" /></span>
                <span>
                  {t("sales.alreadyReturned")}{" "}
                  {already !== undefined ? (
                    <QuantityDisplay value={already} className="font-medium text-[var(--foreground)]" />
                  ) : (
                    <span className="text-[var(--faint)]" title={t("sales.alreadyReturnedTitle")}>{t("sales.unknownUntilSubmit")}</span>
                  )}
                </span>
                <span>{t("sales.remainingReturnable")} <QuantityDisplay value={afterThis} className="font-medium text-[var(--foreground)]" /></span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-[var(--muted)]">{t("sales.returnNow")}</span>
                  <input
                    aria-label={t("sales.returnQtyFor", { name: name(it.product_id) })}
                    inputMode="decimal"
                    className={inputCls}
                    placeholder="0.000"
                    value={l.quantity}
                    onChange={(e) => setLine(it.product_id, { quantity: e.currentTarget.value })}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[12px] font-semibold text-[var(--muted)]">{t("sales.reasonOptional")}</span>
                  <input
                    aria-label={t("sales.returnReasonFor", { name: name(it.product_id) })}
                    className={`${inputCls} w-full`}
                    maxLength={255}
                    value={l.reason}
                    onChange={(e) => setLine(it.product_id, { reason: e.currentTarget.value })}
                  />
                </label>
              </div>
              {l.error ? <p className="mt-1 text-[12px] text-[var(--danger)]">{l.error}</p> : null}
            </div>
          );
        })}
      </div>

      {results ? (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-subtle)] p-2 text-[12px] text-[var(--foreground)]">
          <div className="mb-1 font-semibold text-[var(--success)]">{t("sales.recordedByBackend")}</div>
          {results.map((r) => (
            <div key={r.product_id} className="mono">
              {name(r.product_id)}: {t("sales.returnedWord")} <QuantityDisplay value={r.returned_quantity} /> · {t("sales.totalReturnedWord")}{" "}
              <QuantityDisplay value={r.total_returned} /> · {t("sales.remainingWord")} <QuantityDisplay value={r.remaining_returnable} />
            </div>
          ))}
        </div>
      ) : null}

      {formError ? <ActionError message={formError.message} requestId={formError.requestId} /> : null}

      {keyConflict ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              draft.startNewDraft();
              submission.clearMismatch();
              setFormError(null);
            }}
          >
            {t("sales.startNewReturn")}
          </Button>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3">
        <span className="text-[12px] text-[var(--muted)]">
          {t("sales.returningWord")} <ReturningTotal total={total} />
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={ret.isPending || keyConflict || activeLines.length === 0}>
            {ret.isPending ? t("receive.submitting") : t("sales.recordReturn")}
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
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("sales.returnTitle", { order: soNumber ?? t("sales.salesOrderLower") })}>
        {open && id != null ? <ReturnBody id={id} onClose={() => onOpenChange(false)} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
