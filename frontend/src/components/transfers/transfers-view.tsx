"use client";

import * as React from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/lib/list-params";
import { useTransfers } from "@/lib/query/transfers";
import { formatIsoDate } from "@/lib/format";
import { TRANSFER_FILTER_TABS, type TransferDetail, type TransferRow } from "@/lib/api/schemas/transfers";
import { TransferDetailDrawer } from "./transfer-detail";
import { CreateTransferDrawer } from "./create-transfer";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

export function TransfersView() {
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });

  const filter = state.filter ?? "all";
  const tab = TRANSFER_FILTER_TABS.find((t) => t.key === filter) ?? TRANSFER_FILTER_TABS[0];

  const query = React.useMemo(
    () => ({
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      status: tab.status ?? undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortOrder, tab.status],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useTransfers(query);
  const rows = data?.items ?? [];

  const [selected, setSelected] = React.useState<TransferRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const openRow = (r: TransferRow) => {
    setSelected(r);
    setDrawerOpen(true);
  };

  const onCreated = (d: TransferDetail) => {
    setCreateOpen(false);
    void refetch();
    setSelected({
      id: d.id,
      transfer_number: d.transfer_number,
      source_warehouse_id: d.source_warehouse_id,
      source_warehouse_name: null,
      destination_warehouse_id: d.destination_warehouse_id,
      destination_warehouse_name: null,
      status: d.status,
      line_count: d.items.length,
      total_quantity: "0",
      dispatched_quantity: "0",
      received_quantity: "0",
      outstanding_quantity: "0",
      progress_pct: 0,
      dispatched_at: null,
      latest_receipt_at: null,
      legacy_completed: d.legacy_completed,
    });
    setDrawerOpen(true);
  };

  const wh = (id: number, name: string | null) => name ?? `Warehouse #${id}`;

  const columns: Column<TransferRow>[] = [
    {
      key: "transfer_number",
      header: "Transfer #",
      sortField: "transfer_number",
      cell: (r) => <span className="mono font-medium">{r.transfer_number}</span>,
    },
    { key: "source", header: "Source", cell: (r) => <span>{wh(r.source_warehouse_id, r.source_warehouse_name)}</span> },
    {
      key: "destination",
      header: "Destination",
      cell: (r) => <span>{wh(r.destination_warehouse_id, r.destination_warehouse_name)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortField: "status",
      cell: (r) =>
        r.legacy_completed ? (
          <StatusBadge tone="neutral" label="Legacy completed" />
        ) : (
          <StatusBadge status={r.status.toUpperCase()} />
        ),
    },
    {
      key: "lines",
      header: "Lines",
      align: "right",
      secondary: true,
      cell: (r) => <span className="tnum text-[var(--muted)]">{r.line_count}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.total_quantity} className="text-[var(--muted)]" />,
    },
    {
      key: "dispatched",
      header: "Dispatched",
      align: "right",
      cell: (r) => <QuantityDisplay value={r.dispatched_quantity} />,
    },
    {
      key: "received",
      header: "Received",
      align: "right",
      cell: (r) => <QuantityDisplay value={r.received_quantity} />,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.outstanding_quantity} className="text-[var(--muted)]" />,
    },
    {
      key: "progress",
      header: "Progress",
      align: "right",
      cell: (r) => <span className="tnum">{pct(r.progress_pct)}</span>,
    },
    {
      key: "dispatched_at",
      header: "Dispatched at",
      sortField: "dispatched_at",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.dispatched_at)}</span>,
    },
    {
      key: "latest_receipt",
      header: "Latest receipt",
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.latest_receipt_at)}</span>,
    },
  ];

  const total = data?.pagination.total_items ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inventory Transfers"
        subtitle={data ? `${total} transfers · source → transit → destination` : "Loading transfers…"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/stock?tab=in-transit">View in-transit inventory</Link>
            </Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New transfer
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel="Transfer status filter"
          options={TRANSFER_FILTER_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder="Transfer number…"
          ariaLabel="Search transfers"
          className="max-w-[320px]"
        />
      </div>

      <DataTable<TransferRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={openRow}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage="No transfers match the current filter."
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
          title: <span className="mono">{r.transfer_number}</span>,
          badge: r.legacy_completed ? (
            <StatusBadge tone="neutral" label="Legacy" />
          ) : (
            <StatusBadge status={r.status.toUpperCase()} />
          ),
          meta: (
            <>
              <span>
                {wh(r.source_warehouse_id, r.source_warehouse_name)} → {wh(r.destination_warehouse_id, r.destination_warehouse_name)}
              </span>
              <span>{r.line_count} lines</span>
              <span>
                <QuantityDisplay value={r.received_quantity} className="font-medium" /> /{" "}
                <QuantityDisplay value={r.dispatched_quantity} /> received
              </span>
            </>
          ),
        })}
      />

      <TransferDetailDrawer row={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
      <CreateTransferDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
    </div>
  );
}
