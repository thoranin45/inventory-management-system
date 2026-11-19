"use client";

import * as React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { useAuditLogs } from "@/lib/query/audit";
import type { AuditLog } from "@/lib/api/schemas/audit";
import { auditActionText, auditEntityText } from "@/lib/audit-copy";
import { formatBusinessDateTime, formatStoredWallClock } from "@/lib/format";
import { useT } from "@/lib/i18n/client";

const PAGE_LOCAL_CAP = 200;

/** Bangkok time for rows the DB stamped with an instant; older rows show
 * their stored wall clock, labelled, never converted (zone unproven). */
function AuditTime({ row }: { row: AuditLog }) {
  const t = useT();
  if (row.recorded_at_utc) {
    return <span className="mono whitespace-nowrap text-[var(--muted)]">{formatBusinessDateTime(row.recorded_at_utc)}</span>;
  }
  return (
    <span className="mono whitespace-nowrap text-[var(--muted)]" title={t("adjust.storedTimeTitle")}>
      {formatStoredWallClock(row.created_at)} <span className="text-[var(--warning)]">{t("adjust.storedTime")}</span>
    </span>
  );
}

export function AuditView() {
  const { user } = useSession();
  const t = useT();
  const admin = isAdmin(user.role);
  const q = useAuditLogs(admin);
  const [search, setSearch] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("audit.title")} subtitle={t("audit.adminsOnlySubtitle")} />
        <EmptyState
          title={t("audit.adminsOnlyTitle")}
          message={t("audit.adminsOnlyBody")}
        />
      </div>
    );
  }

  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? all.filter((r) =>
        [
          r.username,
          r.action,
          r.table_name,
          auditActionText(t, r.action),
          auditEntityText(t, r.table_name),
          r.description,
          String(r.record_id ?? ""),
        ]
          .some((v) => (v ?? "").toLowerCase().includes(term)),
      )
    : all;
  const rows = showAll ? filtered : filtered.slice(0, PAGE_LOCAL_CAP);

  const columns: Column<AuditLog>[] = [
    { key: "when", header: t("audit.colWhen"), cell: (r) => <AuditTime row={r} /> },
    { key: "actor", header: t("audit.colActor"), cell: (r) => <span className="font-medium">{r.username ?? "—"}</span> },
    { key: "action", header: t("audit.colAction"), cell: (r) => <StatusBadge tone="neutral" label={auditActionText(t, r.action)} /> },
    {
      key: "entity",
      header: t("audit.colEntity"),
      cell: (r) => (
        <span className="text-[var(--muted)]">
          {auditEntityText(t, r.table_name)}
          {r.record_id != null ? <span className="mono"> #{r.record_id}</span> : null}
        </span>
      ),
    },
    { key: "desc", header: t("audit.colDescription"), secondary: true, cell: (r) => <span className="text-[12px] text-[var(--muted)]">{r.description ?? "—"}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("audit.title")}
        subtitle={
          q.data
            ? t("audit.subtitle", { n: all.length })
            : t("common.loading")
        }
      />

      <SearchInput
        value={search}
        onCommit={setSearch}
        placeholder={t("audit.searchPlaceholder")}
        ariaLabel={t("audit.searchLabel")}
        className="max-w-[340px]"
      />

      {q.isLoading ? (
        <LoadingState label={t("pages.loadingAudit")} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState message={term ? t("audit.noMatch", { term: search }) : t("audit.empty")} />
      ) : (
        <>
          <DataTable<AuditLog>
            columns={columns}
            rows={rows}
            getRowKey={(r) => String(r.id)}
            isFetching={q.isFetching}
            renderCard={(r) => ({
              title: auditActionText(t, r.action),
              badge: <StatusBadge tone="neutral" label={r.username ?? "—"} />,
              meta: (
                <>
                  <AuditTime row={r} />
                  <span>
                    {auditEntityText(t, r.table_name)}
                    {r.record_id != null ? ` #${r.record_id}` : ""}
                  </span>
                  {r.description ? <span className="w-full text-[11px] text-[var(--faint)]">{r.description}</span> : null}
                </>
              ),
            })}
          />
          {!showAll && filtered.length > PAGE_LOCAL_CAP ? (
            <Button variant="secondary" className="self-start" onClick={() => setShowAll(true)}>
              {t("audit.showAll", { n: filtered.length })}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
