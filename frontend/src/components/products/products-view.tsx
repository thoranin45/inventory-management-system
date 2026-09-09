"use client";

import * as React from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay, MoneyDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSession } from "@/components/session-provider";
import { ProductActions } from "./product-actions";
import { ProductDetailDrawer } from "./product-detail";
import { CreateProductDrawer } from "./create-product";
import { useProducts } from "@/lib/query/hooks";
import { useAllCategories } from "@/lib/query/master-data";
import { useListParams } from "@/lib/list-params";
import { compareDecimals, isZero } from "@/lib/decimal";
import { PRODUCT_FILTERS, type ProductRow } from "@/lib/api/schemas/products";
import { canShowAction } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

/** low stock = operational available < max(safety_stock, minimum_stock) */
function isLowStock(p: ProductRow): boolean {
  const a = p.safety_stock ?? "0";
  const b = p.minimum_stock ?? "0";
  const threshold = compareDecimals(a, b) >= 0 ? a : b;
  if (compareDecimals(threshold, "0") === 0) return false;
  return compareDecimals(p.operational_available_quantity, threshold) < 0;
}

function healthLabel(p: ProductRow): { tone: "success" | "warning" | "danger" | "neutral"; label: string } {
  if (!p.is_active) return { tone: "neutral", label: "Inactive" };
  if (!isZero(p.expired_quantity)) return { tone: "danger", label: "Expired stock" };
  if (isLowStock(p)) return { tone: "warning", label: "Low stock" };
  if (!isZero(p.near_expiry_quantity)) return { tone: "warning", label: "Near expiry" };
  return { tone: "success", label: "Healthy" };
}

/** Client-computed (page-local) filters — the backend has no such query. */
const DERIVED = new Set(["low", "expired", "near"]);

