import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push, replace: vi.fn() }), usePathname: () => "/stock-in" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// A real business form for the state-safety regression: the Sales Return drawer
// with its V1-H1 per-intent Idempotency-Key. Its mutation is a spy, so any
// business request triggered by a language switch would be visible.
const retMut = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("@/lib/query/sales", () => ({
  useSalesOrder: () => ({
    data: {
      id: 63, so_number: "SO-000063", customer_id: 8, status: "SHIPPED", total_amount: "5.00", created_at: "2026-09-08T18:00:00",
      items: [{ id: 98, sales_order_id: 63, product_id: 6, quantity: "5", unit_price: "1", total_price: "5", batch_allocations: [], fulfillment_allocations: [] }],
      picked_at: null, picked_by_user_id: null, packed_at: null, packed_by_user_id: null,
      shipped_at: "2026-09-08T18:05:00", shipped_by_user_id: 2, shipment_number: "SHIP-000063",
    },
    isLoading: false,
    isError: false,
  }),
  useReturnSalesOrder: () => retMut,
  useProductLookup: () => ({ data: { 6: { id: 6, sku: "WH-TEA-200G", product_name: "Green Tea 200g" } } }),
}));

import { LanguageProvider, useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { LanguageSwitch } from "./language-switch";
import { ReturnDrawer } from "@/components/sales/return-form";
import { ApiError } from "@/lib/api/errors";

let fetchMock: ReturnType<typeof vi.fn>;

/** A stand-in for a work screen: a draft, an idempotency key, an open dialog. */
function WorkScreen() {
  const t = useT();
  const [draft, setDraft] = React.useState("");
  // created once per mount, exactly like the receive/return forms' keys
  const [idempotencyKey] = React.useState(() => `key-${Math.random().toString(36).slice(2)}`);
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <label htmlFor="qty">{t("nav.stockIn")}</label>
      <input id="qty" value={draft} onChange={(e) => setDraft(e.currentTarget.value)} />
      <output data-testid="key">{idempotencyKey}</output>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        {/* outside clicks are ignored so the test isolates the switch itself:
            in the app a modal's overlay keeps the header out of reach anyway */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title>{t("common.close")}</DialogPrimitive.Title>
          <textarea aria-label="note" defaultValue="" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
    </div>
  );
}

function setup(initial: Locale = "th") {
  return render(
    <LanguageProvider initialLocale={initial}>
      <LanguageSwitch />
      <WorkScreen />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  document.documentElement.lang = "th";
  refresh.mockClear();
  push.mockClear();
  toast.success.mockClear();
  toast.warning.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("LanguageSwitch", () => {
  it("is a labelled group of two toggle buttons reflecting the server-rendered locale", () => {
    setup("th");
    const group = screen.getByRole("group", { name: "ภาษา" });
    const th = screen.getByRole("button", { name: "ไทย" });
    const en = screen.getByRole("button", { name: "EN" });
    expect(group).toContainElement(th);
    expect(th).toHaveAttribute("aria-pressed", "true");
    expect(th).toHaveAttribute("lang", "th");
    expect(en).toHaveAttribute("aria-pressed", "false");
    expect(en).toHaveAttribute("lang", "en");
    expect(screen.getByLabelText("รับสินค้าเข้า")).toBeInTheDocument();
  });

  it("switches text and <html lang> immediately, persists once, never refreshes the route", async () => {
    setup("th");
    await userEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByLabelText("Stock In")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Language changed to English"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/prefs/language", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ locale: "en" }),
    }));
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("choosing the current language does nothing (no request)", async () => {
    setup("th");
    await userEvent.click(screen.getByRole("button", { name: "ไทย" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("preserves typed drafts, idempotency keys, open dialogs and focus across switches", async () => {
    const user = userEvent.setup();
    setup("th");
    const input = screen.getByRole("textbox", { name: "รับสินค้าเข้า" });
    await user.type(input, "12");
    const note = screen.getByRole("textbox", { name: "note" });
    await user.type(note, "ด่วน");
    const key = screen.getByTestId("key").textContent;
    const enButton = screen.getByRole("button", { name: "EN" });

    await user.click(enButton);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Stock In" })).toHaveValue("12");
    expect(screen.getByRole("textbox", { name: "note" })).toHaveValue("ด่วน");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("key").textContent).toBe(key);
    expect(enButton).toHaveFocus(); // same element, not remounted

    await user.click(screen.getByRole("button", { name: "ไทย" }));
    expect(screen.getByRole("textbox", { name: "รับสินค้าเข้า" })).toHaveValue("12");
    expect(screen.getByTestId("key").textContent).toBe(key);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("if saving the preference fails, the language still changes, input is kept and a warning is announced", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    setup("th");
    await user.type(screen.getByRole("textbox", { name: "รับสินค้าเข้า" }), "7");
    await user.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      "The language changed, but it could not be saved for your next visit.",
    ));
    expect(screen.getByRole("textbox", { name: "Stock In" })).toHaveValue("7");
    expect(document.documentElement.lang).toBe("en");
  });

  it("a non-2xx save is reported as not saved", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    setup("en");
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "ไทย" }));
    });
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      "เปลี่ยนภาษาแล้ว แต่บันทึกค่าสำหรับการเข้าใช้ครั้งถัดไปไม่สำเร็จ",
    ));
  });
});

