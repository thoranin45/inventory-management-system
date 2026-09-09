"use client";

import {
  categoryInput,
  CATEGORY_SORT_FIELDS,
  type CategoryInput,
  type CategoryRow,
} from "@/lib/api/schemas/master-data";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/lib/query/master-data";
import { MasterDataScreen, type MasterDataConfig } from "./master-data-screen";

const cfg: MasterDataConfig<CategoryRow, CategoryInput> = {
  resource: "category",
  title: "Categories",
  subtitle: (total) =>
    total === undefined ? "Product categories" : `${total} categor${total === 1 ? "y" : "ies"} · used by product records`,
  searchPlaceholder: "Category name…",
  sortFields: CATEGORY_SORT_FIELDS,
  schema: categoryInput,
  fields: [
    { name: "category_name", label: "Category name", required: true, placeholder: "e.g. Beverages", autoComplete: "off" },
  ],
  emptyForm: { category_name: "" },
  toForm: (r) => ({ category_name: r.category_name }),
  rowId: (r) => r.id,
  rowName: (r) => r.category_name,
  deleteBody: () =>
    "Categories are removed permanently. The backend refuses this while any active product still points at the category — reassign or deactivate those products first.",
  deleteConfirmLabel: "Delete category",
  columns: [
    { key: "id", header: "ID", sortField: "id", cell: (r) => <span className="mono text-[var(--muted)]">{r.id}</span> },
    { key: "name", header: "Category", sortField: "category_name", cell: (r) => <span className="font-medium">{r.category_name}</span> },
  ],
  card: (r) => ({
    title: r.category_name,
    meta: <span className="mono">#{r.id}</span>,
  }),
  useList: useCategories,
  useCreate: useCreateCategory,
  useUpdate: useUpdateCategory,
  useDelete: useDeleteCategory,
};

export function CategoriesView() {
  return <MasterDataScreen cfg={cfg} />;
}
