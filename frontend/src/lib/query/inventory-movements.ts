"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useSession } from "@/components/session-provider";
import { bffJson } from "@/lib/api/browser";
import { ledgerEnvelope, type LedgerEnvelope } from "@/lib/api/schemas/inventory-movements";
import { queryKeys } from "@/lib/query/keys";

type Query = Record<string, string | number | boolean | undefined | null>;

/** Phase 14C — paginated inventory ledger. Keyed by viewer: responses are redacted per user. */
export function useInventoryLedger(query: Query) {
  const { user } = useSession();
  return useQuery<LedgerEnvelope["data"]>({
    queryKey: queryKeys.inventoryLedger.list(user.id, query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/inventory-movements", ledgerEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}
