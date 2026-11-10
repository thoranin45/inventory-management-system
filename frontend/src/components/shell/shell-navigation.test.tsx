import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const session = { user: { id: 1, username: "wc_admin", role: "admin", is_active: true }, logout: vi.fn() };
let pathname = "/stock-in";

vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/session-provider", () => ({ useSession: () => session }));
vi.mock("./topbar", () => ({ Topbar: () => <header /> }));
vi.mock("./sidebar-search", () => ({ SidebarSearch: () => null }));

import { LanguageProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { AppShell } from "./app-shell";
import { Breadcrumbs } from "./breadcrumbs";

function renderShell(locale: Locale = "en") {
  return render(
    <LanguageProvider initialLocale={locale}>
      <AppShell>
        <h1>Page</h1>
      </AppShell>
    </LanguageProvider>,
  );
}

/** jsdom ignores media queries, so every navigation surface is in the DOM; pick by landmark. */
const rail = () => document.querySelector(".wc-rail-slot nav") as HTMLElement;

beforeEach(() => {
  pathname = "/stock-in";
  session.user.role = "admin";
});

describe("iPad icon rail", () => {
  it("every item has an accessible name and tooltip; the current page is marked", () => {
    renderShell("th");
    const nav = within(rail());
    const stockIn = nav.getByRole("link", { name: "รับสินค้าเข้า" });
    expect(stockIn).toHaveAttribute("href", "/stock-in");
    expect(stockIn).toHaveAttribute("title", "รับสินค้าเข้า");
    expect(stockIn).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "แดชบอร์ด" })).not.toHaveAttribute("aria-current");
    for (const link of nav.getAllByRole("link")) {
      expect(link.getAttribute("aria-label")).toBeTruthy();
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden");
    }
  });

  it("warehouse users never see admin-only items in the rail", () => {
    session.user.role = "warehouse";
    renderShell();
    const nav = within(rail());
    expect(nav.queryByRole("link", { name: "Approvals" })).toBeNull();
    expect(nav.queryByRole("link", { name: "Audit" })).toBeNull();
    expect(nav.getByRole("link", { name: "Reports" })).toBeInTheDocument();
  });

  it("the expand item opens the full labelled menu (focus moves in, Esc returns focus)", async () => {
    const user = userEvent.setup();
    renderShell();
    const expand = within(rail()).getByRole("button", { name: "Open full menu" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.click(expand);
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("link", { name: "Stock In" })).toBeInTheDocument();
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(expand).toHaveFocus();
  });
});

describe("phone bottom bar and More sheet", () => {
  it("shows Home, Tasks, Stock, Orders, More with the current tab marked", () => {
    renderShell("th");
    const bar = within(screen.getByRole("navigation", { name: "เมนูมือถือ" }));
    expect(bar.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["หน้าหลัก", "/dashboard"],
      ["งาน", "/stock-in"],
      ["สต็อก", "/stock"],
      ["ใบสั่ง", "/picking"],
    ]);
    expect(bar.getByRole("link", { name: "งาน" })).toHaveAttribute("aria-current", "page");
    expect(bar.getByRole("button", { name: "เมนูเพิ่มเติม" })).toHaveAttribute("aria-expanded", "false");
  });

  it("More opens a grouped sheet that traps focus, closes on Esc and returns focus", async () => {
    const user = userEvent.setup();
    renderShell();
    const more = within(screen.getByRole("navigation", { name: "Mobile" })).getByRole("button", { name: "More navigation" });
    await user.click(more);
    const sheet = await screen.findByRole("dialog", { name: "More navigation" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    // grouped: one labelled region per section, tiles link to existing routes
    expect(within(sheet).getByRole("region", { name: "Master data" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/customers");
    expect(within(sheet).getByRole("link", { name: "Stock In" })).toHaveAttribute("aria-current", "page");
    // focus trap: tabbing many times never leaves the sheet
    for (let i = 0; i < 30; i += 1) {
      await user.tab();
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(more).toHaveFocus();
  });

  it("warehouse users never see admin-only items in the More sheet", async () => {
    session.user.role = "warehouse";
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "More navigation" }));
    const sheet = await screen.findByRole("dialog", { name: "More navigation" });
    expect(within(sheet).queryByRole("link", { name: "Approvals" })).toBeNull();
    expect(within(sheet).queryByRole("link", { name: "Audit" })).toBeNull();
  });
});

describe("Breadcrumbs", () => {
  it("shows section › page from the route registry, in the active language", () => {
    pathname = "/stock-out";
    render(
      <LanguageProvider initialLocale="th">
        <Breadcrumbs />
      </LanguageProvider>,
    );
    const crumbs = screen.getByRole("navigation", { name: "เส้นทางนำทาง" });
    expect(crumbs).toHaveTextContent("งานคลังสินค้า");
    expect(within(crumbs).getByText("เบิกสินค้าออก")).toHaveAttribute("aria-current", "page");
  });

  it("links the parent page on nested routes", () => {
    pathname = "/purchase-orders/7/receive";
    render(<Breadcrumbs />);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Purchase Orders" })).toHaveAttribute("href", "/purchase-orders");
    expect(within(crumbs).getByText("Receive")).toHaveAttribute("aria-current", "page");
    expect(crumbs.textContent).not.toContain("7"); // ids are never displayed
  });

  it("renders nothing for routes outside the registry", () => {
    pathname = "/somewhere-else";
    const { container } = render(<Breadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });
});
