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
import { auditActionLabel, auditEntityLabel, type AuditLog } from "@/lib/api/schemas/audit";
import { formatIsoDate } from "@/lib/format";

const PAGE_LOCAL_CAP = 200;

export function AuditView() {
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const q = useAuditLogs(admin);
  const [search, setSearch] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Audit log" subtitle="Administrators only" />
        <EmptyState
          title="Admins only"
          message="The audit log is restricted to administrators. Ask an admin if you need an entry checked."
        />
      </div>
    );
  }

  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? all.filter((r) =>
        [r.username, r.action, r.table_name, r.description, String(r.record_id ?? "")]
          .some((v) => (v ?? "").toLowerCase().includes(term)),
      )
    : all;
  const rows = showAll ? filtered : filtered.slice(0, PAGE_LOCAL_CAP);

  const columns: Column<AuditLog>[] = [
    { key: "when", header: "When", cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.created_at)}</span> },
    { key: "actor", header: "Actor", cell: (r) => <span className="font-medium">{r.username ?? "—"}</span> },
    { key: "action", header: "Action", cell: (r) => <StatusBadge tone="neutral" label={auditActionLabel(r.action)} /> },
    {
      key: "entity",
      header: "Entity",
      cell: (r) => (
        <span className="text-[var(--muted)]">
          {auditEntityLabel(r.table_name)}
          {r.record_id != null ? <span className="mono"> #{r.record_id}</span> : null}
        </span>
      ),
    },
    { key: "desc", header: "Description", secondary: true, cell: (r) => <span className="text-[12px] text-[var(--muted)]">{r.description ?? "—"}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit log"
        subtitle={
          q.data
            ? `${all.length} events · newest first · the backend returns the full log (no server paging)`
            : "Loading…"
        }
      />

      <SearchInput
        value={search}
        onCommit={setSearch}
        placeholder="Actor, action, entity, description…"
        ariaLabel="Search audit log"
        className="max-w-[340px]"
      />

      {q.isLoading ? (
        <LoadingState label="Loading audit log…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState message={term ? `No audit events match “${search}”.` : "No audit events found."} />
      ) : (
        <>
          <DataTable<AuditLog>
            columns={columns}
            rows={rows}
            getRowKey={(r) => String(r.id)}
            isFetching={q.isFetching}
            renderCard={(r) => ({
              title: auditActionLabel(r.action),
              badge: <StatusBadge tone="neutral" label={r.username ?? "—"} />,
              meta: (
                <>
                  <span className="mono">{formatIsoDate(r.created_at)}</span>
                  <span>
                    {auditEntityLabel(r.table_name)}
                    {r.record_id != null ? ` #${r.record_id}` : ""}
                  </span>
                  {r.description ? <span className="w-full text-[11px] text-[var(--faint)]">{r.description}</span> : null}
                </>
              ),
            })}
          />
          {!showAll && filtered.length > PAGE_LOCAL_CAP ? (
            <Button variant="secondary" className="self-start" onClick={() => setShowAll(true)}>
              Show all {filtered.length} events (page-local)
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
