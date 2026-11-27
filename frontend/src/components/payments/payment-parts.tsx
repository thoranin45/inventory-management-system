"use client";

import * as React from "react";

import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field } from "@/components/invoices/doc-parts";
import type { PaymentMethod } from "@/lib/api/schemas/payments";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useInvoices } from "@/lib/query/invoices";
import { useCustomerSearch } from "@/lib/query/sales";

/** Shared pieces for the F3b receipt and billing-note screens. */

export const METHOD_LABEL: Record<PaymentMethod, MessageKey> = {
  CASH: "payments.methodCASH",
  TRANSFER: "payments.methodTRANSFER",
  CHEQUE: "payments.methodCHEQUE",
  OTHER: "payments.methodOTHER",
};

export function methodLabel(t: ReturnType<typeof useT>, method: string): string {
  return method in METHOD_LABEL ? t(METHOD_LABEL[method as PaymentMethod]) : method;
}

/** UNPAID / PARTIAL / PAID chip for an issued invoice (computed by the backend). */
export function PaymentStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <StatusBadge status={status.toUpperCase()} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function CustomerPicker({ id, value, onPick, error }: {
  id: string;
  value: ComboboxItem | null;
  onPick: (item: ComboboxItem | null) => void;
  error?: string;
}) {
  const t = useT();
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const { data, isFetching } = useCustomerSearch(debounced);
  const items: ComboboxItem[] = (data ?? []).map((c) => ({
    id: c.id,
    label: c.customer_name,
    sublabel: [c.phone, c.email].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <Field label={t("payments.customer")} error={error} htmlFor={id}>
      <Combobox
        id={id}
        ariaLabel={t("sales.searchCustomers")}
        value={value}
        onChange={onPick}
        onSearch={setTerm}
        items={items}
        loading={isFetching}
        placeholder={t("sales.searchCustomersPlaceholder")}
        emptyText={t("sales.noCustomers")}
      />
    </Field>
  );
}

/** Issued invoices of one customer that still have a balance, oldest due first (max 100). */
export function useOpenInvoices(customerId: number | null) {
  return useInvoices(
    {
      page: 1,
      page_size: 100,
      customer_id: customerId ?? undefined,
      payment: "open",
      sort_by: "due_date",
      sort_order: "asc",
    },
    customerId !== null,
  );
}
