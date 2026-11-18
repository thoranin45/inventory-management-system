"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { SearchInput } from "@/components/ui/search-input";
import { useProducts } from "@/lib/query/hooks";
import { useWarehouses } from "@/lib/query/warehouses";
import { MOVEMENT_GROUPS, type LedgerItem } from "@/lib/api/schemas/inventory-movements";
import type { ReportParamKey } from "@/lib/reports/use-report-params";
import { useT } from "@/lib/i18n/client";
import { MOVEMENT_GROUP_KEY } from "@/lib/ledger-copy";

const fieldCls =
  "h-9 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[12.5px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)]";

const FILTER_KEYS: ReportParamKey[] = [
  "product_id",
  "warehouse_id",
  "location_id",
  "batch_id",
  "movement_group",
  "reference_number",
  "from_date",
  "to_date",
  "include_transit",
  "actor",
];

export function activeFilterCount(values: Partial<Record<ReportParamKey, string>>): number {
  return FILTER_KEYS.filter((k) => values[k]).length;
}

function Labeled({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]">{label}</span>
      {children}
    </label>
  );
}

type Patch = Partial<Record<ReportParamKey, string | null>>;

export function LedgerFilters({
  values,
  rows,
  admin,
  onChange,
  onClear,
  showDateHint,
  sortOrder,
}: {
  values: Partial<Record<ReportParamKey, string>>;
  rows: LedgerItem[];
  admin: boolean;
  onChange: (patch: Patch) => void;
  onClear: () => void;
  showDateHint: boolean;
  sortOrder: "asc" | "desc";
}) {
  const t = useT();
  const [term, setTerm] = React.useState("");
  const productQ = useProducts(term.trim().length >= 2 ? { page: 1, page_size: 20, search: term.trim() } : { page: 1, page_size: 20 });
  const productItems: ComboboxItem[] = (productQ.data?.items ?? []).map((p) => ({
    id: p.id,
    label: p.product_name,
    sublabel: p.sku ?? undefined,
  }));

  // Selected product label survives a reload: take it from the current page when possible.
  const selectedProduct: ComboboxItem | null = React.useMemo(() => {
    if (!values.product_id) return null;
    const id = Number(values.product_id);
    const fromRows = rows.find((r) => r.product.id === id)?.product;
    const fromList = productQ.data?.items.find((p) => p.id === id);
    return {
      id,
      label: fromRows?.product_name ?? fromList?.product_name ?? t("reports.productFallback", { id }),
      sublabel: fromRows?.sku ?? fromList?.sku ?? undefined,
    };
  }, [values.product_id, rows, productQ.data, t]);

  // Historical view: every warehouse incl. inactive ones, labelled — never hidden.
  const warehousesQ = useWarehouses(false);
  const warehouses = warehousesQ.data ?? [];
  const selectedWarehouse = warehouses.find((w) => String(w.id) === values.warehouse_id);

  return (
    <>
      <div className="min-w-[220px] flex-1 sm:max-w-[300px]">
        <Labeled label={t("reports.colProduct")}>
          <Combobox
            ariaLabel={t("ledger.filterProduct")}
            value={selectedProduct}
            items={productItems}
            loading={productQ.isFetching}
            onSearch={setTerm}
            placeholder={t("ledger.anyProduct")}
            onChange={(item) => onChange({ product_id: item ? String(item.id) : null, batch_id: null })}
          />
        </Labeled>
      </div>

      <Labeled label={t("ledger.warehouse")} htmlFor="lf-warehouse">
        <select
          id="lf-warehouse"
          className={fieldCls}
          value={values.warehouse_id ?? ""}
          onChange={(e) => onChange({ warehouse_id: e.currentTarget.value || null, location_id: null })}
        >
          <option value="">{t("ledger.allWarehouses")}</option>
          {warehouses.map((w) => (
            <option key={w.id} value={String(w.id)}>
              {w.warehouse_code} · {w.warehouse_name}
              {w.is_active ? "" : ` (${t("ledger.inactive")})`}
            </option>
          ))}
        </select>
      </Labeled>

      <Labeled label={t("ledger.location")} htmlFor="lf-location">
        <select
          id="lf-location"
          className={fieldCls}
          value={values.location_id ?? ""}
          disabled={!selectedWarehouse}
          onChange={(e) => onChange({ location_id: e.currentTarget.value || null })}
        >
          <option value="">{t("ledger.allLocations")}</option>
          {(selectedWarehouse?.locations ?? []).map((l) => (
            <option key={l.id} value={String(l.id)}>
              {l.location_code}
              {l.location_name ? ` · ${l.location_name}` : ""}
              {l.is_active ? "" : ` (${t("ledger.inactive")})`}
            </option>
          ))}
        </select>
      </Labeled>

      <Labeled label={t("reports.type")} htmlFor="lf-group">
        <select
          id="lf-group"
          className={fieldCls}
          value={values.movement_group ?? ""}
          onChange={(e) => onChange({ movement_group: e.currentTarget.value || null })}
        >
          <option value="">{t("ledger.allMovements")}</option>
          {MOVEMENT_GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {MOVEMENT_GROUP_KEY[g.key] ? t(MOVEMENT_GROUP_KEY[g.key]) : g.label}
            </option>
          ))}
        </select>
      </Labeled>

      <div className="min-w-[160px] sm:max-w-[200px]">
        <Labeled label={t("ledger.referenceNo")}>
          <SearchInput
            value={values.reference_number ?? ""}
            onCommit={(val) => onChange({ reference_number: val.trim() || null })}
            placeholder={t("ledger.referencePh")}
            ariaLabel={t("ledger.referenceAria")}
          />
        </Labeled>
      </div>

      <Labeled label={t("reports.from")} htmlFor="lf-from">
        <input
          id="lf-from"
          type="date"
          className={fieldCls}
          value={values.from_date ?? ""}
          max={values.to_date ?? undefined}
          onChange={(e) => onChange({ from_date: e.currentTarget.value || null })}
        />
      </Labeled>
      <Labeled label={t("reports.to")} htmlFor="lf-to">
        <input
          id="lf-to"
          type="date"
          className={fieldCls}
          value={values.to_date ?? ""}
          min={values.from_date ?? undefined}
          onChange={(e) => onChange({ to_date: e.currentTarget.value || null })}
        />
      </Labeled>

      <Labeled label={t("ledger.order")} htmlFor="lf-order">
        <select
          id="lf-order"
          className={fieldCls}
          value={sortOrder}
          onChange={(e) => onChange({ sort_order: e.currentTarget.value === "asc" ? "asc" : null })}
        >
          <option value="desc">{t("ledger.newestFirst")}</option>
          <option value="asc">{t("ledger.oldestFirst")}</option>
        </select>
      </Labeled>

      {admin ? (
        <div className="min-w-[140px] sm:max-w-[180px]">
          <Labeled label={t("ledger.performedBy")}>
            <SearchInput
              value={values.actor ?? ""}
              onCommit={(val) => onChange({ actor: val.trim() || null })}
              placeholder={t("ledger.exactUsername")}
              ariaLabel={t("ledger.filterOperator")}
            />
          </Labeled>
        </div>
      ) : null}

      <label className="flex h-9 items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={values.include_transit === "true"}
          onChange={(e) => onChange({ include_transit: e.currentTarget.checked ? "true" : null })}
        />
        {t("ledger.showTransit")}
      </label>

      {values.batch_id ? (
        <span className="inline-flex h-9 items-center gap-1 rounded-[var(--r-full)] border border-[var(--border)] px-3 text-[12px]">
          {t("ledger.lotNo", { id: values.batch_id })}
          <button type="button" aria-label={t("ledger.removeLot")} onClick={() => onChange({ batch_id: null })}>
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : null}

      {activeFilterCount(values) ? (
        <Button variant="ghost" onClick={onClear}>
          <X aria-hidden className="h-4 w-4" />
          {t("reports.clearFilters")}
        </Button>
      ) : null}

      {showDateHint ? (
        <p role="status" className="basis-full text-[12px] text-[var(--warning)]">
          {t("ledger.dateHint")}
        </p>
      ) : null}
    </>
  );
}
