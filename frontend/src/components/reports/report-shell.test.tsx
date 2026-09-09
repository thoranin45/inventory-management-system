import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const run = vi.fn();
vi.mock("@/lib/query/reports", () => ({ useReportExport: () => ({ running: false, run }) }));

import { ReportShell } from "./report-shell";

const baseQuery = { isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn() };

describe("ReportShell", () => {
  it("renders the registry title/blurb + a back-to-Reports link", () => {
    render(
      <ReportShell slug="sales" query={baseQuery} isEmpty={false} emptyMessage="none">
        <div>body</div>
      </ReportShell>,
    );
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reports/i }).getAttribute("href")).toBe("/reports");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("shows LoadingState while loading", () => {
    render(
      <ReportShell slug="sales" query={{ ...baseQuery, isLoading: true }} isEmpty={false} emptyMessage="none">
        <div>body</div>
      </ReportShell>,
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("shows the report-specific empty state", () => {
    render(
      <ReportShell slug="expired" query={baseQuery} isEmpty emptyMessage="No expired stock for the selected filters.">
        <div>body</div>
      </ReportShell>,
    );
    expect(screen.getByText("No expired stock for the selected filters.")).toBeInTheDocument();
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("surfaces an error with its Request ID and a Retry", async () => {
    const refetch = vi.fn();
    render(
      <ReportShell
        slug="sales"
        query={{ ...baseQuery, isError: true, error: new ApiError({ status: 500, message: "boom", requestId: "req-rep-500" }), refetch }}
        isEmpty={false}
        emptyMessage="none"
      >
        <div>body</div>
      </ReportShell>,
    );
    expect(screen.getByText("req-rep-500")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders an Export button that calls the export runner with the given query", async () => {
    render(
      <ReportShell
        slug="near-expiry"
        query={baseQuery}
        isEmpty={false}
        emptyMessage="none"
        exportPath="/api/bff/reports/export/expiring"
        exportQuery={{ days: 30 }}
      >
        <div>body</div>
      </ReportShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /export .xlsx/i }));
    expect(run).toHaveBeenCalledWith("/api/bff/reports/export/expiring", { days: 30 });
  });
});
