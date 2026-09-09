import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const run = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/query/reports", () => ({ useReportExport: () => ({ running: false, run }) }));

import { ReportsLanding } from "./reports-landing";

beforeEach(() => run.mockClear());

describe("ReportsLanding", () => {
  it("groups report cards under Inventory / Orders / Exports", () => {
    render(<ReportsLanding />);
    expect(screen.getByRole("heading", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Exports" })).toBeInTheDocument();
  });

  it("links every report to its /reports/<slug> route", () => {
    render(<ReportsLanding />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const href of [
      "/reports/operational-stock",
      "/reports/expired",
      "/reports/near-expiry",
      "/reports/in-transit",
      "/reports/low-stock",
      "/reports/movements",
      "/reports/sales",
      "/reports/purchase-orders",
      "/reports/transfers",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("shows the four export cards and downloads through the BFF export path", async () => {
    render(<ReportsLanding />);
    expect(screen.getByText("Stock workbook")).toBeInTheDocument();
    expect(screen.getByText("Expiring workbook")).toBeInTheDocument();
    const stockBtn = screen.getAllByRole("button", { name: /download .xlsx/i })[0];
    await userEvent.click(stockBtn);
    await waitFor(() => expect(run).toHaveBeenCalledWith("/api/bff/reports/export/stock", undefined));
  });

  it("passes the threshold param on the low-stock export", async () => {
    render(<ReportsLanding />);
    const card = screen.getByText("Low stock workbook").closest("div") as HTMLElement;
    const thr = screen.getByLabelText("Low stock workbook — Threshold");
    await userEvent.clear(thr);
    await userEvent.type(thr, "25");
    await userEvent.click(within(card).getByRole("button", { name: /download .xlsx/i }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("/api/bff/reports/export/low-stock", { threshold: "25" }));
  });
});
