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
import { MasterDataScreen, type MasterDataConfig } from "./master-data-screen";

const cfg: MasterDataConfig<SupplierRow, SupplierInput> = {
  resource: "supplier",
  title: "Suppliers",
  subtitle: (total) =>
    total === undefined ? "Purchase-order suppliers" : `${total} supplier${total === 1 ? "" : "s"}`,
  searchPlaceholder: "Supplier name…",
  sortFields: SUPPLIER_SORT_FIELDS,
  schema: supplierInput,
  fields: [
    { name: "supplier_name", label: "Supplier name", required: true, autoComplete: "off" },
    { name: "contact_name", label: "Contact name", autoComplete: "off" },
    { name: "phone", label: "Phone", kind: "tel", autoComplete: "off" },
    { name: "email", label: "Email", kind: "email", autoComplete: "off" },
    { name: "address", label: "Address", kind: "textarea", autoComplete: "off" },
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
  deleteBody: () =>
    "Suppliers are removed permanently. If the supplier is referenced by existing purchase orders the backend rejects the delete — you'll see the conflict and a Request ID.",
  deleteConfirmLabel: "Delete supplier",
  columns: [
    {
      key: "name",
      header: "Supplier",
      sortField: "supplier_name",
      cell: (r) => <span className="font-medium">{r.supplier_name}</span>,
    },
    {
      key: "contact",
      header: "Contact",
      cell: (r) => <span className="text-[var(--muted)]">{r.contact_name || "—"}</span>,
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
    title: r.supplier_name,
    meta: (
      <>
        <span>{r.contact_name || "no contact"}</span>
        <span className="mono">{r.phone || "no phone"}</span>
        <span className="break-all">{r.email || "no email"}</span>
      </>
    ),
  }),
  useList: useSuppliers,
  useCreate: useCreateSupplier,
  useUpdate: useUpdateSupplier,
  useDelete: useDeleteSupplier,
};

export function SuppliersView() {
  return <MasterDataScreen cfg={cfg} />;
}
