"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, SlidersHorizontal } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { StockAdjustmentRequestDetailBody } from "@/components/stock-adjustments/request-detail";
import { isAdmin } from "@/lib/auth/permissions";
import { formatBusinessDateTime, formatSignedQty, formatStoredWallClock } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks/use-viewport";
import { useInventoryLedger } from "@/lib/query/inventory-movements";
import { useReportParams, type ReportParamKey } from "@/lib/reports/use-report-params";
import {
  isRedacted,
  ledgerTypeMeta,
  sourceLink,
  type LedgerItem,
} from "@/lib/api/schemas/inventory-movements";
import { LedgerFilters, activeFilterCount } from "./ledger-filters";

export const LEDGER_KEYS: readonly ReportParamKey[] = [
  "page",
  "page_size",
  "sort_order",
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

/** Signed quantity at full backend precision; colour is never the only cue (sign is explicit). */
export function SignedQuantity({ value, className }: { value: string; className?: string }) {
  const neg = value.trim().startsWith("-");
  const zero = /^-?[0.]+$/.test(value.trim());
  return (
    <span
      className={`mono tabular-nums font-semibold ${zero ? "" : neg ? "text-[var(--danger)]" : "text-[var(--success)]"} ${className ?? ""}`}
      data-raw={value}
      title={value}
    >
      {formatSignedQty(value)}
    </span>
  );
}

/**
 * Business time of a movement. Only a VERIFIED row (storage zone proven) is
 * converted to Asia/Bangkok; an unverified row shows its stored wall-clock
 * value as-is, labelled, because no conversion of it would be honest.
 */
export function When({ row }: { row: LedgerItem }) {
  if (row.timestamp_verified && row.occurred_at) {
    return <span className="mono whitespace-nowrap text-[var(--muted)]">{formatBusinessDateTime(row.occurred_at)}</span>;
  }
  return (
    <span
      className="mono whitespace-nowrap text-[var(--muted)]"
      title="Stored time whose time zone is not verified — shown as recorded, not converted to Bangkok time"
    >
      {formatStoredWallClock(row.created_at)}
      <span className="ml-1 text-[10.5px] font-semibold uppercase text-[var(--warning)]">zone unverified</span>
    </span>
  );
}

function TypeBadge({ row }: { row: LedgerItem }) {
  const meta = ledgerTypeMeta(row.movement_type);
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}

function Inactive() {
  return <span className="ml-1 text-[10.5px] font-semibold uppercase text-[var(--faint)]">inactive</span>;
}

function whereLabel(row: LedgerItem): React.ReactNode {
  return (
    <span className="mono">
      {row.warehouse.warehouse_code}
      {row.warehouse.is_active ? null : <Inactive />} / {row.location.location_code}
      {row.location.is_active ? null : <Inactive />}
    </span>
  );
}

function lotLabel(row: LedgerItem): string {
  if (!row.batch) return "—";
  const lot = row.batch.lot_no ?? `#${row.batch.id}`;
  return row.batch.expiry_date ? `${lot} · exp ${row.batch.expiry_date}` : lot;
}

export function RedactedIndicator() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-[var(--faint)]"
      title="Private adjustment details are visible only to the requester and admins"
    >
      <Lock aria-hidden className="h-3 w-3" />
      Private details hidden
    </span>
  );
}

function SourceCell({ row, onOpenRequest }: { row: LedgerItem; onOpenRequest: (id: number) => void }) {
  const link = sourceLink(row);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="flex flex-col gap-0.5">
      {link.kind === "adjustment" ? (
        <button
          type="button"
          className="mono text-left font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          onClick={(e) => {
            stop(e);
            onOpenRequest(link.requestId);
          }}
          onKeyDown={stop}
        >
          {link.label}
        </button>
      ) : link.kind === "list" ? (
        <Link
          href={link.href}
          onClick={stop}
          onKeyDown={stop}
          className="mono font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {link.label}
        </Link>
      ) : (
        <span className="mono text-[var(--muted)]">{link.label}</span>
      )}
      {isRedacted(row) ? <RedactedIndicator /> : null}
    </span>
  );
}

