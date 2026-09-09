import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

let role = "admin";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const useAuditLogs = vi.fn();
vi.mock("@/lib/query/audit", () => ({ useAuditLogs: (...a: unknown[]) => useAuditLogs(...a) }));

import { AuditView } from "./audit-view";

const ROWS = [
  { id: 3, username: "wc_admin", action: "SHIP_SALES_ORDER", table_name: "sales_orders", record_id: 63, description: "SO-000063 shipped", created_at: "2026-09-09T10:00:00" },
  { id: 2, username: "wc_wh", action: "SCAN_PICK", table_name: "sales_orders", record_id: 62, description: "Allocation 12; increment 1", created_at: "2026-09-09T09:00:00" },
  { id: 1, username: "wc_admin", action: "CREATE_PRODUCT", table_name: "products", record_id: 5, description: "Create Product: WH-X", created_at: "2026-09-08T08:00:00" },
];

beforeEach(() => {
  role = "admin";
  useAuditLogs.mockReset().mockReturnValue({ data: ROWS, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
});

describe("AuditView", () => {
  it("renders the real (unpaginated) contract for an admin and says so", () => {
    render(<AuditView />);
    expect(screen.getByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.getByText(/no server paging/i)).toBeInTheDocument();
    expect(screen.getByText("Ship sales order")).toBeInTheDocument();
    expect(screen.getByText("SO-000063 shipped")).toBeInTheDocument();
    expect(useAuditLogs).toHaveBeenCalledWith(true);
  });

  it("shows only the seven non-sensitive columns — no password/token/JWT/authorization anywhere", () => {
    render(<AuditView />);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.toLowerCase() ?? "");
    for (const h of heads) expect(h).not.toMatch(/pass|hash|token|jwt|authorization|secret/);
    expect(screen.queryByText(/password|hash|bearer|jwt/i)).not.toBeInTheDocument();
  });

  it("hides everything from a warehouse user and does not call the endpoint", () => {
    role = "warehouse";
    render(<AuditView />);
    expect(screen.getByText(/admins only/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(useAuditLogs).toHaveBeenCalledWith(false); // query disabled
  });

  it("surfaces an error with its Request ID and a retry", async () => {
    const refetch = vi.fn();
    useAuditLogs.mockReturnValue({
      data: undefined, isLoading: false, isFetching: false, isError: true,
      error: new ApiError({ status: 500, message: "boom", requestId: "req-audit-500" }), refetch,
    });
    render(<AuditView />);
    expect(screen.getByText("req-audit-500")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("filters rows page-locally by the search box", async () => {
    render(<AuditView />);
    await userEvent.type(screen.getByLabelText(/search audit log/i), "product");
    await waitFor(() => expect(screen.queryByText("Ship sales order")).not.toBeInTheDocument());
    expect(screen.getByText("Create product")).toBeInTheDocument();
  });
});
