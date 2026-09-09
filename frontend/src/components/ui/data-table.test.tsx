import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTable, type Column } from "./data-table";

type Row = { id: number; sku: string; qty: number };
const rows: Row[] = [
  { id: 1, sku: "B", qty: 30 },
  { id: 2, sku: "A", qty: 10 },
  { id: 3, sku: "C", qty: 20 },
];
const columns: Column<Row>[] = [
  { key: "sku", header: "SKU", cell: (r) => r.sku, sortVal: (r) => r.sku },
  { key: "qty", header: "Qty", align: "right", cell: (r) => String(r.qty), sortVal: (r) => r.qty },
];

function bodyKeys() {
  return screen
    .getAllByRole("row")
    .slice(1) // drop the header row
    .map((tr) => within(tr).getAllByRole("cell")[0].textContent);
}

describe("DataTable — internal three-state sort", () => {
  it("DEFAULT (input order) → DESC → ASC → DEFAULT, with aria-sort", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => String(r.id)} />);

    expect(bodyKeys()).toEqual(["B", "A", "C"]); // as provided

    const qtyHeader = screen.getByRole("button", { name: /qty/i });
    await user.click(qtyHeader); // DESC
    expect(qtyHeader).toHaveAttribute("aria-sort", "descending");
    expect(bodyKeys()).toEqual(["B", "C", "A"]); // 30,20,10

    await user.click(qtyHeader); // ASC
    expect(qtyHeader).toHaveAttribute("aria-sort", "ascending");
    expect(bodyKeys()).toEqual(["A", "C", "B"]); // 10,20,30

    await user.click(qtyHeader); // DEFAULT
    expect(qtyHeader).toHaveAttribute("aria-sort", "none");
    expect(bodyKeys()).toEqual(["B", "A", "C"]);
  });

  it("keyboard (Enter) drives the same cycle", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => String(r.id)} />);
    const skuHeader = screen.getByRole("button", { name: /sku/i });
    skuHeader.focus();
    await user.keyboard("{Enter}");
    expect(skuHeader).toHaveAttribute("aria-sort", "descending");
    expect(bodyKeys()).toEqual(["C", "B", "A"]);
  });
});

describe("DataTable — mobile card fallback", () => {
  it("renders renderCard() output when the viewport is mobile", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({
      matches: q.includes("1023.98"), // mobile
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        renderCard={(r) => ({ title: `Card ${r.sku}`, meta: <span>qty {r.qty}</span> })}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Card B")).toBeInTheDocument();
    expect(screen.getByText("qty 10")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe("DataTable — states", () => {
  it("shows the empty state", () => {
    render(<DataTable columns={columns} rows={[]} getRowKey={(r) => String(r.id)} emptyMessage="Nothing." />);
    expect(screen.getByText("Nothing.")).toBeInTheDocument();
  });
});
