"use client";

import {
  supplierInput,
  SUPPLIER_SORT_FIELDS,
  type SupplierInput,
  type SupplierRow,
} from "@/lib/api/schemas/master-data";
import {
  useCreateSupplier,
  useDeleteSupplier,
  useSuppliers,
  useUpdateSupplier,
} from "@/lib/query/master-data";
import * as React from "react";

import { useT, type I18nValue } from "@/lib/i18n/client";
import { MasterDataScreen, type MasterDataConfig } from "./master-data-screen";

const makeCfg = (t: I18nValue["t"]): MasterDataConfig<SupplierRow, SupplierInput> => ({
  resource: "supplier",
  noun: t("masterData.supplierNoun"),
  items: t("masterData.supplierItems"),
  title: t("masterData.suppliersTitle"),
  subtitle: (total) =>
    total === undefined
      ? t("masterData.suppliersSubtitle")
      : t(total === 1 ? "masterData.supplierCountOne" : "masterData.supplierCountMany", { n: total }),
  searchPlaceholder: t("masterData.supplierSearch"),
  sortFields: SUPPLIER_SORT_FIELDS,
  schema: supplierInput,
  fields: [
    { name: "supplier_name", label: t("masterData.supplierName"), required: true, autoComplete: "off" },
    { name: "contact_name", label: t("masterData.contactName"), autoComplete: "off" },
    { name: "phone", label: t("masterData.phone"), kind: "tel", autoComplete: "off" },
    { name: "email", label: t("masterData.email"), kind: "email", autoComplete: "off" },
    { name: "address", label: t("masterData.address"), kind: "textarea", autoComplete: "off" },
  ],
  emptyForm: { supplier_name: "", contact_name: "", phone: "", email: "", address: "" },
  toForm: (r) => ({
    supplier_name: r.supplier_name,
    contact_name: r.contact_name ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    address: r.address ?? "",
  }),
  rowId: (r) => r.id,
  rowName: (r) => r.supplier_name,
  deleteBody: () => t("masterData.supplierDeleteBody"),
  columns: [
    {
      key: "name",
      header: t("masterData.colSupplier"),
      sortField: "supplier_name",
      cell: (r) => <span className="font-medium">{r.supplier_name}</span>,
    },
    {
      key: "contact",
      header: t("masterData.colContact"),
      cell: (r) => <span className="text-[var(--muted)]">{r.contact_name || "—"}</span>,
    },
    {
      key: "phone",
      header: t("masterData.phone"),
      cell: (r) => <span className="mono text-[var(--muted)]">{r.phone || "—"}</span>,
    },
    {
      key: "email",
      header: t("masterData.email"),
      secondary: true,
      cell: (r) => <span className="text-[var(--muted)] break-all">{r.email || "—"}</span>,
    },
    {
      key: "address",
      header: t("masterData.address"),
      secondary: true,
      cell: (r) => <span className="text-[var(--muted)] line-clamp-2">{r.address || "—"}</span>,
    },
  ],
  card: (r) => ({
    title: r.supplier_name,
    meta: (
      <>
        <span>{r.contact_name || t("masterData.noContact")}</span>
        <span className="mono">{r.phone || t("masterData.noPhone")}</span>
        <span className="break-all">{r.email || t("masterData.noEmail")}</span>
      </>
    ),
  }),
  useList: useSuppliers,
  useCreate: useCreateSupplier,
  useUpdate: useUpdateSupplier,
  useDelete: useDeleteSupplier,
});

export function SuppliersView() {
  const t = useT();
  const cfg = React.useMemo(() => makeCfg(t), [t]);
  return <MasterDataScreen cfg={cfg} />;
}
