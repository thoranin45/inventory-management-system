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
import * as React from "react";

import { useT, type I18nValue } from "@/lib/i18n/client";
import { MasterDataScreen, type MasterDataConfig } from "./master-data-screen";

const makeCfg = (t: I18nValue["t"]): MasterDataConfig<CategoryRow, CategoryInput> => ({
  resource: "category",
  noun: t("masterData.categoryNoun"),
  items: t("masterData.categoryItems"),
  title: t("masterData.categoriesTitle"),
  subtitle: (total) =>
    total === undefined
      ? t("masterData.categoriesSubtitle")
      : t(total === 1 ? "masterData.categoryCountOne" : "masterData.categoryCountMany", { n: total }),
  searchPlaceholder: t("masterData.categorySearch"),
  sortFields: CATEGORY_SORT_FIELDS,
  schema: categoryInput,
  fields: [
    {
      name: "category_name",
      label: t("masterData.categoryName"),
      required: true,
      placeholder: t("masterData.categoryPlaceholder"),
      autoComplete: "off",
    },
  ],
  emptyForm: { category_name: "" },
  toForm: (r) => ({ category_name: r.category_name }),
  rowId: (r) => r.id,
  rowName: (r) => r.category_name,
  deleteBody: () => t("masterData.categoryDeleteBody"),
  columns: [
    { key: "id", header: t("masterData.colId"), sortField: "id", cell: (r) => <span className="mono text-[var(--muted)]">{r.id}</span> },
    { key: "name", header: t("masterData.colCategory"), sortField: "category_name", cell: (r) => <span className="font-medium">{r.category_name}</span> },
  ],
  card: (r) => ({
    title: r.category_name,
    meta: <span className="mono">#{r.id}</span>,
  }),
  useList: useCategories,
  useCreate: useCreateCategory,
  useUpdate: useUpdateCategory,
  useDelete: useDeleteCategory,
});

export function CategoriesView() {
  const t = useT();
  const cfg = React.useMemo(() => makeCfg(t), [t]);
  return <MasterDataScreen cfg={cfg} />;
}