export function InventoryLedgerView() {
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const rp = useReportParams(LEDGER_KEYS, { page_size: 25, sort_order: "desc" });
  const v = rp.values;
  const isMobile = useMediaQuery("(max-width: 1023.98px)");
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  const bothDates = Boolean(v.from_date && v.to_date);
  const query = {
    page: rp.page,
    page_size: rp.pageSize,
    sort_order: rp.sortOrder,
    // The ledger always asks for the chronological contract: verified rows by
    // their true recorded instant, then unverified history (API default is legacy).
    order_mode: "chronological",
    product_id: v.product_id,
    warehouse_id: v.warehouse_id,
    location_id: v.location_id,
    batch_id: v.batch_id,
    movement_group: v.movement_group,
    reference_number: v.reference_number,
    from_date: bothDates ? v.from_date : undefined,
    to_date: bothDates ? v.to_date : undefined,
    // UI default hides transit legs; the API default (true) is unchanged.
    include_transit: v.include_transit === "true",
    actor: admin ? v.actor : undefined,
  };
  const q = useInventoryLedger(query);
  const rows = q.data?.items ?? [];
  const pg = q.data?.pagination;

  const [detail, setDetail] = React.useState<LedgerItem | null>(null);
  const [requestId, setRequestId] = React.useState<number | null>(null);

  const columns: Column<LedgerItem>[] = [
    {
      key: "when",
      header: "When (Bangkok)",
      cell: (r) => <When row={r} />,
    },
    { key: "type", header: "Type", cell: (r) => <TypeBadge row={r} /> },
    {
      key: "product",
      header: "Product",
      cell: (r) => (
        <div>
          <div className="font-medium">
            {r.product.product_name ?? `Product #${r.product.id}`}
            {r.product.is_active ? null : <Inactive />}
          </div>
          <div className="mono text-[11px] text-[var(--faint)]">{r.product.sku}</div>
        </div>
      ),
    },
    { key: "where", header: "Warehouse / location", cell: whereLabel },
    { key: "lot", header: "Lot", secondary: true, cell: (r) => <span className="mono">{lotLabel(r)}</span> },
    { key: "qty", header: "Quantity", align: "right", cell: (r) => <SignedQuantity value={r.quantity} /> },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      secondary: true,
      cell: (r) => (
        <span className="mono tabular-nums text-[var(--muted)]">
          {formatSignedQty(r.balance_before).replace(/^\+/, "")} → {formatSignedQty(r.balance_after).replace(/^\+/, "")}
        </span>
      ),
    },
    { key: "source", header: "Reference", cell: (r) => <SourceCell row={r} onOpenRequest={setRequestId} /> },
    {
      key: "by",
      header: "By",
      secondary: true,
      cell: (r) => <span className="text-[var(--muted)]">{r.created_by?.username ?? "system"}</span>,
    },
  ];

  const filterCount = activeFilterCount(v);
  const filters = (
    <LedgerFilters
      values={v}
      rows={rows}
      admin={admin}
      onChange={rp.setParams}
      onClear={rp.clearFilters}
      showDateHint={Boolean(v.from_date) !== Boolean(v.to_date)}
      sortOrder={rp.sortOrder}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inventory Ledger"
        subtitle={
          pg
            ? `${pg.total_items} movements · verified by recorded time, ${
                rp.sortOrder === "asc" ? "oldest first" : "newest first"
              }; then unverified history by stored time`
            : "Loading…"
        }
        actions={
          isMobile ? (
            <Button
              variant="secondary"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="ledger-filters"
            >
              <SlidersHorizontal aria-hidden className="h-4 w-4" />
              Filters{filterCount ? ` (${filterCount})` : ""}
            </Button>
          ) : null
        }
      />

      {!isMobile || filtersOpen ? (
        <div id="ledger-filters" className="flex flex-wrap items-end gap-3">
          {filters}
        </div>
      ) : null}

      {bothDates && rows.some((r) => !r.timestamp_verified) ? (
        <p role="note" className="rounded-[var(--r-sm)] bg-[var(--surface-sunken)] p-2 text-[12px] text-[var(--muted)]">
          Some rows have a stored time whose time zone is not verified (“zone unverified”). They are included when
          they could fall on the selected business days under any time zone, so the date filter may show up to 14
          hours of extra unverified rows at either edge. Verified rows match the selected days exactly.
        </p>
      ) : null}

      <DataTable<LedgerItem>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={setDetail}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        emptyMessage="No movements match these filters."
        pagination={
          pg
            ? {
                page: pg.page,
                pageSize: pg.page_size,
                totalItems: pg.total_items,
                totalPages: pg.total_pages,
                onPageChange: rp.setPage,
              }
            : undefined
        }
        renderCard={(r) => ({
          title: (
            <span className="flex w-full items-baseline justify-between gap-3">
              <span>{r.product.product_name ?? `Product #${r.product.id}`}</span>
              <SignedQuantity value={r.quantity} className="text-[15px]" />
            </span>
          ),
          badge: <TypeBadge row={r} />,
          meta: (
            <>
              <span>
                {whereLabel(r)}
                {r.batch ? <span className="mono"> · {lotLabel(r)}</span> : null}
              </span>
              <SourceCell row={r} onOpenRequest={setRequestId} />
              <span className="mono text-[var(--muted)]">
                <When row={r} /> · {r.created_by?.username ?? "system"}
              </span>
            </>
          ),
        })}
      />

      <Drawer open={detail !== null} onOpenChange={(open) => (open ? null : setDetail(null))}>
        <DrawerContent title={detail ? `Movement #${detail.id}` : "Movement"}>
          {detail ? (
            <LedgerRowDetail
              row={detail}
              onFilter={(patch) => {
                rp.setParams(patch);
                setDetail(null);
              }}
              onOpenRequest={(id) => {
                setDetail(null);
                setRequestId(id);
              }}
            />
          ) : (
            <EmptyState message="No movement selected." />
          )}
        </DrawerContent>
      </Drawer>

      <Drawer open={requestId !== null} onOpenChange={(open) => (open ? null : setRequestId(null))}>
        <DrawerContent title="Adjustment request">
          {requestId !== null ? (
            <StockAdjustmentRequestDetailBody id={requestId} role={user.role} onDone={() => setRequestId(null)} />
          ) : (
            <EmptyState message="No request selected." />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-[var(--border)] py-2 text-[13px]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function LedgerRowDetail({
  row,
  onFilter,
  onOpenRequest,
}: {
  row: LedgerItem;
  onFilter: (patch: Partial<Record<ReportParamKey, string | null>>) => void;
  onOpenRequest: (id: number) => void;
}) {
  const link = sourceLink(row);
  const adj = row.adjustment;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <TypeBadge row={row} />
        <SignedQuantity value={row.quantity} className="text-[18px]" />
      </div>
      <div>
        <Row label="When (Bangkok)">
          <When row={row} />
        </Row>
        <Row label="Product">
          {row.product.product_name} <span className="mono text-[var(--faint)]">{row.product.sku}</span>
          {row.product.is_active ? null : <Inactive />}
        </Row>
        <Row label="Warehouse">
          {row.warehouse.warehouse_name} ({row.warehouse.warehouse_code}){row.warehouse.is_active ? null : <Inactive />}
        </Row>
        <Row label="Location">
          {row.location.location_name ?? row.location.location_code}
          {row.location.location_name ? <span className="mono text-[var(--faint)]"> ({row.location.location_code})</span> : null}
          {row.location.is_active ? null : <Inactive />}
        </Row>
        <Row label="Lot">{lotLabel(row)}</Row>
        <Row label="Balance">
          <span className="mono">
            {formatSignedQty(row.balance_before).replace(/^\+/, "")} → {formatSignedQty(row.balance_after).replace(/^\+/, "")}
          </span>
        </Row>
        <Row label="Reference">
          {link.kind === "adjustment" ? (
            <button type="button" className="mono text-[var(--accent)] hover:underline" onClick={() => onOpenRequest(link.requestId)}>
              {link.label}
            </button>
          ) : link.kind === "list" ? (
            <Link href={link.href} className="mono text-[var(--accent)] hover:underline">
              {link.label}
            </Link>
          ) : (
            <span className="mono">{link.label}</span>
          )}
          {row.source.receipt_number ? <div className="mono text-[11px] text-[var(--faint)]">{row.source.receipt_number}</div> : null}
        </Row>
        {adj ? (
          <>
            <Row label="Reason">{adj.reason_code ?? "—"}</Row>
            <Row label="Requested by">{adj.requested_by?.username ?? (adj.redacted ? <RedactedIndicator /> : "—")}</Row>
            <Row label="Notes">{adj.notes ?? (adj.redacted ? <RedactedIndicator /> : "—")}</Row>
          </>
        ) : null}
        <Row label="Performed by">{row.created_by?.username ?? "system"}</Row>
        <Row label="Remark">{row.remark ?? (row.remark_redacted ? <RedactedIndicator /> : "—")}</Row>
        {row.is_transit_leg ? <Row label="Leg">Internal in-transit leg (system transit storage)</Row> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => onFilter({ product_id: String(row.product.id) })}>
          This product’s history
        </Button>
        {row.batch ? (
          <Button variant="secondary" size="sm" onClick={() => onFilter({ product_id: String(row.product.id), batch_id: String(row.batch!.id) })}>
            This lot’s history
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onFilter({ warehouse_id: String(row.warehouse.id), location_id: String(row.location.id) })}
        >
          This location
        </Button>
      </div>
    </div>
  );
}
