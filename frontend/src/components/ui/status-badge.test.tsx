import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/lib/i18n/client";
import { CANONICAL_STATUS } from "@/lib/status";
import { StatusBadge } from "./status-badge";

const th = (ui: React.ReactNode) => render(<LanguageProvider initialLocale="th">{ui}</LanguageProvider>);

describe("StatusBadge (R2.6 filled chips)", () => {
  it.each([
    ["CONFIRMED", "ยืนยันแล้ว"],
    ["PARTIALLY_RECEIVED", "รับเข้าบางส่วน"],
    ["RECEIVED", "รับเข้าแล้ว"],
    ["CANCELLED", "ยกเลิกแล้ว"],
    ["active", "ใช้งาน"],
    ["inactive", "ไม่ใช้งาน"],
  ])("D8: %s is %s in Thai", (status, label) => {
    th(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("keeps the pre-R2 tone for every canonical status (API values unchanged)", () => {
    const tones = Object.fromEntries(Object.entries(CANONICAL_STATUS).map(([k, v]) => [k, v.tone]));
    expect(tones).toEqual({
      DRAFT: "neutral", CONFIRMED: "info", PICKING: "info", PACKING: "info", READY_TO_SHIP: "accent",
      IN_TRANSIT: "accent", SHIPPED: "success", PARTIALLY_RECEIVED: "warning", RECEIVED: "success",
      COMPLETED: "success", CANCELLED: "danger", PENDING: "neutral", APPROVED: "neutral", REJECTED: "neutral",
      active: "success", inactive: "neutral",
    });
  });

  it("always renders an icon and text — never colour alone", () => {
    for (const status of Object.keys(CANONICAL_STATUS)) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.querySelector("svg[aria-hidden]"), status).not.toBeNull();
      expect(chip.textContent?.trim(), status).not.toBe("");
      expect(chip).not.toHaveAttribute("data-status-unmapped");
      unmount();
    }
  });

  it("English labels without a provider match the previous wording", () => {
    render(<StatusBadge status="READY_TO_SHIP" />);
    expect(screen.getByText("Ready to ship")).toHaveAttribute("data-tone", "accent");
  });

  it("matches the exact API value only; unknown values stay visible, neutral and flagged", () => {
    const { container } = render(<StatusBadge status="ON_HOLD" />);
    const chip = container.firstElementChild!;
    expect(chip).toHaveTextContent("on hold");
    expect(chip).toHaveAttribute("data-tone", "neutral");
    expect(chip).toHaveAttribute("data-status-unmapped");
    // case matters: "confirmed" is not the canonical CONFIRMED
    const lower = render(<StatusBadge status="confirmed" />).container.firstElementChild!;
    expect(lower).toHaveAttribute("data-status-unmapped");
  });

  it("caller label and tone overrides still win", () => {
    th(<StatusBadge status="IN_TRANSIT" tone="warning" label="Attention" />);
    expect(screen.getByText("Attention")).toHaveAttribute("data-tone", "warning");
  });
});
