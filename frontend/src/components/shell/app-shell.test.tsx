import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("./topbar", () => ({ Topbar: () => <header><button type="button">Open navigation</button></header> }));
vi.mock("./sidebar", () => ({ SidebarNav: () => <nav aria-label="Primary" /> }));
vi.mock("./mobile-bottom-nav", () => ({ MobileBottomNav: () => null }));
vi.mock("./icon-rail", () => ({ IconRail: () => null }));
vi.mock("./more-sheet", () => ({ MoreSheet: () => null }));

import { AppShell } from "./app-shell";

describe("AppShell — Concept B bypass link", () => {
  it("the first tab stop is a skip link to the main content", async () => {
    render(
      <AppShell>
        <h1>Page</h1>
      </AppShell>,
    );
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#content");
    await userEvent.tab();
    expect(skip).toHaveFocus();
  });

  it("the skip target is the focusable main landmark", () => {
    render(
      <AppShell>
        <h1>Page</h1>
      </AppShell>,
    );
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
