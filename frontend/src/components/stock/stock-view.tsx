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
import { useInTransitStock, useProducts } from "@/lib/query/hooks";
import { useAllCategories } from "@/lib/query/master-data";
import { useListParams } from "@/lib/list-params";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { ProductRow } from "@/lib/api/schemas/products";
import { matchesStockStatusFilter, stockStatus, STOCK_STATUS_FILTERS, type StockStatusKey } from "@/lib/stock-status";

const TABS = [
  { key: "all", label: "All balances" },
  { key: "in-transit", label: "In transit" },
];

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
  const { state, setPage, cycleSort } = useListParams({ sortOrder: "desc" });
  const query = {
    page: state.page,
    page_size: state.pageSize,
    sort_by: state.sortBy || undefined,
    sort_order: state.sortBy ? state.sortOrder : undefined,
  };
  const q = useInTransitStock(query);
  const data = q.data;

  const columns: Column<StockBalanceRow>[] = [
    { key: "product", header: "Product", sortField: "product_id", cell: (r) => <span className="mono">#{r.product_id}</span> },
    { key: "batch", header: "Batch", secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{r.batch_id ?? "—"}</span> },
    { key: "loc", header: "WH · Loc", secondary: true, cell: (r) => (
      <span className="mono text-[var(--muted)]">{r.warehouse_id ?? "—"} · {r.location_id ?? "—"}</span>
    ) },
    { key: "onhand", header: "On hand", align: "right", sortField: "on_hand_qty", cell: (r) => <QuantityDisplay value={r.on_hand_qty} /> },
    { key: "reserved", header: "Reserved", align: "right", secondary: true, cell: (r) => <QuantityDisplay value={r.reserved_qty} className="text-[var(--muted)]" /> },
    { key: "available", header: "Available", align: "right", cell: (r) => <QuantityDisplay value={r.available_qty} /> },
    { key: "expiry", header: "Expiry", cell: (r) => <ExpiryBadge days={r.days_to_expiry} isoDate={r.batch_expiry_date} /> },
  ];

  return (
    <>
      <p className="inline-flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
        <Truck aria-hidden className="h-[14px] w-[14px]" />
        Transit rows are physically moving between locations. Operational Available = non-transit − expired −
        reservations.
      </p>
      <DataTable<StockBalanceRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        emptyMessage="Nothing is in transit right now."
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
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
          title: `Product #${r.product_id}`,
          badge: <StatusBadge tone="accent" label="In transit" />,
          meta: (
            <>
              <span>On hand <QuantityDisplay value={r.on_hand_qty} className="font-medium" /></span>
              <span>Avail <QuantityDisplay value={r.available_qty} className="font-medium" /></span>
              <span>Batch <span className="mono">{r.batch_id ?? "—"}</span></span>
              <ExpiryBadge days={r.days_to_expiry} isoDate={r.batch_expiry_date} />
            </>
          ),
        })}
      />
    </>
  );
}

