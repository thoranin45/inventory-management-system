"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PackagePlus, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { ProductDetailDrawer } from "@/components/products/product-detail";
import { StockScanButton } from "@/components/stock/barcode-lookup-sheet";
import { daysUntil } from "@/lib/business-date";
import { useMediaQuery } from "@/lib/hooks/use-viewport";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useInTransitStock, useProducts } from "@/lib/query/hooks";
import { useAllCategories } from "@/lib/query/master-data";
import { useProductLookup } from "@/lib/query/sales";
import { useListParams } from "@/lib/list-params";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { ProductRow } from "@/lib/api/schemas/products";
import { matchesStockStatusFilter, stockStatus, STOCK_STATUS_FILTERS, type StockStatusKey } from "@/lib/stock-status";
import { StockDetailPane } from "./stock-detail-pane";
import { statusLabelKey } from "./stock-status-labels";

const filterLabelKey = (key: StockStatusKey | "all"): MessageKey =>
  key === "expired" ? "stock.filterExpired" : statusLabelKey(key);

/** Stock status is derived per-product (available vs threshold, expiry
 *  categories) exactly like the Products page's health label — the backend
 *  has no such filter, so (as on Products) we widen the page to 100 and
 *  disclose that this view is page-local rather than pretending it is an
 *  authoritative, paginated filter. */
function useStockStatusFilterKey() {
  const { state, setFilter } = useListParams({ sortOrder: "desc", filterKey: "status", filter: "all" });
  const key = (state.filter ?? "all") as StockStatusKey | "all";
  return { key, setKey: setFilter, state };
}

/** `category` is a plain URL param this page owns directly (mirrors how the
 *  existing `tab` param is already handled below) — kept separate from
 *  `useListParams` so it composes independently of search/sort/status. */
function useCategoryParam() {
  const router = useRouter();
  const sp = useSearchParams();
  const value = sp.get("category");
  const categoryId = value ? Number(value) : null;
  const setCategoryId = (id: number | null) => {
    const next = new URLSearchParams(sp.toString());
    if (id) next.set("category", String(id));
    else next.delete("category");
    next.delete("page");
    router.replace(next.toString() ? `/stock?${next}` : "/stock", { scroll: false });
  };
  return { categoryId, setCategoryId };
}

function InTransitTable() {
  const t = useT();
  const { state, setPage, cycleSort } = useListParams({ sortOrder: "desc" });
  const query = {
    page: state.page,
    page_size: state.pageSize,
    sort_by: state.sortBy || undefined,
    sort_order: state.sortBy ? state.sortOrder : undefined,
  };
  const q = useInTransitStock(query);
  const data = q.data;
  // names from the existing product lookup; a product it does not return keeps its id
  const lookup = useProductLookup((data?.items ?? []).map((r) => r.product_id)).data ?? {};
  const productCell = (r: StockBalanceRow) => {
    const p = lookup[r.product_id];
    return p ? (
      <div className="min-w-0">
        <div className="truncate font-medium">{p.product_name}</div>
        <div className="mono text-[11px] text-[var(--muted)]">{p.sku}</div>
      </div>
    ) : (
      <span className="mono">#{r.product_id}</span>
    );
  };

  const columns: Column<StockBalanceRow>[] = [
    { key: "product", header: t("stock.colProduct"), sortField: "product_id", cell: productCell },
    { key: "batch", header: t("stock.colLot"), secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{r.batch_lot_no ?? r.batch_id ?? "—"}</span> },
    { key: "loc", header: t("stock.colStorage"), secondary: true, cell: (r) => (
      <span className="mono text-[var(--muted)]">{r.warehouse_id ?? "—"} · {r.location_id ?? "—"}</span>
    ) },
    { key: "onhand", header: t("qty.onHand"), align: "right", sortField: "on_hand_qty", cell: (r) => <QuantityDisplay value={r.on_hand_qty} /> },
    { key: "reserved", header: t("qty.reserved"), align: "right", secondary: true, cell: (r) => <QuantityDisplay value={r.reserved_qty} className="text-[var(--muted)]" /> },
    { key: "available", header: t("qty.available"), align: "right", cell: (r) => <QuantityDisplay value={r.available_qty} /> },
    { key: "expiry", header: t("stock.colExpiry"), cell: (r) => <ExpiryBadge days={r.days_to_expiry} isoDate={r.batch_expiry_date} /> },
  ];

  return (
    <>
      <p className="inline-flex items-center gap-2 text-[12px] text-[var(--muted)]">
        <Truck aria-hidden className="h-[14px] w-[14px]" />
        {t("stock.transitNote")}
      </p>
      <DataTable<StockBalanceRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        emptyMessage={t("stock.transitEmpty")}
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
        tabletLayout="table"
        pagination={
          data
            ? {
                page: data.pagination.page,
                pageSize: data.pagination.page_size,
                totalItems: data.pagination.total_items,
                totalPages: data.pagination.total_pages,
                onPageChange: setPage,
              }
            : undefined
        }
        renderCard={(r) => ({
          title: lookup[r.product_id]?.product_name ?? `#${r.product_id}`,
          badge: <StatusBadge status="IN_TRANSIT" />,
          meta: (
            <>
              <span>{t("qty.onHand")} <QuantityDisplay value={r.on_hand_qty} className="font-medium" /></span>
              <span>{t("qty.available")} <QuantityDisplay value={r.available_qty} className="font-medium" /></span>
              <span>{t("stock.colLot")} <span className="mono">{r.batch_lot_no ?? r.batch_id ?? "—"}</span></span>
              <ExpiryBadge days={r.days_to_expiry} isoDate={r.batch_expiry_date} />
            </>
          ),
        })}
      />
    </>
  );
}

