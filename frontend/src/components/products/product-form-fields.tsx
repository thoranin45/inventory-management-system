"use client";

import * as React from "react";

import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { useAllCategories } from "@/lib/query/master-data";

export const productInputCls =
  "min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

export function ProductField({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[12px] font-semibold text-[var(--muted)]">
        {label}
        {required ? <span className="text-[var(--danger)]"> *</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="text-[11px] text-[var(--faint)]">{hint}</span> : null}
      {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
    </label>
  );
}

/** Category selector backed by the real backend list (never hard-coded IDs). */
export function CategoryPicker({
  value,
  onChange,
  error,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  error?: string;
}) {
  const { data: categories = [], isLoading } = useAllCategories();
  const [term, setTerm] = React.useState("");

  const items: ComboboxItem[] = React.useMemo(() => {
    const t = term.trim().toLowerCase();
    return categories
      .filter((c) => !t || c.category_name.toLowerCase().includes(t))
      .map((c) => ({ id: c.id, label: c.category_name }));
  }, [categories, term]);

  const selected = value != null ? categories.find((c) => c.id === value) ?? null : null;

  return (
    <ProductField
      label="Category"
      htmlFor="pf-category"
      error={error}
      hint={categories.length === 0 && !isLoading ? "No categories yet — create one under Categories first (optional)." : "Optional"}
    >
      <Combobox
        id="pf-category"
        ariaLabel="Search categories"
        value={selected ? { id: selected.id, label: selected.category_name } : null}
        onChange={(item) => onChange(item?.id ?? null)}
        onSearch={setTerm}
        items={items}
        loading={isLoading}
        placeholder="Search categories…"
        emptyText={categories.length === 0 ? "No categories exist yet" : "No categories match"}
      />
    </ProductField>
  );
}

/**
 * The three legal tracking combinations, explained. `track_expiry` implies
 * `track_batch` (backend rule) — the checkbox stays disabled until batch
 * tracking is on, and turning batch tracking off clears expiry.
 */
export function TrackingFields({
  trackBatch,
  trackExpiry,
  onChange,
  disabled,
  disabledReason,
  error,
}: {
  trackBatch: boolean;
  trackExpiry: boolean;
  onChange: (next: { track_batch: boolean; track_expiry: boolean }) => void;
  disabled?: boolean;
  disabledReason?: string;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <legend className="px-1 text-[12px] font-semibold text-[var(--muted)]">Tracking configuration</legend>

      <label className="flex items-start gap-2 text-[12.5px]">
        <input
          type="checkbox"
          id="pf-track-batch"
          className="mt-[3px] h-4 w-4"
          checked={trackBatch}
          disabled={disabled}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            onChange({ track_batch: on, track_expiry: on ? trackExpiry : false });
          }}
        />
        <span>
          <span className="font-medium">Track batches</span>
          <span className="block text-[11.5px] text-[var(--faint)]">
            Stock is split into lot-numbered batches. Required for FEFO picking and expiry.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-[12.5px]">
        <input
          type="checkbox"
          id="pf-track-expiry"
          className="mt-[3px] h-4 w-4"
          checked={trackExpiry}
          disabled={disabled || !trackBatch}
          onChange={(e) => onChange({ track_batch: trackBatch, track_expiry: e.currentTarget.checked })}
        />
        <span>
          <span className="font-medium">Track expiry dates</span>
          <span className="block text-[11.5px] text-[var(--faint)]">
            Each batch carries an expiry date. Expired stock stays owned but is flagged and
            excluded from operational availability. Needs batch tracking on.
          </span>
        </span>
      </label>

      <p className="px-1 text-[11px] text-[var(--faint)]">
        Non-batch → one pooled quantity. Batch only → lot-numbered, no dates. Batch + expiry →
        expiry-aware batches.
      </p>
      {disabled && disabledReason ? (
        <p className="px-1 text-[11px] text-[var(--warning)]">{disabledReason}</p>
      ) : null}
      {error ? <p className="px-1 text-[11px] text-[var(--danger)]">{error}</p> : null}
    </fieldset>
  );
}