export function ProductsView() {
  const { user } = useSession();
  const canCreate = canShowAction(user.role, "product:create");
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({ sortOrder: "desc", filter: "all" });

  const filter = state.filter ?? "all";
  const derived = DERIVED.has(filter);

  const categoriesQ = useAllCategories();
  const categoryName = React.useCallback(
    (id: number | null) => {
      if (id == null) return "—";
      return categoriesQ.data?.find((c) => c.id === id)?.category_name ?? `Cat #${id}`;
    },
    [categoriesQ.data],
  );

  const query = React.useMemo(
    () => ({
      page: derived ? 1 : state.page,
      page_size: derived ? 100 : state.pageSize,
      search: state.search || undefined,
      // `inactive` is a real backend filter; low/expired/near are page-local.
      status: filter === "inactive" ? "inactive" : undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [derived, filter, state.page, state.pageSize, state.search, state.sortBy, state.sortOrder],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useProducts(query);

  const rows = React.useMemo(() => {
    const items = data?.items ?? [];
    if (filter === "low") return items.filter(isLowStock);
    if (filter === "expired") return items.filter((p) => !isZero(p.expired_quantity));
    if (filter === "near") return items.filter((p) => !isZero(p.near_expiry_quantity) && isZero(p.expired_quantity));
    return items;
  }, [data, filter]);

  const [selected, setSelected] = React.useState<ProductRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const openProduct = (p: ProductRow) => {
    setSelected(p);
    setDrawerOpen(true);
  };

  const columns: Column<ProductRow>[] = [
    { key: "sku", header: "SKU", sortField: "sku", cell: (p) => <span className="mono text-[var(--muted)]">{p.sku}</span> },
    {
      key: "name",
      header: "Product",
      sortField: "product_name",
      cell: (p) => (
        <div>
          <div className="font-medium">{p.product_name}</div>
          <div className="text-[11px] text-[var(--faint)]">
            {p.track_batch ? "batch" : "non-batch"}
            {p.track_expiry ? " · expiry" : ""}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      secondary: true,
      cell: (p) => <span className="text-[var(--muted)]">{categoryName(p.category_id)}</span>,
    },
    { key: "available", header: "Op. available", align: "right", cell: (p) => <QuantityDisplay value={p.operational_available_quantity} /> },
    { key: "owned", header: "Owned", align: "right", sortField: "stock_qty", cell: (p) => <QuantityDisplay value={p.owned_quantity} className="text-[var(--muted)]" /> },
    { key: "reserved", header: "Reserved", align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.reserved_quantity} className="text-[var(--muted)]" /> },
    {
      key: "expired",
      header: "Expired",
      align: "right",
      secondary: true,
      cell: (p) => <QuantityDisplay value={p.expired_quantity} className={cn(!isZero(p.expired_quantity) && "text-[var(--danger)]")} />,
    },
    {
      key: "near",
      header: "Near expiry",
      align: "right",
      secondary: true,
      cell: (p) => <QuantityDisplay value={p.near_expiry_quantity} className={cn(!isZero(p.near_expiry_quantity) && "text-[var(--warning)]")} />,
    },
    { key: "transit", header: "In transit", align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.transit_quantity} className="text-[var(--muted)]" /> },
    { key: "price", header: "Price", align: "right", cell: (p) => (p.price ? <MoneyDisplay value={p.price} /> : "—") },
    {
      key: "status",
      header: "Status",
      cell: (p) => <StatusBadge tone={p.is_active ? "success" : "neutral"} label={p.is_active ? "Active" : "Inactive"} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Products &amp; Stock"
        subtitle={
          data ? `${data.pagination.total_items} products · quantities at 2-decimal precision` : "Loading products…"
        }
        actions={<ProductActions role={user.role} onNew={() => setCreateOpen(true)} />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel="Product inventory filter"
          options={PRODUCT_FILTERS.map((f) => ({ key: f.key, label: f.label }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder="SKU, name, barcode…"
          ariaLabel="Search products"
          className="max-w-[320px]"
        />
      </div>

      {filter === "transit" ? (
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-[12.5px] text-[var(--muted)]">
          In-transit stock is tracked per balance, not per product.{" "}
          <Link href="/stock?tab=in-transit" className="font-medium text-[var(--accent)] underline">
            Open the Stock → In transit view
          </Link>
          .
        </div>
      ) : (
        <>
          {derived ? (
            <p className="text-[11.5px] text-[var(--faint)]">
              {rows.length} of the first {data?.items.length ?? 0} products match “
              {PRODUCT_FILTERS.find((f) => f.key === filter)?.label}”. This view is computed on this page
              from backend-derived per-product quantities — no server-side filter exists. Use the{" "}
              <Link href="/dashboard" className="underline">
                attention queues
              </Link>{" "}
              for the authoritative list.
            </p>
          ) : null}
          {filter === "inactive" ? (
            <p className="text-[11.5px] text-[var(--faint)]">Deactivated products. Open one to restore it.</p>
          ) : null}
          <DataTable<ProductRow>
            columns={columns}
            rows={rows}
            getRowKey={(p) => String(p.id)}
            onRowActivate={openProduct}
            isLoading={isLoading}
            isFetching={isFetching}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            emptyMessage="No products match the current filter."
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
              const h = healthLabel(p);
              return {
                title: p.product_name,
                badge: <StatusBadge tone={h.tone} label={h.label} />,
                meta: (
                  <>
                    <span className="mono">{p.sku}</span>
                    <span>{categoryName(p.category_id)}</span>
                    <span>
                      Avail <QuantityDisplay value={p.operational_available_quantity} className="font-medium" />
                    </span>
                    <span>
                      Owned <QuantityDisplay value={p.owned_quantity} className="font-medium" />
                    </span>
                    {p.price ? (
                      <span>
                        <MoneyDisplay value={p.price} className="font-medium" />
                      </span>
                    ) : null}
                    <span className={cn(!p.is_active && "text-[var(--faint)]")}>{p.is_active ? "Active" : "Inactive"}</span>
                  </>
                ),
              };
            }}
          />
        </>
      )}

      <ProductDetailDrawer product={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
      {canCreate ? (
        <CreateProductDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void refetch()} />
      ) : null}
    </div>
  );
}
