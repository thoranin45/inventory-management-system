import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
let lastQuery: Record<string, unknown> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/picking",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/query/sales", () => ({
  useSalesOrders: (q: Record<string, unknown>) => {
    lastQuery = q;
    return {
      data: {
        items: [
          {
            id: 7,
            so_number: "SO-000007",
            customer_id: 1,
            customer_name: "Acme Test Co",
            status: "PICKING",
            item_count: 2,
            total_quantity: "6.000",
            total_amount: "2120.00",
            created_at: "2026-09-08T13:02:11",
            last_activity_at: "2026-09-08T13:05:00",
            picked_pct: 50,
            packed_pct: 0,
            attention_reason: null,
          },
        ],
        pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: undefined,
      refetch: vi.fn(),
    };
  },
}));

import { WorkQueue } from "./work-queue";

beforeEach(() => {
  push.mockReset();
  lastQuery = {};
});

describe("WorkQueue", () => {
  it("picking queue asks the backend for CONFIRMED,PICKING and renders rows", () => {
    render(<WorkQueue mode="pick" />);
    expect(lastQuery.status).toBe("CONFIRMED,PICKING");
    expect(screen.getByText("SO-000007")).toBeInTheDocument();
    expect(screen.getByText("Acme Test Co")).toBeInTheDocument();
  });

  it("packing queue asks the backend for PACKING only", () => {
    render(<WorkQueue mode="pack" />);
    expect(lastQuery.status).toBe("PACKING");
  });

  it("opening a row navigates to the console", async () => {
    const user = userEvent.setup();
    render(<WorkQueue mode="pick" />);
    await user.click(screen.getByText("SO-000007"));
    expect(push).toHaveBeenCalledWith("/picking/7");
  });
});
