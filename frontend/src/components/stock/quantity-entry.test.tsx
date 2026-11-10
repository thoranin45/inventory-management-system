import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { LanguageProvider } from "@/lib/i18n/client";
import type { AttemptRecord, EntryMode } from "@/lib/workflow/quantity-entry";
import { AbandonAttemptDialog, EntryModeSelector, TypedQuantityField } from "./quantity-entry";

function Field({ start = "", clock, readOnly }: { start?: string; clock?: () => number; readOnly?: boolean }) {
  const [v, setV] = React.useState(start);
  return <TypedQuantityField id="q" label="Quantity" value={v} onChange={setV} now={clock} readOnly={readOnly} />;
}

/** a controllable clock: each read advances by `step` ms */
const ticking = (step: number) => {
  let t = 0;
  return () => (t += step);
};

describe("TypedQuantityField — scanner isolation (defence in depth)", () => {
  it("keys arriving faster than a person types are rejected and rolled back", async () => {
    const user = userEvent.setup();
    render(<Field clock={ticking(5)} />);
    await user.click(screen.getByLabelText("Quantity"));
    await user.keyboard("885000000009");
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(screen.getByText(/looked like barcode scanner input/i)).toBeInTheDocument();
  });

  it("a burst after a typed value restores that value, not an empty field", async () => {
    const user = userEvent.setup();
    let t = 0;
    const clock = () => t;
    render(<Field start="2" clock={clock} />);
    const input = screen.getByLabelText("Quantity");
    await user.click(input);
    t = 10_000;
    await user.keyboard("8"); // a lone key: normal
    for (const ch of "85000000009") {
      t += 4;
      await user.keyboard(ch);
    }
    expect(input).toHaveValue("2");
  });

  it("deliberate typing (keys well apart) is accepted", async () => {
    const user = userEvent.setup();
    render(<Field clock={ticking(120)} />);
    await user.click(screen.getByLabelText("Quantity"));
    await user.keyboard("12.5");
    expect(screen.getByLabelText("Quantity")).toHaveValue("12.5");
    expect(screen.queryByText(/looked like barcode scanner input/i)).toBeNull();
  });

  it("two quick keys (key rollover) are not a burst", async () => {
    const user = userEvent.setup();
    let t = 0;
    render(<Field clock={() => t} />);
    await user.click(screen.getByLabelText("Quantity"));
    t = 1000;
    await user.keyboard("1");
    t = 1010;
    await user.keyboard("2");
    t = 2000;
    await user.keyboard(".");
    t = 3000;
    await user.keyboard("5");
    expect(screen.getByLabelText("Quantity")).toHaveValue("12.5");
  });

  it("paste and mobile/IME input (no per-key events) are accepted", async () => {
    const user = userEvent.setup();
    render(<Field clock={ticking(1)} />);
    await user.click(screen.getByLabelText("Quantity"));
    await user.paste("7.25");
    expect(screen.getByLabelText("Quantity")).toHaveValue("7.25");
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "8" } });
    expect(screen.getByLabelText("Quantity")).toHaveValue("8");
  });

  it("Enter is always swallowed (never submits a form or opens Review)", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Field />
      </form>,
    );
    const notPrevented = fireEvent.keyDown(screen.getByLabelText("Quantity"), { key: "Enter" });
    expect(notPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TypedQuantityField — validation feedback and stepper", () => {
  it.each([
    ["", /up to 3 decimal places/i],
    ["1.", /up to 3 decimal places/i],
    ["0", /above zero/i],
    ["1.2345", /at most 3 decimal places/i],
    ["1e3", /enter a quantity with up to 3 decimal places/i],
  ])("%j shows %s", (start, text) => {
    render(<Field start={start} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("a valid value shows the canonical form it will be recorded as, and is not marked invalid", () => {
    render(<Field start="1.25" />);
    const input = screen.getByLabelText("Quantity");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText(/will be recorded as/i).textContent).toMatch(/1\.250/);
  });

  it("invalid values are marked aria-invalid and described", () => {
    render(<Field start="1.2345" />);
    const input = screen.getByLabelText("Quantity");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/at most 3 decimal places/i);
  });

  it("± is exact and disabled where the result would not be positive", async () => {
    const user = userEvent.setup();
    render(<Field start="1.250" />);
    await user.click(screen.getByRole("button", { name: "Increase by 1" }));
    expect(screen.getByLabelText("Quantity")).toHaveValue("2.250");
    await user.click(screen.getByRole("button", { name: "Decrease by 1" }));
    await user.click(screen.getByRole("button", { name: "Decrease by 1" }));
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.250");
    expect(screen.getByRole("button", { name: "Decrease by 1" })).toBeDisabled();
  });

  it("read-only (pending or locked) blocks typing and the stepper", async () => {
    const user = userEvent.setup();
    render(<Field start="3" readOnly />);
    await user.type(screen.getByLabelText("Quantity"), "9");
    expect(screen.getByLabelText("Quantity")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Increase by 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease by 1" })).toBeDisabled();
  });
});

describe("EntryModeSelector", () => {
  function Selector({ disabled }: { disabled?: boolean }) {
    const [mode, setMode] = React.useState<EntryMode>("scan");
    return <EntryModeSelector mode={mode} onChange={setMode} disabled={disabled} lockedNote="Locked for now" />;
  }

  it("is a labelled radio group; arrow keys move the choice", async () => {
    const user = userEvent.setup();
    render(<Selector />);
    const group = screen.getByRole("radiogroup", { name: "Quantity entry" });
    expect(within(group).getByRole("radio", { name: /scan count/i })).toHaveAttribute("aria-checked", "true");
    within(group).getByRole("radio", { name: /scan count/i }).focus();
    await user.keyboard("{ArrowRight}");
    const typed = within(group).getByRole("radio", { name: /enter quantity/i });
    expect(typed).toHaveAttribute("aria-checked", "true");
    expect(typed).toHaveFocus();
  });

  it("when disabled, neither option can be chosen and the reason is announced", async () => {
    const user = userEvent.setup();
    render(<Selector disabled />);
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAccessibleDescription("Locked for now");
    await user.click(within(group).getByRole("radio", { name: /enter quantity/i }));
    expect(within(group).getByRole("radio", { name: /scan count/i })).toHaveAttribute("aria-checked", "true");
  });

  it("is translated", () => {
    render(
      <LanguageProvider initialLocale="th">
        <Selector />
      </LanguageProvider>,
    );
    expect(screen.getByRole("radio", { name: /นับจากการสแกน/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /กรอกจำนวน/ })).toBeInTheDocument();
  });
});

describe("AbandonAttemptDialog", () => {
  const attempt: AttemptRecord<unknown> = {
    v: 1,
    draftId: "d",
    idempotencyKey: "k",
    mode: "typed",
    quantity: "1.250",
    body: {},
    status: "uncertain",
    priorUncertain: false,
    at: "2026-10-18T03:00:00.000Z",
    lastError: { status: 503, message: "down", requestId: "req-9" },
  };

  it("states the risks, shows what is known, and links to the product's movement history", () => {
    render(<AbandonAttemptDialog open onOpenChange={vi.fn()} attempt={attempt} productId={5} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Abandon this session?" });
    expect(within(dialog).getByText(/may already have been recorded/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not cancel or reverse anything/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/duplicate stock movement/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/check this product's movement history/i)).toBeInTheDocument();
    expect(within(dialog).getByText("2026-10-18 10:00")).toBeInTheDocument(); // Bangkok business time
    expect(within(dialog).getByText(/req-9/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /check movement history/i })).toHaveAttribute("href", "/inventory/ledger?product_id=5");
  });

  it("without a product there is no ledger link; no response is said plainly", () => {
    render(
      <AbandonAttemptDialog open onOpenChange={vi.fn()} attempt={{ ...attempt, lastError: null }} productId={null} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("No response received")).toBeInTheDocument();
  });

  it("only the explicit button abandons", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<AbandonAttemptDialog open onOpenChange={onOpenChange} attempt={attempt} productId={5} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Keep and retry later" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Abandon and start a new session" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
