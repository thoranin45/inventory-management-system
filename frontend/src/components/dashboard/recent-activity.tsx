"use client";

import Link from "next/link";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpFromLine, SlidersHorizontal } from "lucide-react";

import { Panel, PanelHead } from "@/components/ui/panel";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { SignedQuantity } from "@/components/ui/signed-quantity";
import { formatDisplayDate } from "@/lib/business-date";
import { activityWhen } from "@/lib/dashboard-metrics";
import { useI18n } from "@/lib/i18n/client";
import { ledgerTypeText, sourceLabelText } from "@/lib/ledger-copy";
import { RECENT_ACTIVITY_LIMIT, useRecentActivity } from "@/lib/query/hooks";
import { sourceLink, type LedgerItem } from "@/lib/api/schemas/inventory-movements";

type T = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];

/** The design's movement icon: inbound, outbound, or an adjustment. Tone follows the sign. */
function MoveIcon({ row, size }: { row: LedgerItem; size: number }) {
  const Icon = row.movement_type === "STOCK_ADJUST" ? SlidersHorizontal : row.direction === "IN" ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <Icon
      aria-hidden
      className="flex-none"
      style={{ width: size, height: size, color: row.direction === "IN" ? "var(--success)" : "var(--danger)" }}
    />
  );
}

function productName(t: T, row: LedgerItem): string {
  return row.product.product_name ?? t("reports.productFallback", { id: row.product.id });
}

function lotText(row: LedgerItem): string | null {
  if (!row.batch) return null;
  return row.batch.lot_no ?? `#${row.batch.id}`;
}

/** Time on the business clock; older or unverified rows also show their date (Buddhist era in Thai). */
function WhenCell({ row, t, locale }: { row: LedgerItem; t: T; locale: Locale }) {
  const when = activityWhen(row);
  return (
    <span className="flex flex-col leading-[1.3]" title={when.verified ? undefined : t("ledger.zoneUnverifiedTitle")}>
      <span className="qty text-[var(--muted)]">{when.time}</span>
      {when.date ? <span className="text-[11px] text-[var(--faint)]">{formatDisplayDate(when.date, locale)}</span> : null}
      {when.verified ? null : (
        <span className="text-[10.5px] font-semibold uppercase text-[var(--warning)]">{t("ledger.zoneUnverified")}</span>
      )}
    </span>
  );
}

/** The source document; list pages open filtered to it, anything else is shown as text. */
function Reference({ row, t }: { row: LedgerItem; t: T }) {
  const link = sourceLink(row);
  const label = sourceLabelText(t, row);
  return link.kind === "list" ? (
    <Link
      href={link.href}
      title={label}
      className="mono block truncate font-medium text-[var(--accent)] underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  ) : (
    <span title={label} className="mono block truncate text-[var(--muted)]">
      {label}
    </span>
  );
}

/**
 * UI-1 — the design's Recent activity: the newest inventory ledger rows with
 * time, movement, product and lot, signed quantity and source document (a
 * table from tablet up, a list on phones). Times are on the Asia/Bangkok
 * business clock, as in the ledger.
 */
export function RecentActivity() {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, error, refetch } = useRecentActivity();

  return (
    <Panel className="wc-activity">
      <PanelHead
        title={t("dashboard.activityTitle")}
        aside={
          <Link
            href="/inventory/ledger"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {t("dashboard.activityAll")}
            <ArrowRight aria-hidden className="h-[13px] w-[13px]" />
          </Link>
        }
      />
      {isLoading ? (
        <div className="flex flex-col gap-3 p-[18px]" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[30px]" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} compact className="m-4" />
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-8 text-center text-[12px] text-[var(--muted)]">
          <Activity aria-hidden className="h-5 w-5 text-[var(--faint)]" />
          {t("dashboard.activityEmpty")}
        </div>
      ) : (
        <>
          <table className="wc-act-table">
            <thead>
              <tr>
                <th scope="col">{t("dashboard.activityTime")}</th>
                <th scope="col">{t("reports.colType")}</th>
                <th scope="col">{t("reports.colProduct")}</th>
                <th scope="col" className="wc-num">
                  {t("reports.colQuantity")}
                </th>
                <th scope="col" className="wc-act-ref">
                  {t("reports.colReference")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, RECENT_ACTIVITY_LIMIT).map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">
                    <WhenCell row={row} t={t} locale={locale} />
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-[6px] whitespace-nowrap">
                      <MoveIcon row={row} size={15} />
                      {ledgerTypeText(t, row.movement_type)}
                    </span>
                  </td>
                  <td>
                    <span className="block truncate font-medium" title={productName(t, row)}>
                      {productName(t, row)}
                    </span>
                    {lotText(row) ? <span className="mono block truncate text-[11px] text-[var(--faint)]">{lotText(row)}</span> : null}
                  </td>
                  <td className="wc-num whitespace-nowrap">
                    <SignedQuantity value={row.quantity} />
                  </td>
                  <td className="wc-act-ref">
                    <Reference row={row} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="wc-act-list">
            {data.slice(0, RECENT_ACTIVITY_LIMIT).map((row) => {
              const when = activityWhen(row);
              return (
                <li key={row.id}>
                  <span className="wc-act-ico">
                    <MoveIcon row={row} size={17} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="truncate text-[13px]">
                      <b className="font-semibold">{ledgerTypeText(t, row.movement_type)}</b> · {productName(t, row)}
                    </span>
                    <span className="truncate text-[11.5px] text-[var(--faint)]">
                      <span className="mono">{sourceLabelText(t, row)}</span>
                      {lotText(row) ? <> · <span className="mono">{lotText(row)}</span></> : null}
                    </span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-[2px]">
                    <SignedQuantity value={row.quantity} className="text-[13px]" />
                    <span
                      className="qty text-[11px] text-[var(--faint)]"
                      title={when.verified ? undefined : t("ledger.zoneUnverifiedTitle")}
                    >
                      {when.date ? `${formatDisplayDate(when.date, locale)} ` : ""}
                      {when.time}
                      {when.verified ? null : <span className="ml-1 font-semibold text-[var(--warning)]">{t("ledger.zoneUnverified")}</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