function StockBalancesTable() {
  const { state, setSearch, setPage, cycleSort } = useListParams({ sortOrder: "desc" });
  const status = useStockStatusFilterKey();
  const category = useCategoryParam();
  const categoriesQ = useAllCategories();

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
      return categoriesQ.data?.find((c) => c.id === id)?.category_name ?? `Cat #${id}`;
    },
    [categoriesQ.data],
  );

  const [selected, setSelected] = React.useState<ProductRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const openProduct = (p: ProductRow) => {
    setSelected(p);
    setDrawerOpen(true);
  };

  /** Barcode scan "ดูรายละเอียด": filter the table to this exact barcode —
   *  the same search path a manual search already uses — then the operator
   *  opens the (now sole) row normally. Avoids a second data shape for the
   *  Drawer, which needs the full enriched ProductRow, not the thinner
   *  scan/resolve payload. */
  const openByBarcode = (barcode: string) => setSearch(barcode);

  const lotCell = (p: ProductRow) => {
    if (!p.track_batch) return <span className="text-[var(--faint)]">ไม่ติดตาม Lot</span>;
    if ((p.lot_count ?? 0) === 0) return <span className="text-[var(--faint)]">No stock</span>;
    if ((p.lot_count ?? 0) === 1) return <span className="mono">{p.nearest_lot_no}</span>;
    return <span>{p.lot_count} lots</span>;
  };

  const expiryCell = (p: ProductRow) => {
    if (!p.track_expiry) return <span className="text-[var(--faint)]">ไม่ติดตามวันหมดอายุ</span>;
    return <ExpiryBadge days={daysTo(p.nearest_expiry_date)} isoDate={p.nearest_expiry_date} />;
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
    return <span className="text-[var(--muted)]">{p.location_count} locations</span>;
  };

  const columns: Column<ProductRow>[] = [
    {
      key: "product",
      header: "Product",
      sortField: "product_name",
      cell: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{p.product_name}</div>
          <div className="mono text-[11px] text-[var(--muted)]">{p.sku}</div>
        </div>
      ),
    },
    { key: "barcode", header: "Barcode", cell: (p) => <span className="mono text-[var(--muted)]">{p.barcode ?? "—"}</span> },
    { key: "category", header: "Category", secondary: true, cell: (p) => <span>{categoryName(p.category_id)}</span> },
    { key: "available", header: "Available", align: "right", cell: (p) => <QuantityDisplay value={p.operational_available_quantity} className="font-semibold" /> },
    {
      key: "status",
      header: "Status",
      cell: (p) => {
        const s = stockStatus(p);
        return <StatusBadge tone={s.tone} label={s.label} />;
      },
    },
    { key: "lot", header: "Lot / Batch", cell: lotCell },
    { key: "expiry", header: "Expiry", cell: expiryCell },
    { key: "onhand", header: "On Hand", align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.owned_quantity} className="text-[var(--muted)]" /> },
    { key: "reserved", header: "Reserved", align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.reserved_quantity} className="text-[var(--muted)]" /> },
    { key: "location", header: "Warehouse / Location", secondary: true, cell: locationCell },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder="Search product, SKU, barcode…"
          ariaLabel="Search stock"
          className="max-w-[320px]"
        />
        <StockScanButton onOpenDetail={openByBarcode} />

        <select
          aria-label="Category"
          value={category.categoryId ?? ""}
          onChange={(e) => category.setCategoryId(e.target.value ? Number(e.target.value) : null)}
          className="h-9 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[12.5px] outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          <option value="">All categories</option>
          {(categoriesQ.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.category_name}
            </option>
          ))}
        </select>

        <FilterStrip
          ariaLabel="Stock status"
          options={STOCK_STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label }))}
          value={status.key}
          onChange={(k) => status.setKey(k === "all" ? null : k)}
        />
      </div>

      {derived ? (
        <p className="text-[11.5px] text-[var(--faint)]">
          {rows.length} of the first {data?.items.length ?? 0} products match “
          {STOCK_STATUS_FILTERS.find((f) => f.key === status.key)?.label}”. Computed on this page from
          backend-derived per-product quantities — no server-side filter exists for stock status.
        </p>
      ) : null}

      <DataTable<ProductRow>
        columns={columns}
        rows={rows}
        getRowKey={(p) => String(p.id)}
        onRowActivate={openProduct}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        emptyMessage="No stock matches the current filters."
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
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
        renderCard={(p) => {
          const s = stockStatus(p);
          return {
            title: p.product_name,
            badge: <StatusBadge tone={s.tone} label={s.label} />,
            meta: (
              <>
                <span className="mono">{p.sku}</span>
                <span className="mono">{p.barcode ?? "—"}</span>
                <span>
                  Avail <QuantityDisplay value={p.operational_available_quantity} className="font-medium" />
                </span>
                <span>{lotCell(p)}</span>
                <span>{expiryCell(p)}</span>
              </>
            ),
          };
        }}
      />

      <ProductDetailDrawer product={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}

function daysTo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(iso);
  const dUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((dUtc - todayUtc) / 86_400_000);
}

export function StockView() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") === "in-transit" ? "in-transit" : "all";

  const setTab = (t: string) => {
    const next = new URLSearchParams(sp.toString());
    if (t === "all") next.delete("tab");
    else next.set("tab", t);
    next.delete("page");
    router.replace(next.toString() ? `/stock?${next}` : "/stock", { scroll: false });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Stock"
        subtitle={tab === "in-transit" ? "In-transit stock — never counted as operational available." : "Search, filter and inspect on-hand inventory."}
        actions={
          <Button variant="primary" size="sm" onClick={() => router.push("/stock-in")}>
            <PackagePlus aria-hidden className="h-4 w-4" />
            Stock In
          </Button>
        }
      />

      <FilterStrip ariaLabel="Stock view" options={TABS} value={tab} onChange={setTab} className="max-w-[320px]" />

      {tab === "in-transit" ? <InTransitTable /> : <StockBalancesTable />}
    </div>
  );
}
