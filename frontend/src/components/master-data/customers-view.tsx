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
import { MasterDataScreen, type MasterDataConfig } from "./master-data-screen";

const cfg: MasterDataConfig<CustomerRow, CustomerInput> = {
  resource: "customer",
  title: "Customers",
  subtitle: (total) =>
    total === undefined ? "Sales-order customers" : `${total} customer${total === 1 ? "" : "s"}`,
  searchPlaceholder: "Customer name…",
  sortFields: CUSTOMER_SORT_FIELDS,
  schema: customerInput,
  fields: [
    { name: "customer_name", label: "Customer name", required: true, autoComplete: "off" },
    { name: "phone", label: "Phone", kind: "tel", autoComplete: "off" },
    { name: "email", label: "Email", kind: "email", autoComplete: "off" },
    { name: "address", label: "Address", kind: "textarea", autoComplete: "off" },
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
  deleteBody: () =>
    "Customers are removed permanently. If the customer is referenced by existing sales orders the backend rejects the delete — you'll see the conflict and a Request ID.",
  deleteConfirmLabel: "Delete customer",
  columns: [
    {
      key: "name",
      header: "Customer",
      sortField: "customer_name",
      cell: (r) => <span className="font-medium">{r.customer_name}</span>,
    },
    {
      key: "phone",
      header: "Phone",
      cell: (r) => <span className="mono text-[var(--muted)]">{r.phone || "—"}</span>,
    },
    {
      key: "email",
      header: "Email",
      secondary: true,
      cell: (r) => <span className="text-[var(--muted)] break-all">{r.email || "—"}</span>,
    },
    {
      key: "address",
      header: "Address",
      secondary: true,
      cell: (r) => <span className="text-[var(--muted)] line-clamp-2">{r.address || "—"}</span>,
    },
  ],
  card: (r) => ({
    title: r.customer_name,
    meta: (
      <>
        <span className="mono">{r.phone || "no phone"}</span>
        <span className="break-all">{r.email || "no email"}</span>
      </>
    ),
  }),
  useList: useCustomers,
  useCreate: useCreateCustomer,
  useUpdate: useUpdateCustomer,
  useDelete: useDeleteCustomer,
};

export function CustomersView() {
  return <MasterDataScreen cfg={cfg} />;
}
