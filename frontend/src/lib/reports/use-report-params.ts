"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * URL query state for a report screen. Deep links survive refresh / back /
 * share because everything lives in `?…`. Changing any filter resets `page`
 * to 1; `page` and `page_size` themselves don't.
 *
 * Only the keys a report actually declares are read/written — an endpoint's
 * unsupported params never appear in the URL.
 */
export type ReportParamKey =
  | "page"
  | "page_size"
  | "search"
  | "status"
  | "date_from"
  | "date_to"
  | "transaction_type"
  | "sort_by"
  | "sort_order"
  | "days"
  | "threshold"
  | "limit";

const PAGE_KEYS = new Set<ReportParamKey>(["page", "page_size"]);

export interface ReportParamsDefaults {
  page_size?: number;
  sort_order?: "asc" | "desc";
  days?: string;
  threshold?: string;
  limit?: string;
}

export function useReportParams(keys: readonly ReportParamKey[], defaults: ReportParamsDefaults = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spString = sp.toString();

  const get = React.useCallback(
    (k: ReportParamKey): string | undefined => new URLSearchParams(spString).get(k) ?? undefined,
    [spString],
  );

  const values = React.useMemo(() => {
    const cur = new URLSearchParams(spString);
    const out: Partial<Record<ReportParamKey, string>> = {};
    for (const k of keys) {
      const v = cur.get(k);
      if (v != null && v !== "") out[k] = v;
    }
    return out;
  }, [spString, keys]);

  const page = Number(values.page ?? "1") || 1;
  const pageSize = Math.min(Number(values.page_size ?? String(defaults.page_size ?? 20)) || 20, 100);
  const sortBy = values.sort_by ?? null;
  const sortOrder = (values.sort_order as "asc" | "desc") ?? defaults.sort_order ?? "desc";

  const setParams = React.useCallback(
    (patch: Partial<Record<ReportParamKey, string | number | null>>) => {
      const next = new URLSearchParams(typeof window !== "undefined" ? window.location.search : `?${spString}`);
      let touchedFilter = false;
      for (const [k, v] of Object.entries(patch) as [ReportParamKey, string | number | null][]) {
        if (v === null || v === "" || v === undefined) next.delete(k);
        else next.set(k, String(v));
        if (!PAGE_KEYS.has(k)) touchedFilter = true;
      }
      if (touchedFilter && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, spString],
  );

  const setPage = React.useCallback((p: number) => setParams({ page: p <= 1 ? null : p }), [setParams]);

  /** 3-state header cycle: DEFAULT → DESC → ASC → DEFAULT. */
  const cycleSort = React.useCallback(
    (field: string) => {
      const curBy = new URLSearchParams(typeof window !== "undefined" ? window.location.search : `?${spString}`).get("sort_by");
      const curOrder = new URLSearchParams(typeof window !== "undefined" ? window.location.search : `?${spString}`).get("sort_order");
      if (curBy !== field) setParams({ sort_by: field, sort_order: "desc" });
      else if (curOrder === "desc") setParams({ sort_by: field, sort_order: "asc" });
      else setParams({ sort_by: null, sort_order: null });
    },
    [setParams, spString],
  );

  const clearFilters = React.useCallback(() => {
    const clear: Partial<Record<ReportParamKey, null>> = {};
    for (const k of keys) if (!PAGE_KEYS.has(k) && k !== "sort_by" && k !== "sort_order") clear[k] = null;
    setParams({ ...clear, page: null });
  }, [keys, setParams]);

  return { values, get, page, pageSize, sortBy, sortOrder, setParams, setPage, cycleSort, clearFilters };
}
