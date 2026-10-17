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

import {
  LanguageProvider,
  LOCALE_SAVE_TIMEOUT_MS,
  useI18n,
  useT,
  type LocaleSaveOutcome,
} from "@/lib/i18n/client";
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

/** Exposes the provider's setLocale so a test can read each choice's outcome. */
function OutcomeProbe({ onReady }: { onReady: (set: (l: Locale) => Promise<LocaleSaveOutcome>) => void }) {
  const { setLocale } = useI18n();
  React.useEffect(() => onReady(setLocale), [onReady, setLocale]);
  return null;
}

function setupProbe(initial: Locale) {
  let set!: (l: Locale) => Promise<LocaleSaveOutcome>;
  const utils = render(
    <LanguageProvider initialLocale={initial}>
      <OutcomeProbe onReady={(s) => (set = s)} />
      <LanguageSwitch />
    </LanguageProvider>,
  );
  return { ...utils, setLocale: (l: Locale) => set(l) };
}

/** Records how each promise settled, so "still pending" is observable. */
function track<T>(p: Promise<T>) {
  const t: { value?: T; settled: boolean } = { settled: false };
  void p.then((v) => {
    t.value = v;
    t.settled = true;
  });
  return t;
}

const flush = () => act(async () => {});

describe("LanguageProvider — every choice settles with an explicit outcome (R2-RF)", () => {
  it("a superseded choice settles as 'superseded' as soon as a newer choice is made", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const { setLocale } = setupProbe("th");
    let first!: ReturnType<typeof track<LocaleSaveOutcome>>;
    let second!: ReturnType<typeof track<LocaleSaveOutcome>>;
    await act(async () => {
      first = track(setLocale("en"));
    });
    expect(first.settled).toBe(false); // its write is in flight
    await act(async () => {
      second = track(setLocale("th"));
    });
    await flush();
    expect(first).toEqual({ settled: true, value: "superseded" }); // settled, not left pending
    expect(second.settled).toBe(false);

    await prefs.drainNewestFirst();
    expect(second).toEqual({ settled: true, value: "saved" });
    expect(prefs.state.jar).toBe("th");
    expect(prefs.state.maxInFlight).toBe(1);
  });

  it("the latest choice settles 'saved', 'failed' on a rejected response, and 'failed' on a network error", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const { setLocale } = setupProbe("th");
    let a!: ReturnType<typeof track<LocaleSaveOutcome>>;
    await act(async () => {
      a = track(setLocale("en"));
    });
    await act(async () => prefs.open()[0].ok());
    expect(a).toEqual({ settled: true, value: "saved" });

    let b!: ReturnType<typeof track<LocaleSaveOutcome>>;
    await act(async () => {
      b = track(setLocale("th"));
    });
    await flush();
    await act(async () => prefs.open()[0].fail(400));
    expect(b).toEqual({ settled: true, value: "failed" });

    let c!: ReturnType<typeof track<LocaleSaveOutcome>>;
    await act(async () => {
      c = track(setLocale("en"));
    });
    await flush();
    await act(async () => prefs.open()[0].fail());
    expect(c).toEqual({ settled: true, value: "failed" });
  });

  it("unmounting the provider settles a waiting choice as 'superseded' (nothing left to report to)", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    const { setLocale, unmount } = setupProbe("th");
    let a!: ReturnType<typeof track<LocaleSaveOutcome>>;
    await act(async () => {
      a = track(setLocale("en"));
    });
    unmount();
    await Promise.resolve();
    expect(a).toEqual({ settled: true, value: "superseded" });
  });
});

