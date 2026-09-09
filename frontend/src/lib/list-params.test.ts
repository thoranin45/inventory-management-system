import { describe, expect, it } from "vitest";

import { cycleSortState, toBackendQuery, type ListParamsState } from "./list-params";

const base: ListParamsState = {
  page: 1,
  pageSize: 20,
  search: "",
  sortBy: null,
  sortOrder: "desc",
  filter: null,
};

describe("three-state sort cycle", () => {
  it("DEFAULT → DESC → ASC → DEFAULT on the same field", () => {
    let s = cycleSortState({ sortBy: null, sortOrder: "desc" }, "stock_qty");
    expect(s).toEqual({ sortBy: "stock_qty", sortOrder: "desc" });
    s = cycleSortState(s as never, "stock_qty");
    expect(s).toEqual({ sortBy: "stock_qty", sortOrder: "asc" });
    s = cycleSortState(s as never, "stock_qty");
    expect(s).toEqual({ sortBy: null, sortOrder: "desc" }); // back to backend default
  });

  it("switching to a different field starts at DESC", () => {
    expect(cycleSortState({ sortBy: "sku", sortOrder: "asc" }, "product_name")).toEqual({
      sortBy: "product_name",
      sortOrder: "desc",
    });
  });
});

describe("toBackendQuery", () => {
  it("omits sort_order unless a column is sorted", () => {
    expect(toBackendQuery(base)).toEqual({
      page: 1,
      page_size: 20,
      search: undefined,
      sort_by: undefined,
      sort_order: undefined,
    });
  });

  it("includes search + sort when set", () => {
    expect(
      toBackendQuery({ ...base, page: 2, search: "coffee", sortBy: "stock_qty", sortOrder: "asc" }),
    ).toEqual({
      page: 2,
      page_size: 20,
      search: "coffee",
      sort_by: "stock_qty",
      sort_order: "asc",
    });
  });

  it("merges extra params (e.g. a screen tab)", () => {
    expect(toBackendQuery(base, { tab: "in-transit" }).tab).toBe("in-transit");
  });
});
