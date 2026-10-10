"use client";

import { useQuery } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import { warehouseListEnvelope, type Warehouse } from "@/lib/api/schemas/warehouses";
import { queryKeys } from "@/lib/query/keys";

/** Phase 14B — read-only warehouse/location directory. __TRANSIT__ excluded
 * server-side; never a picker for transit storage. */
export function useWarehouses(activeOnly = true) {
  return useQuery<Warehouse[]>({
    queryKey: [...queryKeys.warehouses.all, activeOnly],
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/warehouses", warehouseListEnvelope, {
        query: { active_only: activeOnly },
        signal,
      });
      return env.data;
    },
    staleTime: 60_000,
  });
}
