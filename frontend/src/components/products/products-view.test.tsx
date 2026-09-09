import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { productListResponse } from "@/test/fixtures";

let role = "admin";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/products",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const useProducts = vi.fn();
vi.mock("@/lib/query/hooks", () => ({ useProducts: (...a: unknown[]) => useProducts(...a) }));
vi.mock("@/lib/query/master-data", () => ({
  useAllCategories: () => ({ data: [{ id: 9, category_name: "Loose Leaf" }] }),
}));
vi.mock("./product-detail", () => ({ ProductDetailDrawer: () => null }));
vi.mock("./create-product", () => ({ CreateProductDrawer: () => <div data-testid="create-drawer" /> }));

import { ProductsView } from "./products-view";

beforeEach(() => {
  role = "admin";
  search = "";
  replace.mockReset();
  useProducts.mockReset().mockReturnValue({
    data: productListResponse.data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  });
  window.history.replaceState(null, "", "/products");
});

describe("ProductsView (Phase 7 management)", () => {
  it("renders the Phase 7 column set", () => {
    render(<ProductsView />);
    const thead = screen.getByRole("table").querySelector("thead")!;
    for (const label of ["SKU", "Product", "Category", "Op. available", "Owned", "Reserved", "Expired", "Near expiry", "In transit", "Price", "Status"]) {
      expect(within(thead as HTMLElement).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("maps the 'Inactive' tab to a backend status=inactive query", () => {
    search = "filter=inactive";
    render(<ProductsView />);
    const q = useProducts.mock.calls.at(-1)?.[0];
    expect(q.status).toBe("inactive");
  });

  it("routes the Inactive tab through the URL", async () => {
    render(<ProductsView />);
    await userEvent.click(screen.getByRole("tab", { name: /^inactive$/i }));
    expect(String(replace.mock.calls.at(-1)?.[0])).toMatch(/filter=inactive/);
  });

  it("shows 'New product' only for admins", () => {
    const { unmount } = render(<ProductsView />);
    expect(screen.getByRole("button", { name: /new product/i })).toBeInTheDocument();
    unmount();
    role = "warehouse";
    render(<ProductsView />);
    expect(screen.queryByRole("button", { name: /new product/i })).not.toBeInTheDocument();
  });

  it("resolves category names from the real categories list", () => {
    useProducts.mockReturnValue({
      data: {
        ...productListResponse.data,
        items: [{ ...productListResponse.data.items[0], category_id: 9 }],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<ProductsView />);
    expect(screen.getAllByText("Loose Leaf").length).toBeGreaterThan(0);
  });
});
