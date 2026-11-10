import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const session = { user: { id: 1, username: "u", role: "admin", is_active: true } };
const push = vi.fn();
const search = { data: undefined as unknown, isFetching: false, isError: false };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/session-provider", () => ({ useSession: () => session }));
vi.mock("@/lib/query/hooks", () => ({ useGlobalSearch: () => search }));

// cmdk measures its list; jsdom has no ResizeObserver / scrollIntoView
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView ??= () => {};

import { LanguageProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { CommandPaletteProvider, useCommandPalette } from "./command-palette";

function Opener() {
  const { openPalette } = useCommandPalette();
  return <button type="button" onClick={openPalette}>open</button>;
}

async function openPalette(locale: Locale = "en") {
  render(
    <LanguageProvider initialLocale={locale}>
      <CommandPaletteProvider>
        <Opener />
      </CommandPaletteProvider>
    </LanguageProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "open" }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  session.user.role = "admin";
  search.data = undefined;
  push.mockClear();
});

describe("CommandPalette (R2.3)", () => {
  it("admin sees admin-only destinations", async () => {
    const dialog = await openPalette();
    expect(within(dialog).getByRole("option", { name: /Approvals/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Audit/ })).toBeInTheDocument();
  });

  it("warehouse users never see admin-only destinations", async () => {
    session.user.role = "warehouse";
    const dialog = await openPalette();
    expect(within(dialog).queryByRole("option", { name: /Approvals/ })).toBeNull();
    expect(within(dialog).queryByRole("option", { name: /Audit/ })).toBeNull();
    expect(within(dialog).getByRole("option", { name: /Stock In/ })).toBeInTheDocument();
  });

  it("is localized: placeholder, group heading and items", async () => {
    const dialog = await openPalette("th");
    expect(within(dialog).getByPlaceholderText("ค้นหาสินค้า ใบสั่ง หรือล็อต…")).toBeInTheDocument();
    expect(within(dialog).getByText("ไปที่")).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /รับสินค้าเข้า/ })).toBeInTheDocument();
  });

  it("translates result types and canonical statuses, leaves document labels untouched", async () => {
    search.data = {
      results: [{ type: "sales_order", id: 5, label: "SO-000005", sublabel: "Acme", status: "READY_TO_SHIP" }],
      truncated: false,
    };
    const dialog = await openPalette("th");
    await userEvent.type(within(dialog).getByRole("combobox"), "SO-0");
    expect(within(dialog).getByText("ใบสั่งขาย")).toBeInTheDocument();
    expect(within(dialog).getByText("SO-000005")).toBeInTheDocument();
    expect(within(dialog).getByText("Acme · พร้อมส่ง")).toBeInTheDocument();
  });
});
