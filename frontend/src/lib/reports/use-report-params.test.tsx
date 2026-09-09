import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reports/movements",
  useSearchParams: () => new URLSearchParams(search),
}));

import { useReportParams } from "./use-report-params";

function Harness() {
  const rp = useReportParams(["search", "status", "date_from", "date_to", "transaction_type", "sort_by", "sort_order", "page", "page_size"], {
    page_size: 25,
  });
  return (
    <div>
      <output data-testid="page">{rp.page}</output>
      <output data-testid="sort">{rp.sortBy ?? "none"}:{rp.sortOrder}</output>
      <button onClick={() => rp.setParams({ transaction_type: "OUT_FEFO" })}>set type</button>
      <button onClick={() => rp.setPage(3)}>go page 3</button>
      <button onClick={() => rp.cycleSort("created_at")}>cycle sort</button>
      <button onClick={() => rp.clearFilters()}>clear</button>
    </div>
  );
}

beforeEach(() => {
  replace.mockReset();
  search = "";
  window.history.replaceState(null, "", "/reports/movements");
});

describe("useReportParams", () => {
  it("reads deep-link query state", () => {
    search = "page=2&transaction_type=IN_PO";
    render(<Harness />);
    expect(screen.getByTestId("page").textContent).toBe("2");
  });

  it("changing a filter drops page back to 1", async () => {
    search = "page=4";
    window.history.replaceState(null, "", "/reports/movements?page=4");
    render(<Harness />);
    await userEvent.click(screen.getByText("set type"));
    const url = String(replace.mock.calls.at(-1)?.[0]);
    expect(url).toMatch(/transaction_type=OUT_FEFO/);
    expect(url).not.toMatch(/page=/);
  });

  it("page navigation keeps other params and omits page=1", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("go page 3"));
    expect(String(replace.mock.calls.at(-1)?.[0])).toMatch(/page=3/);
  });

  it("cycleSort runs DEFAULT → DESC → ASC → DEFAULT", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("cycle sort"));
    expect(String(replace.mock.calls.at(-1)?.[0])).toMatch(/sort_by=created_at&sort_order=desc|sort_order=desc&sort_by=created_at/);

    search = "sort_by=created_at&sort_order=desc";
    window.history.replaceState(null, "", "/reports/movements?sort_by=created_at&sort_order=desc");
    await userEvent.click(screen.getByText("cycle sort"));
    expect(String(replace.mock.calls.at(-1)?.[0])).toMatch(/sort_order=asc/);

    search = "sort_by=created_at&sort_order=asc";
    window.history.replaceState(null, "", "/reports/movements?sort_by=created_at&sort_order=asc");
    await userEvent.click(screen.getByText("cycle sort"));
    expect(String(replace.mock.calls.at(-1)?.[0])).not.toMatch(/sort_by=/);
  });

  it("clearFilters wipes filter params but not sort", async () => {
    search = "search=foo&status=DRAFT&sort_by=created_at&sort_order=asc&page=2";
    window.history.replaceState(null, "", "/reports/movements?" + search);
    render(<Harness />);
    await userEvent.click(screen.getByText("clear"));
    const url = String(replace.mock.calls.at(-1)?.[0]);
    expect(url).not.toMatch(/search=/);
    expect(url).not.toMatch(/status=/);
    expect(url).not.toMatch(/page=/);
    expect(url).toMatch(/sort_by=created_at/);
  });
});
