"use client";

import * as React from "react";
import { ChevronsUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { useMediaQuery } from "@/lib/hooks/use-viewport";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { EmptyState, ErrorState, LoadingState } from "./states";

export interface Column<Row> {
  key: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  align?: "left" | "right";
  /** Comparable value for internal (uncontrolled) sorting; omit → not sortable. */
  sortVal?: (row: Row) => string | number;
  /** Backend sort field name — enables server-driven sorting for this column. */
  sortField?: string;
  /** Hidden on the compact (≤1199.98px) table to prioritise columns. */
  secondary?: boolean;
}

export interface SortState {
  field: string;
  order: "asc" | "desc";
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * Production DataTable.
 *  - Desktop / iPad-landscape: real table (compact hides `secondary` columns
 *    between 1024–1199px for column priority).
 *  - ≤1023.98px: `renderCard` card list — never a squeezed table.
 *  - Server-driven 3-state sort via `sort` + `onSort` (parent runs the
 *    DEFAULT→DESC→ASC→DEFAULT cycle, usually through the URL). Falls back to
 *    internal sorting when `onSort` is absent; internal sort tiebreaks on the
 *    row key for determinism.
 *  - Loading / empty / error states, server pagination footer.
 *  - Keyboard-sortable headers (Enter/Space), `aria-sort`.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  onRowActivate,
  renderCard,
  isLoading,
  isFetching,
  error,
  onRetry,
  emptyMessage,
  sort,
  onSort,
  pagination,
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => string;
  onRowActivate?: (row: Row) => void;
  renderCard?: (row: Row) => { title: React.ReactNode; meta: React.ReactNode; badge?: React.ReactNode };
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage?: string;
  sort?: SortState | null;
  onSort?: (field: string) => void;
  pagination?: DataTablePagination;
  className?: string;
}) {
  const isMobile = useMediaQuery("(max-width: 1023.98px)");
  const compact = useMediaQuery("(max-width: 1199.98px)");
  const [internalSort, setInternalSort] = React.useState<{ key: string; order: "asc" | "desc" } | null>(null);

  const visibleColumns = React.useMemo(
    () => (compact && !isMobile ? columns.filter((c) => !c.secondary) : columns),
    [columns, compact, isMobile],
  );

  const activeField = onSort ? (sort?.field ?? null) : internalSort?.key ?? null;
  const activeOrder = onSort ? (sort?.order ?? "desc") : internalSort?.order ?? "desc";

  const activate = React.useCallback(
    (col: Column<Row>) => {
      if (onSort && col.sortField) return onSort(col.sortField);
      if (!col.sortVal) return;
      setInternalSort((prev) => {
        if (!prev || prev.key !== col.key) return { key: col.key, order: "desc" };
        if (prev.order === "desc") return { key: col.key, order: "asc" };
        return null; // third activation → default order
      });
    },
    [onSort],
  );

  const displayRows = React.useMemo(() => {
    if (onSort || !internalSort) return rows;
    const col = columns.find((c) => c.key === internalSort.key);
    if (!col?.sortVal) return rows;
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const va = col.sortVal!(a.r);
        const vb = col.sortVal!(b.r);
        let cmp = va < vb ? -1 : va > vb ? 1 : 0;
        if (cmp === 0) cmp = getRowKey(a.r, a.i) < getRowKey(b.r, b.i) ? -1 : 1;
        return internalSort.order === "asc" ? cmp : -cmp;
      })
      .map((x) => x.r);
  }, [rows, internalSort, onSort, columns, getRowKey]);

  const body = (() => {
    if (isLoading) return <LoadingState label="Loading…" />;
    if (error) return <ErrorState error={error} onRetry={onRetry} className="m-4" />;
    if (!rows.length) return <EmptyState message={emptyMessage ?? "No records match the current filter."} />;

    if (isMobile && renderCard) {
      return (
        <div className="grid grid-cols-1 gap-[10px] min-[640px]:grid-cols-2">
          {displayRows.map((row, i) => {
            const c = renderCard(row);
            return (
              <button
                key={getRowKey(row, i)}
                type="button"
                onClick={() => onRowActivate?.(row)}
                className="flex flex-col gap-[6px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-[13px] text-left focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <div className="flex items-start justify-between gap-[10px]">
                  <div className="text-[14px] font-semibold">{c.title}</div>
                  {c.badge}
                </div>
                <div className="flex flex-wrap gap-x-[14px] gap-y-[6px] text-[12px] text-[var(--muted)]">{c.meta}</div>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="wc-scrollbar-none overflow-x-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const sortable = !!(col.sortField && onSort) || !!col.sortVal;
                const isActive = sortable && activeField === (col.sortField ?? col.key);
                const Icon = !isActive ? ChevronsUpDown : activeOrder === "asc" ? ChevronUp : ChevronDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={isActive ? (activeOrder === "asc" ? "ascending" : "descending") : "none"}
                    {...(sortable
                      ? {
                          tabIndex: 0,
                          role: "button" as const,
                          onClick: () => activate(col),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              activate(col);
                            }
                          },
                        }
                      : {})}
                    className={cn(
                      "sticky top-0 z-[1] whitespace-nowrap border-b border-[var(--border)] bg-[var(--surface)] px-3 py-[10px] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]",
                      col.align === "right" ? "text-right" : "text-left",
                      sortable &&
                        "cursor-pointer select-none hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]",
                    )}
                  >
                    <span className={cn("inline-flex items-center gap-1", col.align === "right" && "flex-row-reverse")}>
                      {col.header}
                      {sortable ? <Icon aria-hidden className="h-3 w-3" /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr
                key={getRowKey(row, i)}
                {...(onRowActivate
                  ? {
                      tabIndex: 0,
                      role: "button" as const,
                      onClick: () => onRowActivate(row),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter") onRowActivate(row);
                      },
                    }
                  : {})}
                className={cn(
                  onRowActivate && "cursor-pointer",
                  "hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]",
                )}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "border-b border-[var(--border)] px-3 py-[11px] align-middle",
                      col.align === "right" && "text-right",
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })();

  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy={isFetching || undefined}>
      {body}
      {pagination && !isLoading && !error && rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--muted)]">
          <span className="tnum">
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Previous page"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </Button>
            <span className="tnum px-1">
              {pagination.page} / {Math.max(pagination.totalPages, 1)}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Next page"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
