import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 14D — the exact-lot picker must see EVERY balance of a product, not
 * just the first page. Real `fetchAllProductStock`, mocked network only.
 */
const bffJson = vi.fn();
vi.mock("@/lib/api/browser", () => ({ bffJson: (...a: unknown[]) => bffJson(...a) }));

import { fetchAllProductStock, MAX_BALANCE_PAGES } from "./hooks";

const row = (id: number) => ({
  id, product_id: 9, warehouse_id: 1, location_id: 11, batch_id: 500 + id, batch_lot_no: `LOT-${id}`,
  on_hand_qty: "1.000", reserved_qty: "0.000", available_qty: "1.000", is_transit: false,
  batch_expiry_date: null, days_to_expiry: null, is_expired: false, as_of_date: "2026-06-15",
});

/** Serves `total` rows in pages; `tamper` may rewrite a page before it is returned. */
function serve(total: number, tamper?: (page: number, data: { items: unknown[]; pagination: Record<string, number> }) => void) {
  const all = Array.from({ length: total }, (_, i) => row(i + 1));
  bffJson.mockImplementation(async (_path: string, _schema: unknown, opts: { query: { page: number; page_size: number } }) => {
    const { page, page_size } = opts.query;
    const data = {
      items: all.slice((page - 1) * page_size, page * page_size),
      pagination: { page, page_size, total_items: total, total_pages: Math.ceil(total / page_size) },
    };
    tamper?.(page, data);
    return { success: true, message: "ok", data };
  });
}

beforeEach(() => {
  bffJson.mockReset();
});

describe("fetchAllProductStock", () => {
  it("walks every page in stable id order and returns all rows (more than 50)", async () => {
    serve(250);
    const data = await fetchAllProductStock(9);
    expect(data.items).toHaveLength(250);
    expect(data.items.at(-1)?.batch_id).toBe(750); // a last-page lot is present
    expect(data.pagination.total_items).toBe(250);
    expect(bffJson).toHaveBeenCalledTimes(3);
    const queries = bffJson.mock.calls.map((c) => c[2].query);
    expect(queries.map((q) => q.page)).toEqual([1, 2, 3]);
    for (const q of queries) expect(q).toMatchObject({ page_size: 100, sort_by: "id", sort_order: "asc" });
    expect(bffJson.mock.calls[0][0]).toBe("/api/bff/stock-balances/product/9");
  });

  it("makes a single request when everything fits on one page, including an empty product", async () => {
    serve(0);
    expect((await fetchAllProductStock(9)).items).toEqual([]);
    expect(bffJson).toHaveBeenCalledTimes(1);
  });

  it("fails instead of returning a partial list when an intermediate page fails", async () => {
    serve(250);
    const ok = bffJson.getMockImplementation()!;
    bffJson.mockImplementation(async (...a: unknown[]) => {
      if ((a[2] as { query: { page: number } }).query.page === 2) throw new Error("network down");
      return ok(...a);
    });
    await expect(fetchAllProductStock(9)).rejects.toThrow("network down");
  });

  it("fails when the total changes mid-walk", async () => {
    serve(250, (page, data) => {
      if (page === 2) data.pagination.total_items = 251;
    });
    await expect(fetchAllProductStock(9)).rejects.toThrow(/changed while loading/);
  });

  it("fails when a page comes back empty before the advertised last page (no infinite loop)", async () => {
    serve(250, (page, data) => {
      if (page === 2) data.items = [];
    });
    await expect(fetchAllProductStock(9)).rejects.toThrow(/ended early/);
    expect(bffJson).toHaveBeenCalledTimes(2);
  });

  it("fails when rows shift between pages so the collected count disagrees with the total", async () => {
    serve(250, (page, data) => {
      if (page === 2) data.items = [row(100), ...data.items.slice(1)]; // a duplicate replaces a row
    });
    await expect(fetchAllProductStock(9)).rejects.toThrow(/changed while loading/);
  });

  it("refuses an unbounded total rather than looping or truncating", async () => {
    serve(1, (_page, data) => {
      data.pagination.total_items = (MAX_BALANCE_PAGES + 1) * 100;
      data.pagination.total_pages = MAX_BALANCE_PAGES + 1;
    });
    await expect(fetchAllProductStock(9)).rejects.toThrow(/too many stock balances/);
    expect(bffJson).toHaveBeenCalledTimes(1);
  });

  describe("per-page ordering and metadata verification", () => {
    it("accepts correct multi-page id-ascending data with sparse ids", async () => {
      const ids = Array.from({ length: 230 }, (_, i) => 10 + i * 7); // gaps are fine, order is what matters
      bffJson.mockImplementation(async (_p: string, _s: unknown, opts: { query: { page: number; page_size: number } }) => {
        const { page, page_size } = opts.query;
        return { success: true, message: "ok", data: {
          items: ids.slice((page - 1) * page_size, page * page_size).map(row),
          pagination: { page, page_size, total_items: 230, total_pages: 3 },
        } };
      });
      const data = await fetchAllProductStock(9);
      expect(data.items.map((r) => r.id)).toEqual(ids);
      expect(data.items.find((r) => r.id === ids[229])?.batch_lot_no).toBe(`LOT-${ids[229]}`); // last lot selectable
    });

    it("rejects a repeated page index (server answers page 1 again)", async () => {
      serve(250, (page, data) => {
        if (page === 2) data.pagination.page = 1;
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/asked for page 2, got 1/);
    });

    it("rejects a page that silently skips ahead (page 3 served for page 2)", async () => {
      serve(250, (page, data) => {
        if (page === 2) data.pagination.page = 3;
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/asked for page 2, got 3/);
    });

    it("rejects a page_size other than the one requested", async () => {
      serve(250, (_page, data) => {
        data.pagination.page_size = 50;
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/unexpected page size 50/);
    });

    it("rejects total_pages that does not match total_items", async () => {
      serve(250, (_page, data) => {
        data.pagination.total_pages = 2; // would hide the last 50 rows
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/page count does not match/);
    });

    it("rejects out-of-order ids within a page", async () => {
      serve(150, (page, data) => {
        if (page === 1) [data.items[3], data.items[4]] = [data.items[4], data.items[3]];
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/out-of-order/);
    });

    it("rejects duplicate ids within a page", async () => {
      serve(150, (page, data) => {
        if (page === 1) data.items[5] = data.items[4];
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/duplicate/);
    });

    it("rejects a page that overlaps the previous one (shifted window)", async () => {
      serve(250, (page, data) => {
        if (page === 2) data.items = [row(100), ...data.items.slice(0, 99)]; // starts one row early
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/duplicate or out-of-order/);
    });

    it("rejects a short intermediate page (rows missing)", async () => {
      serve(250, (page, data) => {
        if (page === 2) data.items = data.items.slice(0, 99);
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/page 2 has 99 of 100 rows/);
    });

    it("rejects an over-long last page", async () => {
      serve(250, (page, data) => {
        if (page === 3) data.items = [...data.items, row(9999)];
      });
      await expect(fetchAllProductStock(9)).rejects.toThrow(/page 3 has 51 of 50 rows/);
    });

    it("rejects a non-integer or non-positive id", async () => {
      for (const bad of [0, -4, 1.5]) {
        serve(3, (_page, data) => {
          (data.items[0] as { id: number }).id = bad;
        });
        await expect(fetchAllProductStock(9)).rejects.toThrow(/invalid balance id/);
      }
    });
  });
});
