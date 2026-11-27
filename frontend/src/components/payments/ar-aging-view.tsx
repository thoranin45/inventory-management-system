"use client";

import * as React from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { inputCls } from "@/components/invoices/doc-parts";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/api/schemas/payments";
import { isAdmin } from "@/lib/auth/permissions";
import { businessToday } from "@/lib/business-date";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useArAging } from "@/lib/query/payments";
import { useReportExport } from "@/lib/query/reports";

export const BUCKET_LABEL: Record<AgingBucket, MessageKey> = {
  not_due: "aging.notDue",
  days_1_30: "aging.days1to30",
  days_31_60: "aging.days31to60",
  days_61_90: "aging.days61to90",
  days_over_90: "aging.over90",
};

/** F3b: accounts receivable aging by customer (Admin only), with an xlsx export. */
export function ArAgingView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const [asOf, setAsOf] = React.useState(businessToday);
  const { data, isLoading, isError, error, refetch, isFetching } = useArAging(asOf, admin);
  const exporter = useReportExport();

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("aging.title")} />
        <EmptyState title={t("invoices.adminsOnlyTitle")} message={t("invoices.adminsOnlyBody")} />
      </div>
    );
  }

  const cell = "px-3 py-2 text-right tabular-nums";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("aging.title")}
        subtitle={t("aging.subtitle")}
        actions={
          <Button
            variant="secondary"
            disabled={exporter.running}
            onClick={() => void exporter.run("/api/bff/invoices/ar-aging/export", { as_of: asOf })}
          >
            <Download aria-hidden className="h-4 w-4" />
            {t("aging.export")}
          </Button>
        }
      />
      <label className="flex max-w-[220px] flex-col gap-1" htmlFor="aging-as-of">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("aging.asOf")}</span>
        <input
          id="aging-as-of"
          type="date"
          className={inputCls}
          value={asOf}
          onChange={(e) => e.currentTarget.value && setAsOf(e.currentTarget.value)}
        />
      </label>

      {isLoading ? (
        <LoadingState label={t("aging.loading")} />
      ) : isError || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.rows.length === 0 ? (
        <EmptyState title={t("aging.emptyTitle")} message={t("aging.emptyBody", { date: formatDocDate(data.as_of) })} />
      ) : (
        <div
          className="overflow-x-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)]"
          aria-busy={isFetching}
        >
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <caption className="sr-only">{t("aging.caption", { date: formatDocDate(data.as_of) })}</caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[12px] text-[var(--muted)]">
                <th scope="col" className="px-3 py-2 text-left font-semibold">{t("payments.customer")}</th>
                <th scope="col" className={`${cell} font-semibold`}>{t("aging.invoices")}</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b} scope="col" className={`${cell} font-semibold`}>{t(BUCKET_LABEL[b])}</th>
                ))}
                <th scope="col" className={`${cell} font-semibold`}>{t("aging.total")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.customer_id} className="border-b border-[var(--border)] last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <Link className="underline" href={`/invoices?status=OPEN&search=${encodeURIComponent(row.customer_name ?? "")}`}>
                      {row.customer_name ?? `#${row.customer_id}`}
                    </Link>
                    {row.oldest_due_date ? (
                      <div className="text-[11px] font-normal text-[var(--muted)]">
                        {t("aging.oldestDue", { date: formatDocDate(row.oldest_due_date) })}
                      </div>
                    ) : null}
                  </th>
                  <td className={cell}>{row.invoice_count}</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className={cell}>
                      {row[b] === "0.00" ? <span className="text-[var(--faint)]">—</span> : <MoneyDisplay value={row[b]} />}
                    </td>
                  ))}
                  <td className={`${cell} font-semibold`}><MoneyDisplay value={row.total} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border-strong)] font-semibold">
                <th scope="row" className="px-3 py-2 text-left">{t("aging.total")}</th>
                <td className={cell}>{data.totals.invoice_count}</td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={cell}><MoneyDisplay value={data.totals[b]} /></td>
                ))}
                <td className={cell}><MoneyDisplay value={data.totals.total} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[12px] text-[var(--muted)]">{t("aging.note")}</p>
    </div>
  );
}
