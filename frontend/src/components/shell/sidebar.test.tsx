import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { NAV_GROUPS, NAV_ITEMS } from "@/lib/nav";

const session = { user: { id: 1, username: "wc_admin", role: "admin", is_active: true } };
let pathname = "/dashboard";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/components/session-provider", () => ({ useSession: () => session }));
vi.mock("./sidebar-search", () => ({ SidebarSearch: () => null }));

import { SidebarNav } from "./sidebar";

beforeEach(() => {
  pathname = "/dashboard";
  session.user.role = "admin";
});

describe("Concept B navigation model", () => {
  it("keeps every destination exactly as before (grouping is presentation only)", () => {
    expect(NAV_ITEMS.map((n) => n.href)).toEqual([
      "/dashboard", "/products", "/categories", "/stock", "/inventory/ledger", "/stock-in", "/stock-out",
      "/stock-adjustments/mine", "/stock-adjustments/approvals", "/sales", "/picking", "/packing", "/shipping",
      "/purchase-orders", "/transfers", "/customers", "/suppliers", "/reports", "/audit",
    ]);
    expect(NAV_ITEMS.filter((n) => n.adminOnly).map((n) => n.key)).toEqual(["stock-adjustment-approvals", "audit"]);
  });

  it("assigns every item to one of the six frozen sections", () => {
    const groups = new Set(NAV_GROUPS.map((g) => g.key));
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      "Overview", "Warehouse tasks", "Inventory", "Orders", "Reports & audit", "Master data",
    ]);
    for (const n of NAV_ITEMS) expect(groups.has(n.group), n.key).toBe(true);
  });
});

describe("SidebarNav — grouped sections", () => {
  it("admin: six labelled groups in order, every item once, admin-only items present", () => {
    render(<SidebarNav />);
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent))
      .toEqual(NAV_GROUPS.map((g) => g.label));
    for (const n of NAV_ITEMS) {
      const group = screen.getByRole("group", { name: NAV_GROUPS.find((g) => g.key === n.group)!.label });
      expect(within(group).getByRole("link", { name: n.label })).toHaveAttribute("href", n.href);
    }
  });

  it("warehouse: Approvals and Audit are not rendered anywhere in the sidebar", () => {
    session.user.role = "warehouse";
    render(<SidebarNav />);
    expect(screen.queryByRole("link", { name: "Approvals" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Audit" })).toBeNull();
    // the section stays because Reports is visible to warehouse staff
    expect(within(screen.getByRole("group", { name: "Reports & audit" })).getByRole("link", { name: "Reports" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(6);
  });

  it("marks the current page with aria-current", () => {
    pathname = "/stock-adjustments/mine/42";
    render(<SidebarNav />);
    expect(screen.getByRole("link", { name: "Stock Adjustments" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("gives each rendered copy of the sidebar its own heading ids", () => {
    render(
      <>
        <SidebarNav />
        <SidebarNav />
      </>,
    );
    const ids = screen.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
