"use client";

import { useQuery } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import { auditLogListSchema, type AuditLog } from "@/lib/api/schemas/audit";
import { queryKeys } from "./keys";

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation") return false;
  return failureCount < 1;
};

/**
 * GET /audit-logs/ — admin only. The backend returns EVERY row as a bare
 * array (no envelope, no pagination, no filter/sort). We render the real
 * contract; page-local search/sort is done in the component.
 */
export function useAuditLogs(enabled = true) {
  return useQuery<AuditLog[]>({
    queryKey: queryKeys.audit.all,
    enabled,
    // No trailing slash: Next normalises `/api/bff/audit-logs/` → `…/audit-logs`
    // with a 308 before our route sees it. FastAPI 307s `/audit-logs` →
    // `/audit-logs/` upstream and rawRequest follows it.
    queryFn: async ({ signal }) => bffJson("/api/bff/audit-logs", auditLogListSchema, { signal }),
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}
