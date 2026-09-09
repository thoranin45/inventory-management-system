"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * List state lives in the URL (`?page=&page_size=&search=&sort_by=&sort_order=&filter=`),
 * so refresh / back / share all restore it. Each screen owns its own state
 * simply by being its own route — there is no global client singleton.
 *
 * `state` is derived reactively from `useSearchParams()`. `commit`/`cycleSort`
 * read `window.location.search` at call time (they only run from event
 * handlers), so rapid header clicks never race a not-yet-committed render.
 */
export interface ListParamsState {
  page: number;
  pageSize: number;
  search: string;
  sortBy: string | null;
  sortOrder: "asc" | "desc";
  filter: string | null;
}

export interface ListParamsDefaults {
  pageSize?: number;
  sortOrder?: "asc" | "desc";
  filter?: string | null;
  /** URL param name the filter/tab state is stored under (default "filter"). */
  filterKey?: string;
}

function parse(
  sp: URLSearchParams,
  pageSize: number,
  sortOrder: "asc" | "desc",
  filter: string | null,
  filterKey: string,
): ListParamsState {
  const num = (k: string, def: number) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
  };
  const order = sp.get("sort_order");
  return {
    page: num("page", 1),
    pageSize: Math.min(num("page_size", pageSize), 100),
    search: sp.get("search") ?? "",
    sortBy: sp.get("sort_by"),
    sortOrder: order === "asc" || order === "desc" ? order : sortOrder,
    filter: sp.get(filterKey) ?? filter,
  };
}

export function useListParams(defaults: ListParamsDefaults = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const pageSize = defaults.pageSize ?? 20;
  const sortOrder = defaults.sortOrder ?? "desc";
  const filterDefault = defaults.filter ?? null;
  const filterKey = defaults.filterKey ?? "filter";

  const spString = sp.toString();
  const state = React.useMemo(
    () => parse(new URLSearchParams(spString), pageSize, sortOrder, filterDefault, filterKey),
    [spString, pageSize, sortOrder, filterDefault, filterKey],
  );

  const commit = React.useCallback(
    (patch: Partial<ListParamsState>, opts: { resetPage?: boolean } = {}) => {
      const currentSp = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : `?${spString}`,
      );
      const current = parse(currentSp, pageSize, sortOrder, filterDefault, filterKey);
      const merged = { ...current, ...patch };
      if (opts.resetPage && !("page" in patch)) merged.page = 1;

      const next = currentSp; // keep params this hook does not own (e.g. `tab`)
      const put = (k: string, v: string | number | null, isDefault: boolean) => {
        if (v !== null && v !== "" && !isDefault) next.set(k, String(v));
        else next.delete(k);
      };
      put("page", merged.page, merged.page === 1);
      put("page_size", merged.pageSize, merged.pageSize === pageSize);
      put("search", merged.search, merged.search === "");
      put(filterKey, merged.filter, merged.filter === null || merged.filter === filterDefault);
      put("sort_by", merged.sortBy, merged.sortBy === null);
      // when a column is sorted, always show the direction explicitly
      put("sort_order", merged.sortOrder, merged.sortBy === null);

      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, spString, pageSize, sortOrder, filterDefault, filterKey],
  );

  const setSearch = React.useCallback((search: string) => commit({ search }, { resetPage: true }), [commit]);
  const setPage = React.useCallback((page: number) => commit({ page }), [commit]);
  const setPageSize = React.useCallback((pageSize2: number) => commit({ pageSize: pageSize2 }, { resetPage: true }), [commit]);
  const setFilter = React.useCallback((filter: string | null) => commit({ filter }, { resetPage: true }), [commit]);

  /** Three-state header cycle: DEFAULT → DESC → ASC → DEFAULT. */
  const cycleSort = React.useCallback(
    (field: string) => {
      const cur = parse(
        new URLSearchParams(typeof window !== "undefined" ? window.location.search : `?${spString}`),
        pageSize,
        sortOrder,
        filterDefault,
        filterKey,
      );
      commit(cycleSortState(cur, field), { resetPage: true });
    },
    [commit, spString, pageSize, sortOrder, filterDefault, filterKey],
  );

  return { state, commit, setSearch, setPage, setPageSize, setFilter, cycleSort };
}

/**
 * Pure three-state cycle: DEFAULT → DESC → ASC → DEFAULT.
 * DEFAULT is represented by `sortBy: null` (the caller restores the backend
 * default ordering, which itself appends `id` as a deterministic tiebreak).
 */
export function cycleSortState(
  current: { sortBy: string | null; sortOrder: "asc" | "desc" },
  field: string,
): { sortBy: string | null; sortOrder: "asc" | "desc" } {
  if (current.sortBy !== field) return { sortBy: field, sortOrder: "desc" };
  if (current.sortOrder === "desc") return { sortBy: field, sortOrder: "asc" };
  return { sortBy: null, sortOrder: "desc" };
}

/** Build the query object the BFF/backend expects from list state. */
export function toBackendQuery(
  state: ListParamsState,
  extra?: Record<string, string | number | undefined>,
): Record<string, string | number | undefined> {
  return {
    page: state.page,
    page_size: state.pageSize,
    search: state.search || undefined,
    sort_by: state.sortBy || undefined,
    sort_order: state.sortBy ? state.sortOrder : undefined,
    ...extra,
  };
}
