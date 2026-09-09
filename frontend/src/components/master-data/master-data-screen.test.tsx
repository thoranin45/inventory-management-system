import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

let role = "admin";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/categories",
  useSearchParams: () => new URLSearchParams(""),
}));

const createMut = { mutateAsync: vi.fn().mockResolvedValue({ id: 10, category_name: "Snacks" }), isPending: false };
const updateMut = { mutateAsync: vi.fn().mockResolvedValue({ id: 3, category_name: "Renamed" }), isPending: false };
const deleteMut = { mutateAsync: vi.fn().mockResolvedValue({ id: 3, category_name: "Beverages" }), isPending: false };
const listResult = {
  data: {
    items: [
      { id: 3, category_name: "Beverages" },
      { id: 4, category_name: "Bakery" },
    ],
    pagination: { page: 1, page_size: 20, total_items: 2, total_pages: 1 },
  },
  isLoading: false,
  isFetching: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
};

vi.mock("@/lib/query/master-data", () => ({
  useCategories: () => listResult,
  useCreateCategory: () => createMut,
  useUpdateCategory: () => updateMut,
  useDeleteCategory: () => deleteMut,
}));

import { CategoriesView } from "./categories-view";

beforeEach(() => {
  role = "admin";
  createMut.mutateAsync.mockClear().mockResolvedValue({ id: 10, category_name: "Snacks" });
  updateMut.mutateAsync.mockClear().mockResolvedValue({ id: 3, category_name: "Renamed" });
  deleteMut.mutateAsync.mockClear().mockResolvedValue({ id: 3, category_name: "Beverages" });
  listResult.refetch.mockClear();
});

describe("MasterDataScreen via CategoriesView", () => {
  it("lists rows and, for admins, per-row Edit/Delete + a New button", () => {
    render(<CategoriesView />);
    expect(screen.getByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Bakery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new category/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /edit beverages/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /delete bakery/i }).length).toBeGreaterThan(0);
  });

  it("hides every mutation affordance from warehouse users", () => {
    role = "warehouse";
    render(<CategoriesView />);
    expect(screen.queryByRole("button", { name: /new category/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit beverages/i })).not.toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
  });

  it("creates a category with the parsed payload", async () => {
    render(<CategoriesView />);
    await userEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/category name/i), "  Snacks  ");
    await userEvent.click(within(dialog).getByRole("button", { name: /create category/i }));
    await waitFor(() => expect(createMut.mutateAsync).toHaveBeenCalledWith({ category_name: "Snacks" }));
  });

  it("blocks submit on an empty name (client zod)", async () => {
    render(<CategoriesView />);
    await userEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /create category/i }));
    expect(await within(dialog).findByText(/category name is required/i)).toBeInTheDocument();
    expect(createMut.mutateAsync).not.toHaveBeenCalled();
  });

  it("surfaces a 409 in-use conflict with its Request ID and keeps the dialog open", async () => {
    deleteMut.mutateAsync.mockRejectedValueOnce(
      new ApiError({ status: 409, message: "Cannot delete category with active products", requestId: "req-cat-409" }),
    );
    render(<CategoriesView />);
    await userEvent.click(screen.getAllByRole("button", { name: /delete beverages/i })[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /delete category/i }));
    expect(await within(dialog).findByText(/active products/i)).toBeInTheDocument();
    expect(within(dialog).getByText("req-cat-409")).toBeInTheDocument();
  });

  it("maps a 422 field error onto the form field", async () => {
    createMut.mutateAsync.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        message: "Validation error",
        details: [{ field: "category_name", message: "too spicy" }],
      }),
    );
    render(<CategoriesView />);
    await userEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/category name/i), "Chilli");
    await userEvent.click(within(dialog).getByRole("button", { name: /create category/i }));
    expect(await within(dialog).findByText(/too spicy/i)).toBeInTheDocument();
  });
});