describe("LanguageSwitch — stalled preference writes (R2-RF bounded feedback)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const click = (name: string) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

  it("a stalled write is reported as not saved after the timeout, never as success", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    setup("th");
    await click("EN");
    expect(document.documentElement.lang).toBe("en"); // the UI switched immediately

    await act(async () => vi.advanceTimersByTimeAsync(LOCALE_SAVE_TIMEOUT_MS - 1));
    expect(toast.warning).not.toHaveBeenCalled(); // not before the bound
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("The language changed, but it could not be saved for your next visit.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(prefs.open()).toHaveLength(1); // not aborted: still waiting for the server

    // the request completes late: the cookie is written, but no late success is announced
    await act(async () => prefs.open()[0].ok());
    expect(prefs.state.jar).toBe("en");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a timed-out write that succeeds late cannot overwrite a newer choice: the newer write is sent only after it settles", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    setup("th");
    await click("EN");
    await act(async () => vi.advanceTimersByTimeAsync(LOCALE_SAVE_TIMEOUT_MS)); // EN reported not saved
    await click("ไทย"); // a newer choice while EN is still in flight

    // the Thai write waits: never two writes at once, even after a timeout
    await flush();
    expect(prefs.state.requests).toHaveLength(1);
    expect(prefs.state.maxInFlight).toBe(1);

    await act(async () => prefs.open()[0].ok()); // EN lands late: cookie briefly en
    expect(prefs.state.jar).toBe("en");
    await flush();
    expect(prefs.open().map((r) => r.locale)).toEqual(["th"]); // only now is Thai sent
    await act(async () => prefs.open()[0].ok());

    expect(prefs.state.jar).toBe("th"); // the latest choice is the last cookie written
    expect(prefs.state.maxInFlight).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("เปลี่ยนเป็นภาษาไทยแล้ว");
    reload(prefs.state.jar);
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a timed-out write that later fails does not block the newer choice", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    setup("th");
    await click("EN");
    await act(async () => vi.advanceTimersByTimeAsync(LOCALE_SAVE_TIMEOUT_MS));
    await click("ไทย");
    await act(async () => prefs.open()[0].fail()); // the stalled EN write finally errors
    await flush();
    await act(async () => prefs.open()[0].ok());
    expect(prefs.state.jar).toBe("th");
    expect(toast.success).toHaveBeenCalledWith("เปลี่ยนเป็นภาษาไทยแล้ว");
  });

  it("TH → EN → TH while the first write is stalled past the timeout: only Thai is written next, and it wins", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    setup("en");
    await click("ไทย");
    await act(async () => vi.advanceTimersByTimeAsync(LOCALE_SAVE_TIMEOUT_MS));
    await click("EN");
    await click("ไทย");
    expect(document.documentElement.lang).toBe("th");
    await act(async () => prefs.open()[0].ok()); // the stalled first write (th) completes
    await flush();
    // the intermediate English choice was superseded and is never written
    expect(prefs.state.requests.map((r) => r.locale)).toEqual(["th", "th"]);
    await act(async () => prefs.open()[0].ok());
    expect(prefs.state.jar).toBe("th");
    expect(prefs.state.maxInFlight).toBe(1);
    expect(toast.warning).toHaveBeenCalledTimes(1); // the first choice's bounded "not saved"
    expect(toast.success).toHaveBeenCalledTimes(1); // the final choice only
  });

  it("the latest choice still stalled is reported once at the bound, and saved when it completes", async () => {
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    setup("th");
    await click("EN");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await click("ไทย"); // its own bound starts at this click
    await act(async () => vi.advanceTimersByTimeAsync(LOCALE_SAVE_TIMEOUT_MS));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("เปลี่ยนภาษาแล้ว แต่บันทึกค่าสำหรับการเข้าใช้ครั้งถัดไปไม่สำเร็จ");
    await act(async () => prefs.open()[0].ok());
    await flush();
    await act(async () => prefs.open()[0].ok());
    expect(prefs.state.jar).toBe("th");
    expect(toast.success).not.toHaveBeenCalled(); // its outcome was already reported
  });

  it("a stall and timeout keep the Sales Return draft and Idempotency-Key, with no business request", async () => {
    retMut.mutate.mockReset();
    window.sessionStorage.clear();
    retMut.mutate.mockImplementation((_a, { onError }) =>
      onError(new ApiError({ status: 503, message: "Service unavailable", requestId: "req-ret-503" })),
    );
    const prefs = controlledPrefs();
    vi.stubGlobal("fetch", prefs.fn);
    render(
      <LanguageProvider initialLocale="th">
        <LanguageSwitch />
        <ReturnDrawer id={63} soNumber="SO-000063" open onOpenChange={() => {}} />
      </LanguageProvider>,
    );
    const qty = screen.getByLabelText(/Return quantity for Green Tea 200g/i);
    fireEvent.change(qty, { target: { value: "2" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /record return/i })));
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
    const keyBefore = (retMut.mutate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;

    const langButton = (name: string) => screen.getByRole("button", { name, hidden: true });
    await act(async () => fireEvent.click(langButton("EN")));
    await act(async () => vi.advanceTimersByTimeAsync(LOCALE_SAVE_TIMEOUT_MS));
    await act(async () => fireEvent.click(langButton("ไทย")));
    await act(async () => prefs.open()[0].ok());
    await flush();
    await act(async () => prefs.open()[0].ok());

    expect(prefs.state.jar).toBe("th");
    expect(prefs.fn.mock.calls.every(([url]) => url === "/api/prefs/language")).toBe(true);
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Return quantity for Green Tea 200g/i)).toBe(qty);
    expect(qty).toHaveValue("2");

    retMut.mutate.mockImplementation(() => {});
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /record return/i })));
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
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