/**
 * A manually controlled preference endpoint. Requests stay pending until the
 * test settles them; a cookie jar records what the browser would keep (the
 * Set-Cookie of each successful response, applied in arrival order).
 */
function controlledPrefs() {
  type Pending = { locale: Locale; done: boolean; ok: () => void; fail: (status?: number) => void };
  const state = { jar: null as Locale | null, inFlight: 0, maxInFlight: 0, requests: [] as Pending[] };
  const fn = vi.fn((_url: string, init?: RequestInit) => {
    const { locale } = JSON.parse(String(init?.body)) as { locale: Locale };
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    return new Promise<Response>((resolve, reject) => {
      const p: Pending = {
        locale,
        done: false,
        ok: () => {
          p.done = true;
          state.inFlight--;
          state.jar = locale;
          resolve(new Response(null, { status: 204 }));
        },
        fail: (status) => {
          p.done = true;
          state.inFlight--;
          if (status) resolve(new Response(null, { status }));
          else reject(new TypeError("Failed to fetch"));
        },
      };
      state.requests.push(p);
    });
  });
  const open = () => state.requests.filter((r) => !r.done);
  /** let queued writes start, then settle the open requests newest-first (reversed timing) */
  async function drainNewestFirst() {
    for (let i = 0; i < 10; i++) {
      await act(async () => {});
      const pending = open();
      if (pending.length === 0) return;
      await act(async () => pending[pending.length - 1].ok());
    }
    throw new Error("preference writes did not drain");
  }
  return { fn, state, open, drainNewestFirst };
}

/** What the next page load renders: the server reads the cookie (default th). */
function reload(jar: Locale | null) {
  cleanup();
  return render(
    <LanguageProvider initialLocale={jar ?? "th"}>
      <LanguageSwitch />
    </LanguageProvider>,
  );
}

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));