function StockBalancesTable() {
  const t = useT();
  const { state, setSearch, setPage, cycleSort } = useListParams({ sortOrder: "desc" });
  const status = useStockStatusFilterKey();
  const category = useCategoryParam();
  const categoriesQ = useAllCategories();
  // Concept B split list/detail from 1200 px; below, the detail opens as a drawer
  const split = useMediaQuery("(min-width: 1200px)");

  const derived = status.key !== "all";

  const query = React.useMemo(
    () => ({
      page: derived ? 1 : state.page,
      page_size: derived ? 100 : state.pageSize,
      search: state.search || undefined,
      category_id: category.categoryId ?? undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [derived, state.page, state.pageSize, state.search, state.sortBy, state.sortOrder, category.categoryId],
  );

  const q = useProducts(query);
  const data = q.data;

  const rows = React.useMemo(() => {
    const items = data?.items ?? [];
    if (!derived) return items;
    return items.filter((p) => matchesStockStatusFilter(p, status.key));
  }, [data, derived, status.key]);

  const categoryName = React.useCallback(
    (id: number | null) => {
      if (id == null) return "—";
      return categoriesQ.data?.find((c) => c.id === id)?.category_name ?? t("stock.categoryFallback", { id });
    },
    [categoriesQ.data, t],
  );

  const [selected, setSelected] = React.useState<ProductRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const openProduct = (p: ProductRow) => {
    setSelected(p);
    if (!split) setDrawerOpen(true);
  };
  // the pane follows the freshest row data for the selected product
  const selectedRow = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null;

  /** Barcode scan "ดูรายละเอียด": filter the table to this exact barcode —
   *  the same search path a manual search already uses — then the operator
   *  opens the (now sole) row normally. Avoids a second data shape for the
   *  Drawer, which needs the full enriched ProductRow, not the thinner
   *  scan/resolve payload. */
  const openByBarcode = (barcode: string) => setSearch(barcode);

  const lotCell = (p: ProductRow) => {
    if (!p.track_batch) return <span className="text-[var(--faint)]">{t("stock.lotNotTracked")}</span>;
    if ((p.lot_count ?? 0) === 0) return <span className="text-[var(--faint)]">{t("stock.noStock")}</span>;
    if ((p.lot_count ?? 0) === 1) return <span className="mono">{p.nearest_lot_no}</span>;
    return <span>{t("stock.lotCount", { n: p.lot_count ?? 0 })}</span>;
  };

  const expiryCell = (p: ProductRow) => {
    if (!p.track_expiry) return <span className="text-[var(--faint)]">{t("stock.expiryNotTracked")}</span>;
    return <ExpiryBadge days={p.nearest_expiry_date ? daysUntil(p.nearest_expiry_date) : null} isoDate={p.nearest_expiry_date} />;
  };

  const locationCell = (p: ProductRow) => {
    if ((p.location_count ?? 0) === 0) return <span className="text-[var(--faint)]">—</span>;
    if ((p.location_count ?? 0) === 1) {
      return (
        <span className="mono text-[var(--muted)]">
          {p.primary_warehouse_code} / {p.primary_location_code}
        </span>
      );
    }
    return <span className="text-[var(--muted)]">{t("stock.locationCount", { n: p.location_count ?? 0 })}</span>;
  };

  const statusChip = (p: ProductRow) => {
    const s = stockStatus(p);
    return <StatusBadge tone={s.tone} label={t(statusLabelKey(s.key))} />;
  };

  const columns: Column<ProductRow>[] = [
    {
      key: "product",
      header: t("stock.colProduct"),
      sortField: "product_name",
      cell: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{p.product_name}</div>
          <div className="mono text-[11px] text-[var(--muted)]">{p.sku}</div>
        </div>
      ),
    },
    { key: "barcode", header: t("stock.colBarcode"), secondary: true, cell: (p) => <span className="mono text-[var(--muted)]">{p.barcode ?? "—"}</span> },
    { key: "category", header: t("stock.colCategory"), secondary: true, cell: (p) => <span>{categoryName(p.category_id)}</span> },
    { key: "available", header: t("qty.available"), align: "right", cell: (p) => <QuantityDisplay value={p.operational_available_quantity} className="font-semibold" /> },
    { key: "status", header: t("stock.colStatus"), cell: statusChip },
    { key: "lot", header: t("stock.colLotBatch"), cell: lotCell },
    { key: "expiry", header: t("stock.colExpiry"), cell: expiryCell },
    { key: "onhand", header: t("qty.onHand"), align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.owned_quantity} className="text-[var(--muted)]" /> },
    { key: "reserved", header: t("qty.reserved"), align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.reserved_quantity} className="text-[var(--muted)]" /> },
    { key: "location", header: t("stock.colLocation"), secondary: true, cell: locationCell },
  ];

  const table = (
    <DataTable<ProductRow>
      columns={columns}
      rows={rows}
      getRowKey={(p) => String(p.id)}
      onRowActivate={openProduct}
      isLoading={q.isLoading}
      isFetching={q.isFetching}
      error={q.isError ? q.error : undefined}
      onRetry={() => void q.refetch()}
      emptyMessage={t("stock.empty")}
      sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
      onSort={cycleSort}
      tabletLayout="table"
      pagination={
        derived || !data
          ? undefined
          : {
              page: data.pagination.page,
              pageSize: data.pagination.page_size,
              totalItems: data.pagination.total_items,
              totalPages: data.pagination.total_pages,
              onPageChange: setPage,
            }
      }
      renderCard={(p) => ({
        title: p.product_name,
        badge: statusChip(p),
        meta: (
          <>
            <span className="mono">{p.sku}</span>
            <span className="mono">{p.barcode ?? "—"}</span>
            <span>
              {t("qty.available")} <QuantityDisplay value={p.operational_available_quantity} className="font-medium" />
            </span>
            <span>{lotCell(p)}</span>
            <span>{expiryCell(p)}</span>
          </>
        ),
      })}
    />
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("stock.searchPlaceholder")}
          ariaLabel={t("stock.searchLabel")}
          className="max-w-[320px]"
        />
        <StockScanButton onOpenDetail={openByBarcode} />

        <select
          aria-label={t("stock.colCategory")}
          value={category.categoryId ?? ""}
          onChange={(e) => category.setCategoryId(e.target.value ? Number(e.target.value) : null)}
          className="h-9 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[12.5px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)]"
        >
          <option value="">{t("stock.allCategories")}</option>
          {(categoriesQ.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.category_name}
            </option>
          ))}
        </select>

        <FilterStrip
          ariaLabel={t("stock.statusFilter")}
          options={STOCK_STATUS_FILTERS.map((f) => ({ key: f.key, label: t(filterLabelKey(f.key)) }))}
          value={status.key}
          onChange={(k) => status.setKey(k === "all" ? null : k)}
        />
      </div>

      {derived ? (
        <p className="text-[12px] text-[var(--faint)]">
          {t("stock.derivedNote", {
            n: rows.length,
            total: data?.items.length ?? 0,
            status: t(filterLabelKey(status.key)),
          })}
        </p>
      ) : null}

      {split ? (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4">
          <div className="min-w-0">{table}</div>
          <StockDetailPane product={selectedRow} onOpenDetails={() => setDrawerOpen(true)} />
        </div>
      ) : (
        table
      )}

      <ProductDetailDrawer product={selectedRow} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}

export function StockView() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") === "in-transit" ? "in-transit" : "all";
  const tabs = [
    { key: "all", label: t("stock.tabAll") },
    { key: "in-transit", label: t("stock.inTransit") },
  ];

  const setTab = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    params.delete("page");
    router.replace(params.toString() ? `/stock?${params}` : "/stock", { scroll: false });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("nav.stock")}
        subtitle={tab === "in-transit" ? t("stock.subtitleTransit") : t("stock.subtitleAll")}
        actions={
          <Button variant="primary" size="sm" onClick={() => router.push("/stock-in")}>
            <PackagePlus aria-hidden className="h-4 w-4" />
            {t("nav.stockIn")}
          </Button>
        }
      />

      <FilterStrip ariaLabel={t("stock.viewLabel")} options={tabs} value={tab} onChange={setTab} className="max-w-[320px]" />

      {tab === "in-transit" ? <InTransitTable /> : <StockBalancesTable />}
    </div>
  );
}
