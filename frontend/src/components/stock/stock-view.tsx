"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Truck } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { useInTransitStock, useStockBalances } from "@/lib/query/hooks";
import { useListParams } from "@/lib/list-params";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";

const TABS = [
  { key: "all", label: "All balances" },
  { key: "in-transit", label: "In transit" },
];

export function StockView() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") === "in-transit" ? "in-transit" : "all";
  const { state, setPage, cycleSort } = useListParams({ sortOrder: "desc" });

  const setTab = (t: string) => {
    const next = new URLSearchParams(sp.toString());
    if (t === "all") next.delete("tab");
    else next.set("tab", t);
    next.delete("page");
    router.replace(next.toString() ? `/stock?${next}` : "/stock", { scroll: false });
  };

  const query = {
    page: state.page,
    page_size: state.pageSize,
    sort_by: state.sortBy || undefined,
    sort_order: state.sortBy ? state.sortOrder : undefined,
  };

  const all = useStockBalances(query);
  const transit = useInTransitStock(query);
  const q = tab === "in-transit" ? transit : all;
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
    {
      key: "transit",
      header: "Type",
      cell: (r) =>
        r.is_transit ? (
          <StatusBadge tone="accent" label="In transit" />
        ) : (
          <StatusBadge tone="neutral" label="On-hand" />
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Stock balances"
        subtitle={
          tab === "in-transit"
            ? "In-transit stock — never counted as operational available."
            : data
              ? `${data.pagination.total_items} balance records · on_hand − reserved = available`
              : "Loading stock balances…"
        }
      />

      <FilterStrip ariaLabel="Stock view" options={TABS} value={tab} onChange={setTab} className="max-w-[320px]" />

      {tab === "in-transit" ? (
        <p className="inline-flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
          <Truck aria-hidden className="h-[14px] w-[14px]" />
          Transit rows are physically moving between locations. Operational Available ={" "}
          non-transit − expired − reservations.
        </p>
      ) : (
        <p className="text-[11.5px] text-[var(--faint)]">
          The flat balances list reports <span className="mono">is_transit: false</span> for every row; use the
          <span className="mono"> In transit</span> tab for the authoritative transit view.
        </p>
      )}

      <DataTable<StockBalanceRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        emptyMessage={tab === "in-transit" ? "Nothing is in transit right now." : "No stock balances."}
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
          badge: r.is_transit ? <StatusBadge tone="accent" label="In transit" /> : <StatusBadge tone="neutral" label="On-hand" />,
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
    </div>
  );
}
