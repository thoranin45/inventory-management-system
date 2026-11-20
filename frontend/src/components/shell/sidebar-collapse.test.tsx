import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("./topbar", () => ({ Topbar: () => <header /> }));
vi.mock("./sidebar", () => ({
  SidebarNav: ({ onCollapse }: { onCollapse?: () => void }) =>
    onCollapse ? (
      <button type="button" onClick={onCollapse}>
        Collapse menu
      </button>
    ) : null,
}));
vi.mock("./icon-rail", () => ({
  IconRail: ({ onExpand }: { onExpand: () => void }) => (
    <button type="button" onClick={onExpand}>
      Open full menu
    </button>
  ),
}));
vi.mock("./mobile-bottom-nav", () => ({ MobileBottomNav: () => null }));
vi.mock("./more-sheet", () => ({ MoreSheet: () => null }));

import { AppShell } from "./app-shell";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AppShell — collapsible desktop sidebar", () => {
  it("collapses to the icon rail, remembers it, and the rail brings the menu back on desktop", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1024px"), media: q }));
    const { container } = render(
      <AppShell>
        <h1>Page</h1>
      </AppShell>,
    );
    const app = container.querySelector(".wc-app")!;
    expect(app).not.toHaveAttribute("data-sidebar");

    await userEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    expect(app).toHaveAttribute("data-sidebar", "collapsed");
    expect(window.localStorage.getItem("akk_sidebar")).toBe("collapsed");

    await userEvent.click(screen.getByRole("button", { name: "Open full menu" }));
    expect(app).not.toHaveAttribute("data-sidebar");
    expect(window.localStorage.getItem("akk_sidebar")).toBeNull();
  });
});
