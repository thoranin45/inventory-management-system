"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Keyboard, Minus, Plus, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { Banner } from "@/components/ui/states";
import { DEFAULT_SCANNER_TIMING, type ScannerTiming } from "@/components/work/use-scanner";
import { sessionStore } from "@/lib/idempotent-draft";
import { formatBusinessDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import {
  clearAttempt,
  parseTypedQuantity,
  readAttempt,
  recoverAfterReload,
  stepTypedQuantity,
  writeAttempt,
  type AttemptRecord,
  type EntryMode,
  type TypedQuantity,
} from "@/lib/workflow/quantity-entry";

/* ------------------------------------------------------- attempt state --- */

/**
 * The console's view of its draft's attempt record (see AttemptRecord). It is
 * re-read from sessionStorage whenever the draft changes — so a reload
 * restores the lock — and an in-flight record found that way is treated as
 * uncertain. Nothing is ever retried automatically.
 */
export function useStockAttempt<Body>(
  scope: string,
  draft: { draftId: string; idempotencyKey: string; ready: boolean },
) {
  const [state, setState] = React.useState<{ draftId: string; rec: AttemptRecord<Body> | null } | null>(null);
  if (draft.ready && state?.draftId !== draft.draftId) {
    const rec = readAttempt<Body>(sessionStore(), scope, draft.draftId, draft.idempotencyKey);
    setState({ draftId: draft.draftId, rec: rec ? recoverAfterReload(rec) : null });
  }
  const attempt = state && state.draftId === draft.draftId ? state.rec : null;

  /** Persist BEFORE sending; `false` means it was not stored and nothing may be sent. */
  const record = React.useCallback(
    (rec: AttemptRecord<Body>) => {
      if (!writeAttempt(sessionStore(), scope, rec)) return false;
      setState({ draftId: rec.draftId, rec });
      return true;
    },
    [scope],
  );
  /** The outcome is unknown: keep the lock (persisted when possible, in memory regardless). */
  const markUncertain = React.useCallback(
    (rec: AttemptRecord<Body>) => {
      writeAttempt(sessionStore(), scope, rec);
      setState({ draftId: rec.draftId, rec });
    },
    [scope],
  );
  const clear = React.useCallback(
    (draftId: string) => {
      clearAttempt(sessionStore(), scope, draftId);
      setState((s) => (s && s.draftId === draftId ? { draftId, rec: null } : s));
    },
    [scope],
  );
  return { attempt, record, markUncertain, clear };
}

/** "Scan Count · 4 scanned" / "Entered quantity" for an attempt or the live session. */
function methodText(t: ReturnType<typeof useT>, mode: EntryMode, quantity: string) {
  return mode === "scan" ? t("qtyEntry.methodScan", { n: quantity }) : t("qtyEntry.methodTyped");
}

/** The lock's explanation and its two ways forward. */
export function UncertainAttemptBanner({
  onRetry,
  onAbandon,
  disabled,
}: {
  onRetry: () => void;
  onAbandon: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <Banner
      tone="warning"
      title={t("qtyEntry.uncertainTitle")}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={onRetry} disabled={disabled}>
            {t("qtyEntry.retrySame")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onAbandon} disabled={disabled}>
            {t("qtyEntry.abandon")}
          </Button>
        </>
      }
    >
      {t("qtyEntry.uncertainBody")}
    </Banner>
  );
}

/**
 * TQ-4: the ONLY way to drop an uncertain attempt. It says plainly that the
 * earlier request may have been recorded and that abandoning reverses
 * nothing, shows what is known about the attempt, and links to the product's
 * movement history (the ledger's verified `product_id` filter).
 */