describe("LanguageSwitch — rapid switching persists the latest choice", () => {
  it("EN → TH with the Thai response arriving first: the cookie ends Thai, writes never overlap", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const user = userEvent.setup();
    setup("th");
    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    // the UI follows every click immediately
    expect(document.documentElement.lang).toBe("th");
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("aria-pressed", "true");

    await prefs.drainNewestFirst();

    expect(prefs.state.jar).toBe("th"); // the latest choice is what the browser keeps
    expect(prefs.state.maxInFlight).toBe(1); // writes never overlap
    expect(bodyOf(prefs.fn.mock.calls.at(-1))).toEqual({ locale: "th" });
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("aria-pressed", "true"); // not overwritten
    // only the latest choice is announced, in its own language: never the stale English success
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("เปลี่ยนเป็นภาษาไทยแล้ว");
    expect(toast.warning).not.toHaveBeenCalled();

    reload(prefs.state.jar);
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("aria-pressed", "true");
  });

  it("TH → EN → TH with the earlier writes delayed: the final Thai choice is what persists", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const user = userEvent.setup();
    setup("en");
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    expect(document.documentElement.lang).toBe("th");

    await prefs.drainNewestFirst();

    expect(prefs.state.jar).toBe("th"); // the latest choice is what the browser keeps
    expect(prefs.state.maxInFlight).toBe(1); // writes never overlap
    expect(bodyOf(prefs.fn.mock.calls.at(-1))).toEqual({ locale: "th" });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("เปลี่ยนเป็นภาษาไทยแล้ว");

    reload(prefs.state.jar);
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a network failure followed by a newer choice: the newer choice is saved and announced", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const user = userEvent.setup();
    setup("th");
    await user.click(screen.getByRole("button", { name: "EN" }));
    await act(async () => prefs.open()[0].fail()); // offline
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      "The language changed, but it could not be saved for your next visit.",
    ));
    expect(prefs.state.jar).toBeNull();

    await user.click(screen.getByRole("button", { name: "ไทย" }));
    await prefs.drainNewestFirst();
    expect(prefs.state.jar).toBe("th");
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("เปลี่ยนเป็นภาษาไทยแล้ว");
  });

  it("a superseded write that fails is silent; the newer choice is still saved", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const user = userEvent.setup();
    setup("th");
    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    await act(async () => prefs.open()[0].fail()); // the stale English write
    await prefs.drainNewestFirst();
    expect(prefs.state.jar).toBe("th"); // the latest choice is what the browser keeps
    expect(prefs.state.maxInFlight).toBe(1); // writes never overlap
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("เปลี่ยนเป็นภาษาไทยแล้ว");
  });

  it("if the final write fails, no success is claimed (not even the earlier stale one)", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const user = userEvent.setup();
    setup("th");
    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    // the English write completes first and succeeds; then the Thai write is rejected
    await act(async () => prefs.state.requests.find((r) => r.locale === "en")!.ok());
    await act(async () => {});
    const thai = prefs.state.requests.find((r) => r.locale === "th" && !r.done);
    expect(thai).toBeDefined();
    await act(async () => thai!.fail(400));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      "เปลี่ยนภาษาแล้ว แต่บันทึกค่าสำหรับการเข้าใช้ครั้งถัดไปไม่สำเร็จ",
    ));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("th"); // the UI keeps the user's latest choice
  });
});

describe("LanguageSwitch — Sales Return state safety under rapid switching", () => {
  beforeEach(() => {
    retMut.mutate.mockReset();
    window.sessionStorage.clear();
  });

  it("keeps the return draft and its Idempotency-Key, and triggers no business request", async () => {
    // the first submit fails (e.g. the service is unavailable), so the operator will retry
    retMut.mutate.mockImplementation((_a, { onError }) =>
      onError(new ApiError({ status: 503, message: "Service unavailable", requestId: "req-ret-503" })),
    );
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLocale="th">
        <LanguageSwitch />
        <ReturnDrawer id={63} soNumber="SO-000063" open onOpenChange={() => {}} />
      </LanguageProvider>,
    );
    const qty = screen.getByLabelText(/Return quantity for Green Tea 200g/i);
    await user.type(qty, "2");
    await user.type(screen.getByLabelText(/Return reason for Green Tea 200g/i), "damaged");
    await user.click(screen.getByRole("button", { name: /record return/i }));
    await waitFor(() => expect(retMut.mutate).toHaveBeenCalledTimes(1));
    const keyBefore = (retMut.mutate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;

    // rapid EN → TH → EN with reversed response timing. The modal drawer hides
    // the header from pointer and assistive tech (as in the app), so the clicks
    // are dispatched directly: what matters is that a locale change reaching
    // the mounted form neither remounts it nor rotates its key.
    const langButton = (name: string) => screen.getByRole("button", { name, hidden: true });
    for (const name of ["EN", "ไทย", "EN"]) await act(async () => fireEvent.click(langButton(name)));
    expect(document.documentElement.lang).toBe("en");
    await prefs.drainNewestFirst();
    expect(prefs.state.jar).toBe("en");

    // nothing but preference writes went out, and no business mutation ran
    expect(prefs.fn.mock.calls.every(([url]) => url === "/api/prefs/language")).toBe(true);
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
    // the same mounted inputs, values intact
    expect(screen.getByLabelText(/Return quantity for Green Tea 200g/i)).toBe(qty);
    expect(qty).toHaveValue("2");
    expect(screen.getByLabelText(/Return reason for Green Tea 200g/i)).toHaveValue("damaged");

    // the retry reuses the very same Idempotency-Key
    retMut.mutate.mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: /record return/i }));
    await waitFor(() => expect(retMut.mutate).toHaveBeenCalledTimes(2));
    expect((retMut.mutate.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey).toBe(keyBefore);
  });
});

describe("i18n fallback", () => {
  it("components outside a provider render English (existing screens and tests unaffected)", () => {
    render(<LanguageSwitch />);
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
  });
});
