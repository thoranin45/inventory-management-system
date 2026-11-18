"use client";

import {
  customerInput,
  CUSTOMER_SORT_FIELDS,
  type CustomerInput,
  type CustomerRow,
} from "@/lib/api/schemas/master-data";
import {
  useCreateCustomer,
  useCustomers,
  useDeleteCustomer,
  useUpdateCustomer,
} from "@/lib/query/master-data";
import * as React from "react";

import { useT, type I18nValue } from "@/lib/i18n/client";
import { MasterDataScreen, type MasterDataConfig } from "./master-data-screen";

const makeCfg = (t: I18nValue["t"]): MasterDataConfig<CustomerRow, CustomerInput> => ({
  resource: "customer",
  noun: t("masterData.customerNoun"),
  items: t("masterData.customerItems"),
  title: t("masterData.customersTitle"),
  subtitle: (total) =>
    total === undefined
      ? t("masterData.customersSubtitle")
      : t(total === 1 ? "masterData.customerCountOne" : "masterData.customerCountMany", { n: total }),
  searchPlaceholder: t("masterData.customerSearch"),
  sortFields: CUSTOMER_SORT_FIELDS,
  schema: customerInput,
  fields: [
    { name: "customer_name", label: t("masterData.customerName"), required: true, autoComplete: "off" },
    { name: "phone", label: t("masterData.phone"), kind: "tel", autoComplete: "off" },
    { name: "email", label: t("masterData.email"), kind: "email", autoComplete: "off" },
    { name: "address", label: t("masterData.address"), kind: "textarea", autoComplete: "off" },
  ],
  emptyForm: { customer_name: "", phone: "", email: "", address: "" },
  toForm: (r) => ({
    customer_name: r.customer_name,
    phone: r.phone ?? "",
    email: r.email ?? "",
    address: r.address ?? "",
  }),
  rowId: (r) => r.id,
  rowName: (r) => r.customer_name,
  deleteBody: () => t("masterData.customerDeleteBody"),
  columns: [
    {
      key: "name",
      header: t("masterData.colCustomer"),
      sortField: "customer_name",
      cell: (r) => <span className="font-medium">{r.customer_name}</span>,
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
    title: r.customer_name,
    meta: (
      <>
        <span className="mono">{r.phone || t("masterData.noPhone")}</span>
        <span className="break-all">{r.email || t("masterData.noEmail")}</span>
      </>
    ),
  }),
  useList: useCustomers,
  useCreate: useCreateCustomer,
  useUpdate: useUpdateCustomer,
  useDelete: useDeleteCustomer,
});

export function CustomersView() {
  const t = useT();
  const cfg = React.useMemo(() => makeCfg(t), [t]);
  return <MasterDataScreen cfg={cfg} />;
}