export function AbandonAttemptDialog<Body>({
  open,
  onOpenChange,
  attempt,
  productId,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attempt: AttemptRecord<Body> | null;
  productId: number | null;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("qtyEntry.abandonTitle")} description={t("qtyEntry.abandonDescription")}>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
          <li>{t("qtyEntry.abandonWarn1")}</li>
          <li>{t("qtyEntry.abandonWarn2")}</li>
          <li className="font-semibold text-[var(--danger)]">{t("qtyEntry.abandonWarn3")}</li>
          <li>{t("qtyEntry.abandonWarn4")}</li>
        </ul>
        {attempt ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[12px]">
            <dt className="text-[var(--muted)]">{t("qtyEntry.lastAttempt")}</dt>
            <dd>
              {attempt.quantity ? (
                <>
                  {methodText(t, attempt.mode, attempt.mode === "scan" ? attempt.quantity : "")} ·{" "}
                  <QuantityDisplay value={attempt.quantity} className="font-semibold" />
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-[var(--muted)]">{t("qtyEntry.sentAt")}</dt>
            <dd className="mono">{attempt.at ? formatBusinessDateTime(attempt.at) : "—"}</dd>
            <dt className="text-[var(--muted)]">{t("qtyEntry.lastResponse")}</dt>
            <dd>
              {attempt.lastError ? (
                <>
                  {attempt.lastError.status ? `${attempt.lastError.status} · ` : ""}
                  {attempt.lastError.message}
                  {attempt.lastError.requestId ? (
                    <span className="mono select-all"> · {attempt.lastError.requestId}</span>
                  ) : null}
                </>
              ) : (
                t("qtyEntry.noResponse")
              )}
            </dd>
          </dl>
        ) : null}
        {/* phones stack in DOM order, so the destructive action is always last */}
        <div className="mt-3 flex flex-col gap-2 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:justify-end">
          {productId != null ? (
            <Button asChild variant="secondary">
              <Link href={`/inventory/ledger?product_id=${productId}`}>
                <BookOpen aria-hidden className="h-4 w-4" />
                {t("qtyEntry.checkLedger")}
              </Link>
            </Button>
          ) : null}
          <DialogClose asChild>
            <Button variant="ghost">{t("qtyEntry.keepAttempt")}</Button>
          </DialogClose>
          <Button variant="danger" onClick={onConfirm}>
            {t("qtyEntry.confirmAbandon")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Review-sheet text for the entry method of a session. */
export function useMethodText() {
  const t = useT();
  return (mode: EntryMode, scanCount: number) => methodText(t, mode, String(scanCount));
}

/* ------------------------------------------------------- mode selector --- */

/**
 * R4-TQ — Scan Count | Enter Quantity, as a radio group (arrow keys move the
 * choice). `disabled` while an attempt may have reached the server.
 */
export function EntryModeSelector({
  mode,
  onChange,
  disabled,
  lockedNote,
}: {
  mode: EntryMode;
  onChange: (mode: EntryMode) => void;
  disabled?: boolean;
  /** why the choice is locked (shown and announced) */
  lockedNote?: string;
}) {
  const t = useT();
  const options: { value: EntryMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: "scan", label: t("qtyEntry.modeScan"), icon: ScanLine },
    { value: "typed", label: t("qtyEntry.modeTyped"), icon: Keyboard },
  ];
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const noteId = React.useId();

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (disabled) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = options[(index + 1) % options.length];
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label={t("qtyEntry.modeLabel")}
        aria-describedby={disabled && lockedNote ? noteId : undefined}
        className="grid grid-cols-2 gap-1 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface-sunken)] p-1"
      >
        {options.map((o, i) => {
          const active = o.value === mode;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--r-xs,4px)] px-3 text-[14px] font-semibold outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[0_1px_2px_rgba(16,24,40,0.12)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {o.label}
            </button>
          );
        })}
      </div>
      {disabled && lockedNote ? (
        <p id={noteId} className="text-[12px] text-[var(--muted)]">
          {lockedNote}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- typed quantity --- */

const ERROR_KEY: Partial<Record<TypedQuantity["status"], MessageKey>> = {
  invalid: "qtyEntry.errFormat",
  too_precise: "qtyEntry.errPrecision",
  not_positive: "qtyEntry.errZero",
  too_large: "qtyEntry.errTooLarge",
};

const FIELD_CLS =
  "h-14 w-full min-w-0 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[24px] font-semibold tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] read-only:bg-[var(--surface-sunken)] read-only:text-[var(--muted)]";
const STEP_CLS =
  "grid h-14 w-14 flex-none place-items-center rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The manual quantity field (Enter Quantity mode). Raw text is never rewritten
 * while typing; the canonical value is previewed. Defence in depth against a
 * keyboard-wedge scanner: Enter never submits anything here, and a burst of
 * keys faster than a person types (the scanner hook's own timing) is rejected
 * and rolled back, with an explanation.
 */
export function TypedQuantityField({
  id,
  label,
  value,
  onChange,
  readOnly,
  inputRef,
  timing,
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** locked while an attempt is pending or its outcome is unknown */
  readOnly?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  timing?: Partial<ScannerTiming>;
  now?: () => number;
}) {
  const t = useT();
  const { interKeyMs, minChars } = { ...DEFAULT_SCANNER_TIMING, ...timing };
  const parsed = parseTypedQuantity(value);
  const errorKey = ERROR_KEY[parsed.status];
  const helpId = `${id}-help`;
  const [scannerRejected, setScannerRejected] = React.useState(false);

  // burst tracking: the value before the current fast run, the run length and the last key time
  const burst = React.useRef<{ last: number; run: number; before: string; rejecting: boolean }>({
    last: -Infinity,
    run: 0,
    before: value,
    rejecting: false,
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const b = burst.current;
    const ts = now();
    const fast = ts - b.last < interKeyMs;
    b.last = ts;
    if (e.key === "Enter") {
      // Enter never submits or opens Review from this field
      e.preventDefault();
      b.run = 0;
      b.rejecting = false;
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return; // editing keys, shortcuts, IME
    if (!fast) {
      b.run = 1;
      b.before = value;
      b.rejecting = false;
      return;
    }
    b.run += 1;
    if (b.rejecting || b.run >= minChars) {
      e.preventDefault();
      if (!b.rejecting) {
        b.rejecting = true;
        onChange(b.before); // roll back the start of the burst
        setScannerRejected(true);
      }
    }
  };

  const set = (next: string) => {
    if (readOnly) return;
    setScannerRejected(false);
    onChange(next);
  };
  const step = (delta: 1 | -1) => {
    const next = stepTypedQuantity(value, delta);
    if (next !== null) set(next);
  };
  const canDec = !readOnly && stepTypedQuantity(value, -1) !== null;
  const canInc = !readOnly && stepTypedQuantity(value, 1) !== null;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-semibold text-[var(--muted)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className={STEP_CLS} aria-label={t("qtyEntry.decrease")} onClick={() => step(-1)} disabled={!canDec}>
          <Minus aria-hidden className="h-5 w-5" />
        </button>
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          className={cn(FIELD_CLS, errorKey && "border-[var(--danger)]")}
          value={value}
          readOnly={readOnly}
          placeholder="0.000"
          aria-invalid={errorKey ? true : undefined}
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            if (burst.current.rejecting) return;
            set(e.target.value);
          }}
        />
        <button type="button" className={STEP_CLS} aria-label={t("qtyEntry.increase")} onClick={() => step(1)} disabled={!canInc}>
          <Plus aria-hidden className="h-5 w-5" />
        </button>
      </div>
      <div id={helpId} aria-live="polite" className="flex flex-col gap-[2px] text-[12px]">
        {scannerRejected ? (
          <span className="text-[var(--danger)]">{t("qtyEntry.scannerRejected")}</span>
        ) : errorKey ? (
          <span className="text-[var(--danger)]">{t(errorKey)}</span>
        ) : (
          <span className="text-[var(--muted)]">{t("qtyEntry.help")}</span>
        )}
        {parsed.status === "valid" ? (
          <span className="text-[var(--muted)]">
            {t("qtyEntry.willSend")} <QuantityDisplay value={parsed.canonical} className="font-semibold text-[var(--foreground)]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
