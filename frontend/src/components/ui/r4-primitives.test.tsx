import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { LanguageProvider } from "@/lib/i18n/client";
import { DateField } from "./date-field";
import { ExpiryBadge } from "./expiry-badge";
import { LotChip } from "./lot-chip";
import { QuantityChange, QuantityDisplay, MoneyDisplay } from "./quantity-display";
import { StepIndicator } from "./step-indicator";
import { StockTriad } from "./stock-triad";
import { Banner } from "./states";

describe("QuantityDisplay / QuantityChange / MoneyDisplay (D-R4-1)", () => {
  it("shows fixed 3 decimals exactly and keeps the raw value", () => {
    render(<QuantityDisplay value="0.001" />);
    const el = screen.getByText("0.001");
    expect(el).toHaveAttribute("data-raw", "0.001");
    expect(el).not.toHaveAttribute("data-scale-anomaly");
  });

  it("flags but never rounds a value beyond 3 decimals", () => {
    render(<QuantityDisplay value="0.0009" />);
    expect(screen.getByText("0.0009")).toHaveAttribute("data-scale-anomaly", "true");
  });

  it("signed changes", () => {
    render(
      <>
        <QuantityDisplay value="2" signed />
        <QuantityDisplay value="-0.5" signed />
      </>,
    );
    expect(screen.getByText("+2.000")).toBeInTheDocument();
    expect(screen.getByText("−0.500")).toBeInTheDocument();
  });

  it("before → after, labelled as an estimate when not authoritative", () => {
    const { container } = render(<QuantityChange before="10" after="12" estimate />);
    expect(container.textContent).toMatch(/10\.000.*12\.000.*estimate/);
  });

  it("money stays at 2 decimals", () => {
    render(<MoneyDisplay value="1.125" />);
    expect(screen.getByText("฿1.13")).toBeInTheDocument();
  });
});

describe("StockTriad", () => {
  it("labels On hand / Reserved / Available with exact values", () => {
    render(<StockTriad onHand="10" reserved="3" available="7" />);
    expect(screen.getByText("On hand").nextSibling).toHaveTextContent("10.000");
    expect(screen.getByText("Reserved").nextSibling).toHaveTextContent("3.000");
    expect(screen.getByText("Available").nextSibling).toHaveTextContent("7.000");
  });

  it("uses the frozen Thai terms and never invents a missing value", () => {
    render(
      <LanguageProvider initialLocale="th">
        <StockTriad onHand="10" reserved={null} available="7" />
      </LanguageProvider>,
    );
    expect(screen.getByText("คงเหลือจริง")).toBeInTheDocument();
    expect(screen.getByText("จองแล้ว").nextSibling).toHaveTextContent("—");
    expect(screen.getByText("พร้อมใช้")).toBeInTheDocument();
  });
});

describe("LotChip / ExpiryBadge", () => {
  it("shows the lot (mono), its expiry state with text, and the location", () => {
    render(<LotChip lot="LOT-A" daysToExpiry={-3} expiryDate="2026-01-01" location="MAIN/DEFAULT" />);
    expect(screen.getByText("LOT-A")).toHaveClass("mono");
    expect(screen.getByText("expired 3d")).toBeInTheDocument();
    expect(screen.getByText("MAIN/DEFAULT")).toBeInTheDocument();
  });

  it("a balance without a lot says so", () => {
    render(<LotChip lot={null} />);
    expect(screen.getByText("No lot")).toBeInTheDocument();
  });

  it("English expiry wording is unchanged; Thai shows the Buddhist-era date", () => {
    const { unmount } = render(<ExpiryBadge days={200} isoDate="2027-09-30" />);
    expect(screen.getByText(/exp 2027-09-30/)).toBeInTheDocument();
    unmount();
    render(
      <LanguageProvider initialLocale="th">
        <ExpiryBadge days={200} isoDate="2027-09-30" />
        <ExpiryBadge days={12} />
      </LanguageProvider>,
    );
    expect(screen.getByText(/หมดอายุ 30 ก\.ย\. 2570/)).toBeInTheDocument();
    expect(screen.getByText("เหลือ 12 วัน")).toBeInTheDocument();
  });
});

describe("StepIndicator", () => {
  it("marks the current step and offers the compact 'Step n of N' form", () => {
    render(<StepIndicator steps={["Scan", "Details", "Review", "Done"]} current={1} />);
    const list = screen.getByRole("list", { name: "Progress" });
    expect(within(list).getByText("Details").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Step 2 of 4 · Details")).toBeInTheDocument();
  });
});

describe("Banner", () => {
  it("danger is an alert, others are status; icon + title", () => {
    render(
      <>
        <Banner tone="danger" title="Rejected" />
        <Banner tone="good" title="Saved" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Rejected");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("DateField (D-R4-8)", () => {
  function Harness({ locale, onChange }: { locale: "th" | "en"; onChange: (v: string) => void }) {
    const [v, setV] = React.useState("");
    return (
      <LanguageProvider initialLocale={locale}>
        <DateField
          id="exp"
          label="Expiry date"
          value={v}
          onChange={(next) => {
            onChange(next);
            setV(next);
          }}
        />
      </LanguageProvider>
    );
  }

  it("English: keeps the Gregorian ISO value and shows it in English", () => {
    const onChange = vi.fn();
    render(<Harness locale="en" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2027-09-30" } });
    expect(onChange).toHaveBeenLastCalledWith("2027-09-30");
    expect(screen.getByText("30 Sep 2027")).toBeInTheDocument();
  });

  it("Thai: shows the Buddhist-era date and converts a typed BE year to the Gregorian ISO value", () => {
    const onChange = vi.fn();
    render(<Harness locale="th" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2570-09-30" } });
    expect(onChange).toHaveBeenLastCalledWith("2027-09-30");
    expect(screen.getByLabelText("Expiry date")).toHaveValue("2027-09-30");
    expect(screen.getByText("30 ก.ย. 2570")).toBeInTheDocument();
  });

  it("clearing the field yields an empty value (no date invented)", () => {
    const onChange = vi.fn();
    render(<Harness locale="th" onChange={onChange} />);
    const input = screen.getByLabelText("Expiry date");
    fireEvent.change(input, { target: { value: "2027-09-30" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
