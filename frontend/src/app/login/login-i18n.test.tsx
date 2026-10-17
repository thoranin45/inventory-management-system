import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { LoginForm } from "./login-form";
import { LoginIntro } from "./login-intro";

function renderLogin() {
  return render(
    <LanguageProvider initialLocale="th">
      <LanguageSwitch />
      <LoginIntro expired />
      <LoginForm next="/dashboard" />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
});

describe("Login localization (R2.2 / D6)", () => {
  it("renders Thai by default with a compact language switch", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "เข้าสู่ระบบ" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("เซสชันหมดอายุแล้ว");
    expect(screen.getByLabelText("ชื่อผู้ใช้")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "ภาษา" })).toBeInTheDocument();
  });

  it("switching language keeps the typed username and password", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "wc_admin");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "not-a-real-secret");
    await user.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByLabelText("Username")).toHaveValue("wc_admin");
    expect(screen.getByLabelText("Password")).toHaveValue("not-a-real-secret");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("validation messages are translated", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    await waitFor(() => expect(screen.getByText("กรุณากรอกชื่อผู้ใช้")).toBeInTheDocument());
    expect(screen.getByText("กรุณากรอกรหัสผ่าน")).toBeInTheDocument();
  });

  it("the login fields restore a solid outline on keyboard focus (Tailwind 4 outline-style variable)", () => {
    renderLogin();
    const cls = screen.getByLabelText("ชื่อผู้ใช้").className;
    expect(cls).toContain("focus-visible:outline-2");
    // outline-hidden / outline-none set --tw-outline-style: none, which
    // focus-visible:outline-2 inherits; the solid style must be restored
    expect(cls).toContain("focus-visible:outline-solid");
  });
});
