import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LanguageProvider } from "@/lib/i18n/client";
import { ReviewSheet } from "./review-sheet";

function Harness({ pending = false, onConfirm = vi.fn() }: { pending?: boolean; onConfirm?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const opener = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Review
      </button>
      <ReviewSheet
        open={open}
        onOpenChange={setOpen}
        title="Confirm stock in"
        description="Check the details"
        confirmLabel="Confirm +2.000"
        onConfirm={onConfirm}
        pending={pending}
        returnFocusRef={opener}
      >
        <p>summary</p>
      </ReviewSheet>
    </>
  );
}

describe("ReviewSheet", () => {
  it("opening confirms nothing, focuses the heading (not Confirm) and shows the send-once note", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Review" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm stock in" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirm stock in" })).toHaveFocus();
    expect(screen.getByText(/retrying reuses the same request key/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a scanner's trailing Enter right after opening does not confirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.keyboard("885000000009{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Confirm is an explicit action: click or keyboard on the focused button, once per activation", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Confirm +2.000" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "Confirm +2.000" }).focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("Back to edit and Escape close it and return focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Review" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("traps focus inside while open", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Review" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("while pending: Confirm and Back are disabled and Escape does not close", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Review" }));
    rerender(<Harness pending />);
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to edit" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is translated", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLocale="th">
        <Harness />
      </LanguageProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("button", { name: "กลับไปแก้ไข" })).toBeInTheDocument();
    expect(screen.getByText(/ส่งเพียงครั้งเดียว/)).toBeInTheDocument();
  });
});
