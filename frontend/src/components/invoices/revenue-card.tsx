"use client";

import { MoneyDisplay } from "@/components/ui/quantity-display";
import { Banner } from "@/components/ui/states";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useRevenueSummary } from "@/lib/query/invoices";

/** Business year in Asia/Bangkok (the backend's business_today()). */
export function businessYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric" }).format(now));
}

/** F2b: net revenue this year against the 1.8M THB VAT registration threshold. */
export function RevenueCard() {
  const t = useT();
  const year = businessYear();
  const { data } = useRevenueSummary(year);
  if (!data) return null;
  const pct = Math.min(Number(data.threshold_percent), 100);
  const bar = data.level === "over" ? "var(--danger)" : data.level === "warning" ? "var(--warning)" : "var(--accent)";
  return (
    <section
      aria-label={t("invoices.revenueTitle")}
      className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="wc-section-label">{t("invoices.revenueTitle")}</h2>
        <MoneyDisplay value={data.net_revenue} className="text-[18px] font-semibold" />
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={t("invoices.revenueTitle")}
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bar }} />
      </div>
      <p className="text-[13px]">
        {t("invoices.revenueBody", {
          net: formatMoney(data.net_revenue),
          limit: formatMoney(data.vat_threshold),
          percent: data.threshold_percent,
        })}
      </p>
      <p className="text-[12px] text-[var(--muted)]">{t("invoices.revenueNote", { year: data.year })}</p>
      {data.received_total ? (
        <p className="text-[13px]">{t("invoices.receivedThisYear", { amount: formatMoney(data.received_total) })}</p>
      ) : null}
      {data.level === "warning" ? <Banner tone="warning" title={t("invoices.revenueWarning")} /> : null}
      {data.level === "over" ? <Banner tone="danger" title={t("invoices.revenueOver")} /> : null}
    </section>
  );
}
