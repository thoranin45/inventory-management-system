"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { z } from "zod";

import { bffJson } from "@/lib/api/browser";
import { bffBinary, saveBlob } from "@/lib/api/binary";
import { isApiError } from "@/lib/api/errors";
import {
  chartExpirySchema,
  chartSalesSchema,
  chartStockSchema,
  expiredStockSchema,
  inTransitStockSchema,
  lowStockOperationalSchema,
  movementReportEnvelope,
  nearExpiryStockSchema,
  operationalStockEnvelope,
  purchaseOrdersReportEnvelope,
  salesReportEnvelope,
  salesSummarySchema,
  transfersReportEnvelope,
} from "@/lib/api/schemas/reports";
import { queryKeys } from "./keys";
import { useI18n } from "@/lib/i18n/client";
import { reportErrorText } from "@/lib/reports/report-copy";

type Query = Record<string, string | number | boolean | undefined | null>;

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation") return false;
  return failureCount < 1;
};

function reportQuery<S extends z.ZodTypeAny>(name: string, path: string, schema: S) {
  return (query: Query, enabled = true) =>
    useQuery<z.infer<S>>({
      queryKey: queryKeys.reports.view(name, query as Record<string, unknown>),
      enabled,
      queryFn: async ({ signal }) => bffJson(`/api/bff/reports/${path}`, schema, { query, signal }),
      placeholderData: keepPreviousData,
      staleTime: 20_000,
      retry: RETRY_ONCE_NOT_AUTH,
    });
}

/* -------------------------------------------------------------- reports === */

export const useOperationalStockReport = reportQuery("operational-stock", "operational-stock", operationalStockEnvelope);
export const useMovementReport = reportQuery("stock-movement", "stock-movement", movementReportEnvelope);
export const useSalesReport = reportQuery("sales", "sales", salesReportEnvelope);
export const usePurchaseOrdersReport = reportQuery("purchase-orders", "purchase-orders", purchaseOrdersReportEnvelope);
export const useTransfersReport = reportQuery("transfers", "transfers", transfersReportEnvelope);
export const useExpiredStockReport = reportQuery("expired-stock", "expired-stock", expiredStockSchema);
export const useNearExpiryReport = reportQuery("near-expiry-stock", "near-expiry-stock", nearExpiryStockSchema);
export const useInTransitReport = reportQuery("in-transit-stock", "in-transit-stock", inTransitStockSchema);
export const useLowStockOperationalReport = reportQuery("low-stock-operational", "low-stock-operational", lowStockOperationalSchema);

/* --------------------------------------------------------------- charts === */

export const useSalesSummary = reportQuery("sales-summary", "sales-summary", salesSummarySchema);
export const useSalesChart = reportQuery("chart-sales", "chart/sales", chartSalesSchema);
export const useStockChart = reportQuery("chart-stock", "chart/stock", chartStockSchema);
export const useExpiryChart = reportQuery("chart-expiry", "chart/expiry", chartExpirySchema);

/* --------------------------------------------------------------- export === */

export interface ExportState {
  running: boolean;
  run: (path: string, query?: Query) => Promise<void>;
}

/**
 * Runs a backend XLSX export through the BFF: fetch bytes → save with the
 * Content-Disposition filename → revoke the blob URL. Surfaces the 400
 * row-cap message and any Request ID.
 */
export function useReportExport(): ExportState {
  const { t, locale } = useI18n();
  const [running, setRunning] = React.useState(false);

  const run = React.useCallback(async (path: string, query?: Query) => {
    setRunning(true);
    const toastId = toast.loading(t("reports.preparingWorkbook"));
    try {
      // the workbook's column headers follow the UI language
      const params = new URLSearchParams(
        Object.entries({ ...query, lang: locale }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
      );
      const { blob, filename } = await bffBinary(`${path}?${params.toString()}`);
      saveBlob(blob, filename ?? "report.xlsx");
      toast.success(t("reports.workbookDownloaded"), { id: toastId, description: filename });
    } catch (error) {
      const msg = isApiError(error) ? reportErrorText(t, error.message, error.userMessage) : t("reports.exportFailedDot");
      const rid = isApiError(error) ? error.requestId : undefined;
      toast.error(t("reports.exportFailed"), {
        id: toastId,
        description: rid ? t("reports.requestSuffix", { message: msg, id: rid }) : msg,
      });
    } finally {
      setRunning(false);
    }
  }, [t, locale]);

  return { running, run };
}
