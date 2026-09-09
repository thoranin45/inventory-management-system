"use client";

import * as React from "react";
import { X } from "lucide-react";

import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { MOVEMENT_TYPES, movementTypeLabel } from "@/lib/api/schemas/reports";
import type { ReportParamKey } from "@/lib/reports/use-report-params";

const fieldCls =
  "h-9 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[12.5px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

export interface FilterBarSpec {
  /** which controls to render — only params the endpoint actually supports */
  controls: ReportParamKey[];
  /** option list for the `status` <select> (report-specific vocabulary) */
  statusOptions?: { value: string; label: string }[];
  searchPlaceholder?: string;
  /** label + bounds for a bare numeric control (days / threshold / limit) */
  numeric?: Partial<Record<"days" | "threshold" | "limit", { label: string; min?: number; max?: number; step?: string }>>;
}

interface Props extends FilterBarSpec {
  values: Partial<Record<ReportParamKey, string>>;
  onChange: (patch: Partial<Record<ReportParamKey, string | null>>) => void;
  onClear: () => void;
}

function Labeled({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]">{label}</span>
      {children}
    </label>
  );
}

export function ReportsFilterBar({
  controls,
  statusOptions,
  searchPlaceholder = "Search…",
  numeric,
  values,
  onChange,
  onClear,
}: Props) {
  const has = (k: ReportParamKey) => controls.includes(k);
  const anySet = controls.some((k) => k !== "page" && k !== "page_size" && k !== "sort_by" && k !== "sort_order" && values[k]);

  return (
    <>
      {has("search") ? (
        <div className="min-w-[180px] flex-1 sm:max-w-[280px]">
          <SearchInput
            value={values.search ?? ""}
            onCommit={(v) => onChange({ search: v || null })}
            placeholder={searchPlaceholder}
            ariaLabel="Search report"
          />
        </div>
      ) : null}

      {has("status") && statusOptions ? (
        <Labeled label="Status" htmlFor="rf-status">
          <select
            id="rf-status"
            className={fieldCls}
            value={values.status ?? ""}
            onChange={(e) => onChange({ status: e.currentTarget.value || null })}
          >
            <option value="">All</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Labeled>
      ) : null}

      {has("transaction_type") ? (
        <Labeled label="Type" htmlFor="rf-type">
          <select
            id="rf-type"
            className={fieldCls}
            value={values.transaction_type ?? ""}
            onChange={(e) => onChange({ transaction_type: e.currentTarget.value || null })}
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {movementTypeLabel(t)}
              </option>
            ))}
          </select>
        </Labeled>
      ) : null}

      {has("date_from") ? (
        <Labeled label="From" htmlFor="rf-from">
          <input
            id="rf-from"
            type="date"
            className={fieldCls}
            value={values.date_from ?? ""}
            max={values.date_to ?? undefined}
            onChange={(e) => onChange({ date_from: e.currentTarget.value || null })}
          />
        </Labeled>
      ) : null}

      {has("date_to") ? (
        <Labeled label="To" htmlFor="rf-to">
          <input
            id="rf-to"
            type="date"
            className={fieldCls}
            value={values.date_to ?? ""}
            min={values.date_from ?? undefined}
            onChange={(e) => onChange({ date_to: e.currentTarget.value || null })}
          />
        </Labeled>
      ) : null}

      {(["days", "threshold", "limit"] as const)
        .filter((k) => has(k))
        .map((k) => {
          const cfg = numeric?.[k] ?? { label: k };
          return (
            <Labeled key={k} label={cfg.label} htmlFor={`rf-${k}`}>
              <input
                id={`rf-${k}`}
                inputMode="numeric"
                type="number"
                min={cfg.min}
                max={cfg.max}
                step={cfg.step ?? "1"}
                className={`${fieldCls} w-24`}
                value={values[k] ?? ""}
                onChange={(e) => onChange({ [k]: e.currentTarget.value || null })}
              />
            </Labeled>
          );
        })}

      {anySet ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="mb-[1px]">
          <X aria-hidden className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      ) : null}
    </>
  );
}
