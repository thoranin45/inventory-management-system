"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import { reportErrorCopy } from "@/lib/api/schemas/reports";
import { useReportExport } from "@/lib/query/reports";
import { REPORTS_BY_SLUG } from "@/lib/reports/registry";

interface QueryLike {
  isLoading: boolean;
  isFetching?: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * One layout for every report screen: back-to-Reports link, title/blurb from
 * the registry, an optional filter bar, an optional XLSX export button, and
 * uniform loading / empty / error (with Request ID + retry) handling.
 */
export function ReportShell({
  slug,
  query,
  isEmpty,
  emptyMessage,
  filters,
  exportPath,
  exportQuery,
  footNote,
  children,
}: {
  slug: string;
  query: QueryLike;
  isEmpty: boolean;
  emptyMessage: string;
  filters?: React.ReactNode;
  exportPath?: string;
  exportQuery?: Record<string, string | number | undefined>;
  footNote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const def = REPORTS_BY_SLUG[slug];
  const exporter = useReportExport();

  const err = query.isError ? query.error : null;
  const apiErr = isApiError(err) ? err : null;
  const errCopy = apiErr ? reportErrorCopy(apiErr.message) ?? apiErr.userMessage : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/reports"
          className="flex w-fit items-center gap-1 text-[12px] font-medium text-[var(--muted)] hover:text-[var(--accent)]"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Reports
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{def?.title ?? "Report"}</h1>
            {def?.blurb ? (
              <p className="mt-[5px] max-w-[64ch] text-[12.5px] leading-[1.45] text-[var(--faint)]">{def.blurb}</p>
            ) : null}
          </div>
          {exportPath ? (
            <Button
              variant="secondary"
              disabled={exporter.running}
              onClick={() => exporter.run(exportPath, exportQuery)}
            >
              {exporter.running ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <Download aria-hidden className="h-4 w-4" />
              )}
              {exporter.running ? "Preparing…" : "Export .xlsx"}
            </Button>
          ) : null}
        </div>
      </div>

      {filters ? <div className="flex flex-wrap items-end gap-3">{filters}</div> : null}

      {query.isLoading ? (
        <LoadingState label="Loading report…" />
      ) : err ? (
        <ErrorState error={err} onRetry={() => void query.refetch()} />
      ) : isEmpty ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className={query.isFetching ? "opacity-70 transition-opacity" : undefined}>{children}</div>
      )}

      {errCopy && err ? <p className="text-[11px] text-[var(--faint)]">{errCopy}</p> : null}
      {footNote && !query.isLoading && !err ? (
        <p className="text-[11px] text-[var(--faint)]">{footNote}</p>
      ) : null}
    </div>
  );
}
