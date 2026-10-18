import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DEFAULT_SCANNER_TIMING } from "@/components/work/use-scanner";
import { ApiError } from "@/lib/api/errors";

/* ------------------------------- mocks -------------------------------- */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/work/camera-barcode-scanner", () => ({ CameraBarcodeScanner: () => null }));
vi.mock("@/components/work/use-beep", () => ({
  useBeep: () => ({
    enabled: false,
    setEnabled: vi.fn(),
    tone: vi.fn(),
    beepOk: vi.fn(),
    beepBad: vi.fn(),
    beepDone: vi.fn(),
  }),
}));

const PRODUCT = { id: 5, sku: "WH-COFFEE", product_name: "Coffee 1kg", is_active: true, barcode: "880000000005" };
const OTHER = { id: 6, sku: "WH-TEA", product_name: "Tea 1kg", is_active: true, barcode: "880000000006" };

const resolveBarcode = vi.fn();
vi.mock("@/lib/query/sales", () => ({ resolveBarcode: (...a: unknown[]) => resolveBarcode(...a) }));

// R4.3: the review's before → after estimate reads the MAIN / DEFAULT balance
const MAIN_BALANCE = {
  id: 1, product_id: 5, warehouse_id: 1, location_id: 11, batch_id: null, batch_lot_no: null,
  on_hand_qty: "10.000", reserved_qty: "0.000", available_qty: "10.000", is_transit: false,
  batch_expiry_date: null, days_to_expiry: null, is_expired: false, as_of_date: "2026-10-17",
};
let stockRows: unknown[] = [MAIN_BALANCE];
vi.mock("@/lib/query/warehouses", () => ({
  useWarehouses: () => ({
    data: [{ id: 1, warehouse_code: "MAIN", locations: [{ id: 11, location_code: "DEFAULT" }] }],
    isError: false,
  }),
}));
vi.mock("@/lib/query/hooks", () => ({
  useAllProductStock: () => ({ data: { items: stockRows }, isLoading: false, isError: false }),
  useProducts: () => ({ data: { items: [PRODUCT, OTHER] }, isFetching: false }),
}));

const saveMutate = vi.fn();
let saveState = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };
vi.mock("@/lib/query/stock", () => ({
  useSaveStockOutSession: () => ({ mutate: saveMutate, ...saveState }),
}));

import { StockOutConsole } from "./stock-out-console";

/* R4 review before commit (D-R4-4): Save is now Review, then an explicit Confirm. */
const reviewButton = (n?: number) =>
  screen.getByRole("button", { name: n === undefined ? /review stock out/i : new RegExp(`review stock out \\(${n}\\)`, "i") });
/** open the review (unless a failed confirm left it open) and confirm — the existing save */
async function reviewAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("dialog")) await user.click(reviewButton());
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^confirm /i }));
}
import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";

/* ------------------------------- helpers ----------------------------- */

function lookupResult(product: { id: number; product_name: string }, available = "20.000") {
  return {
    product: { ...product, sku: "x", track_batch: false, track_expiry: false, operational_available_quantity: available },
    batches: [],
    barcode: "x",
    context: "lookup",
  };
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  // The console fetches availability as soon as a product is picked —
  // queue a harmless default for that call before clicking.
  resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
  await user.click(screen.getByRole("combobox", { name: /search products/i }));
  const option = await screen.findByRole("option", { name });
  await user.click(within(option).getByRole("button"));
}

async function startScanning(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /start scanning/i }));
}

/*
 * Deterministic scanner clock. useScanner ignores a repeat of the same code
 * inside DEFAULT_SCANNER_TIMING.dedupeMs, measured with Date.now(). On a fast
 * runner two back-to-back scans of the same barcode can land inside that
 * window, so a deliberate second scan was silently de-duplicated (a CI-only
 * failure). Date.now() is pinned per test and only moves when a test says so.
 */
let clock = 0;
let nowSpy: MockInstance<() => number>;

/** A deliberate new scan: step the clock well past the dedupe window first. */
async function scan(user: ReturnType<typeof userEvent.setup>, code: string) {
  clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
  await typeScan(user, code);
}

/** Type a scan at the current clock (no time passes — used for bounce tests). */
async function typeScan(user: ReturnType<typeof userEvent.setup>, code: string) {
  const input = screen.getByLabelText("Barcode scan input");
  await user.click(input);
  await user.type(input, `${code}{Enter}`);
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): several tests here queue a per-test
  // mockResolvedValueOnce/mockReturnValueOnce on resolveBarcode, including a
  // deliberately-pending promise in the availability-race tests below.
  // clearAllMocks only resets call history, not queued "once" implementations
  // — a left-over queued value from one test would otherwise silently shift
  // which response the NEXT test's resolveBarcode call receives.
  vi.resetAllMocks();
  stockRows = [MAIN_BALANCE];
  clock = 1_700_000_000_000;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  saveState = { isPending: false, isError: false, error: null, reset: vi.fn() };
});

afterEach(() => {
  nowSpy.mockRestore();
});

/* ------------------------------- tests ------------------------------- */

describe("StockOutConsole — setup", () => {
  it("requires a product before scanning can start, and defaults to FEFO", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
    await pick(user, /Coffee 1kg/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^FIFO/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the fetched availability once a product is picked", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    expect(await screen.findByText("20.000")).toBeInTheDocument();
  });

  it("lets the operator switch strategy before starting, and the choice sticks", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    const fifoButton = screen.getByRole("button", { name: /^FIFO/i });
    await user.click(fifoButton);
    expect(fifoButton).toHaveAttribute("aria-pressed", "true");
  });
});

describe("StockOutConsole — pending-operation safety (no silent product/strategy change)", () => {
  it("the strategy picker and product search are gone once scanning starts", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    expect(screen.queryByRole("button", { name: /^FIFO/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /search products/i })).not.toBeInTheDocument();
    // the only way to touch product/strategy again is to abandon the session
    expect(screen.getByRole("button", { name: /clear session/i })).toBeInTheDocument();
  });
});

describe("StockOutConsole — scan session", () => {
  it("a matched scan increments the local count and moves no stock", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");

    expect(await screen.findByText(/Matched — ready to issue 1/i)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("a wrong registered product does not change the count", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    resolveBarcode.mockResolvedValueOnce(lookupResult(OTHER));
    await scan(user, "880000000006");

    expect(await screen.findByText(/Wrong product/i)).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("an unknown barcode does not change the count", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    await scan(user, "870000000000");

    expect(await screen.findByText(/product not registered/i)).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("Undo last scan decrements the local count only", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — ready to issue 1/i)).toBeInTheDocument();
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — ready to issue 2/i)).toBeInTheDocument();
    expect(resolveBarcode).toHaveBeenCalledTimes(3); // availability lookup + 2 scans
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("warns when the count exceeds the last-known availability but still allows Save", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT, "1.000"));
    await user.click(screen.getByRole("combobox", { name: /search products/i }));
    const option = await screen.findByRole("option", { name: /Coffee 1kg/ });
    await user.click(within(option).getByRole("button"));
    await startScanning(user);

    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT, "1.000"));
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — ready to issue 1/i)).toBeInTheDocument();
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT, "1.000"));
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — ready to issue 2/i)).toBeInTheDocument();

    expect(await screen.findByText(/Over the last-known available quantity/i)).toBeInTheDocument();
    expect(reviewButton(2)).toBeEnabled();
  });

  it("ignores a bounced repeat of the same barcode inside the dedupe window", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — ready to issue 1/i)).toBeInTheDocument();

    clock += DEFAULT_SCANNER_TIMING.dedupeMs - 1; // still inside the window
    await typeScan(user, "880000000005");

    expect(resolveBarcode).toHaveBeenCalledTimes(2); // availability lookup + 1 scan
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("counts a repeat of the same barcode once the dedupe window has passed", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);

    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — ready to issue 1/i)).toBeInTheDocument();

    clock += DEFAULT_SCANNER_TIMING.dedupeMs; // exactly at the edge: a new scan
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await typeScan(user, "880000000005");

    expect(await screen.findByText(/Matched — ready to issue 2/i)).toBeInTheDocument();
    expect(resolveBarcode).toHaveBeenCalledTimes(3);
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();
  });
});

describe("StockOutConsole — save-once", () => {
  async function toCountOne(user: ReturnType<typeof userEvent.setup>, strategy: "fefo" | "fifo" = "fefo") {
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    if (strategy === "fifo") {
      await user.click(screen.getByRole("button", { name: /^FIFO/i }));
    }
    await startScanning(user);
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
  }

  it("FEFO (the default) saves to stock/out-fefo with one mutation + idempotency key", async () => {
    const user = userEvent.setup();
    await toCountOne(user, "fefo");

    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const [args] = saveMutate.mock.calls[0];
    expect(args.body).toEqual({ endpoint: "stock/out-fefo", json: { product_id: 5, quantity: "1" } });
    expect(typeof args.idempotencyKey).toBe("string");
    expect(args.idempotencyKey.length).toBeGreaterThan(8);
  });

  it("FIFO saves to stock/out-fifo — strategy picks the endpoint", async () => {
    const user = userEvent.setup();
    await toCountOne(user, "fifo");

    await reviewAndConfirm(user);
    const [args] = saveMutate.mock.calls[0];
    expect(args.body.endpoint).toBe("stock/out-fifo");
  });

  it("shows the success panel only after the backend response", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ product_id: 5, product_name: "Coffee 1kg", previous_stock: "20.000", current_stock: "19.000", difference: "-1.000" }),
    );
    await toCountOne(user);
    await reviewAndConfirm(user);

    expect(await screen.findByText("Stock issued")).toBeInTheDocument();
    expect(screen.getByText(/On hand/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue next product/i })).toBeInTheDocument();
  });

  it("reuses the same idempotency key when a failed Save is retried (lost-response safety)", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 500, message: "boom", requestId: "req-1" })),
    );
    await toCountOne(user);

    await reviewAndConfirm(user);
    await reviewAndConfirm(user);

    expect(saveMutate).toHaveBeenCalledTimes(2);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    const k2 = saveMutate.mock.calls[1][0].idempotencyKey;
    expect(k1).toBe(k2);
    // session preserved: still on the scan screen with the count intact
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("forces a new session on an idempotency-mismatch 409 — never a silent new key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "req-2" }),
      ),
    );
    await toCountOne(user);
    await reviewAndConfirm(user);

    expect(await screen.findByText(/can no longer be saved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start new stock-out session/i })).toBeInTheDocument();
    // Save is blocked until a new session is explicitly started
    expect(reviewButton(1)).toBeDisabled();
  });

  it("duplicate-submit prevention: Save is disabled while a mutation is pending", async () => {
    const user = userEvent.setup();
    saveState = { isPending: true, isError: false, error: null, reset: vi.fn() };
    await toCountOne(user);
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });
});

describe("StockOutConsole — reload / lost-response safety", () => {
  it("reload (unmount + remount) preserves the draft and the SAME Idempotency-Key for an unresolved Save", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");

    // Fire a Save and never resolve it — exactly what a lost response /
    // network timeout looks like from the console's point of view: the
    // mutation promise just never settles.
    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const firstKey = saveMutate.mock.calls[0][0].idempotencyKey;

    // Simulate a browser reload: the console unmounts and a fresh instance
    // mounts in its place. sessionStorage (not React state) is what must
    // survive this.
    unmount();
    render(<StockOutConsole />);

    // The reloaded console rehydrates mid-session — still on the scan
    // screen, same count, not reset to the setup picker.
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(reviewButton(1)).toBeEnabled();

    // Retrying after the reload must reuse the exact same key — an
    // unresolved operation must never silently acquire a new one.
    await reviewAndConfirm(user);
    const secondKey = saveMutate.mock.calls[1][0].idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });
});

describe("StockOutConsole — availability race (stale lookup never wins)", () => {
  it("picking product B before product A's slow lookup resolves never shows A's availability for B", async () => {
    const user = userEvent.setup();
    let resolveA!: (v: unknown) => void;
    const pendingA = new Promise((resolve) => {
      resolveA = resolve;
    });
    resolveBarcode.mockReturnValueOnce(pendingA); // product A's lookup — deliberately left pending

    render(<StockOutConsole />);
    await user.click(screen.getByRole("combobox", { name: /search products/i }));
    const optionA = await screen.findByRole("option", { name: /Coffee 1kg/ });
    await user.click(within(optionA).getByRole("button"));
    // A is selected; its availability fetch is in flight and NOT settled yet.

    // Pick B before A's lookup resolves. Once a product is selected the
    // Combobox shows a plain value button (not role="combobox") — its
    // accessible name comes from the associated <label> ("Product"), not
    // its visible text — click it to reopen the list, exactly as an
    // operator changing their mind would.
    resolveBarcode.mockResolvedValueOnce(lookupResult(OTHER, "7.000"));
    await user.click(screen.getByRole("button", { name: "Product" }));
    const optionB = await screen.findByRole("option", { name: /Tea 1kg/ });
    await user.click(within(optionB).getByRole("button"));

    expect(await screen.findByText("7.000")).toBeInTheDocument(); // B's own availability

    // NOW let A's stale lookup resolve.
    await act(async () => {
      resolveA(lookupResult(PRODUCT, "99.000"));
      await Promise.resolve();
    });

    // A's stale value must never appear anywhere, and B's must still be shown.
    expect(screen.queryByText("99.000")).not.toBeInTheDocument();
    expect(screen.getByText("7.000")).toBeInTheDocument();
    expect(screen.getAllByText("Tea 1kg").length).toBeGreaterThan(0); // R4: also in the side card
  });

  it("a pending availability lookup resolving after unmount does not throw or warn", async () => {
    const user = userEvent.setup();
    let resolveA!: (v: unknown) => void;
    const pendingA = new Promise((resolve) => {
      resolveA = resolve;
    });
    resolveBarcode.mockReturnValueOnce(pendingA);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<StockOutConsole />);
    await user.click(screen.getByRole("combobox", { name: /search products/i }));
    const optionA = await screen.findByRole("option", { name: /Coffee 1kg/ });
    await user.click(within(optionA).getByRole("button"));

    unmount();

    await act(async () => {
      resolveA(lookupResult(PRODUCT, "5.000"));
      await Promise.resolve();
    });

    const unmountedWarning = errorSpy.mock.calls.some((args) =>
      String(args[0]).match(/unmounted component/i),
    );
    expect(unmountedWarning).toBe(false);
    errorSpy.mockRestore();
  });
});

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("StockOutConsole — characterization (R3.0)", () => {

  async function countScans(user: ReturnType<typeof userEvent.setup>, n: number) {
    for (let i = 1; i <= n; i++) {
      resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
      await scan(user, PRODUCT.barcode);
      expect(await screen.findByText(new RegExp(`Matched — ready to issue ${i}`, "i"))).toBeInTheDocument();
    }
  }

  async function sessionAt(user: ReturnType<typeof userEvent.setup>, n: number, strategy: "fefo" | "fifo" = "fefo") {
    await pick(user, /Coffee 1kg/);
    if (strategy === "fifo") await user.click(screen.getByRole("button", { name: /^FIFO/i }));
    await startScanning(user);
    await countScans(user, n);
  }

  it("FIFO body: count as a plain string, trimmed remark, expected never sent; scans resolve with the 'lookup' purpose", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await user.click(screen.getByRole("button", { name: /^FIFO/i }));
    await user.type(screen.getByPlaceholderText("0.000"), "9");
    await user.type(screen.getByPlaceholderText("e.g. order pick"), "  pick 7  ");
    await startScanning(user);
    await countScans(user, 3);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0]).toEqual({
      body: { endpoint: "stock/out-fifo", json: { product_id: 5, quantity: "3", remark: "pick 7" } },
      idempotencyKey: expect.stringMatching(/^stockout-/),
    });
    // availability lookup on pick + 3 scans, all read-only "lookup" resolutions
    expect(resolveBarcode.mock.calls.map((c) => c[1])).toEqual(["lookup", "lookup", "lookup", "lookup"]);
  });

  it("the mismatch predicate is status 409 + /different payload/i; the same text with another status is not", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 422, message: "Idempotency-Key already used with a different payload", requestId: "r" })),
    );
    render(<StockOutConsole />);
    await sessionAt(user, 1);
    await reviewAndConfirm(user);
    expect(screen.queryByText(/can no longer be saved/i)).not.toBeInTheDocument();
    saveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "x Different Payload x", requestId: "r" })),
    );
    await reviewAndConfirm(user);
    expect(await screen.findByText(/can no longer be saved/i)).toBeInTheDocument();
    expect(saveMutate.mock.calls[0][0].idempotencyKey).toBe(saveMutate.mock.calls[1][0].idempotencyKey);
  });

  it("mismatch recovery clears the session (strategy back to FEFO) and the next save uses a NEW key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "r" })),
    );
    render(<StockOutConsole />);
    await sessionAt(user, 1, "fifo");
    await reviewAndConfirm(user);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    await user.click(await screen.findByRole("button", { name: /start new stock-out session/i }));
    expect(screen.queryByLabelText("Barcode scan input")).not.toBeInTheDocument();
    await sessionAt(user, 1);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[1][0].body.endpoint).toBe("stock/out-fefo");
    expect(saveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
  });

  it("success rotates the key for the next session", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ product_id: 5, product_name: "Coffee 1kg", difference: "-1", current_stock: "19" }),
    );
    render(<StockOutConsole />);
    await sessionAt(user, 1);
    await reviewAndConfirm(user);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    await user.click(screen.getByRole("button", { name: /issue next product/i }));
    await sessionAt(user, 1);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
  });

  it("a language switch keeps the session, count and key and sends no business request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <LanguageProvider initialLocale="en">
          <LanguageSwitch />
          <StockOutConsole />
        </LanguageProvider>,
      );
      await sessionAt(user, 2, "fifo");
      const scanInput = screen.getByLabelText("Barcode scan input");
      await user.click(screen.getByRole("button", { name: "ไทย" }));
      await user.click(screen.getByRole("button", { name: "EN" }));
      expect(screen.getByLabelText("Barcode scan input")).toBe(scanInput);
      expect(saveMutate).not.toHaveBeenCalled();
      expect(resolveBarcode).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.every((c) => (c as unknown[])[0] === "/api/prefs/language")).toBe(true);
      await reviewAndConfirm(user);
      expect(saveMutate.mock.calls[0][0].body).toEqual({ endpoint: "stock/out-fifo", json: { product_id: 5, quantity: "2" } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ------------------- R4 review before commit + lot preview (D-R4-3/4) ------------------- */

describe("StockOutConsole — R4 review and lot preview", () => {
  const lot = (id: number, lotNo: string, expiry: string | null, over: Record<string, unknown> = {}) => ({
    ...MAIN_BALANCE, id, batch_id: id, batch_lot_no: lotNo, batch_expiry_date: expiry, days_to_expiry: 100,
    on_hand_qty: "5.000", available_qty: "5.000", ...over,
  });

  async function scanningWith(user: ReturnType<typeof userEvent.setup>, n: number) {
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);
    for (let i = 1; i <= n; i++) {
      resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
      await scan(user, PRODUCT.barcode);
      expect(await screen.findByText(new RegExp(`Matched — ready to issue ${i}`, "i"))).toBeInTheDocument();
    }
  }

  it("FEFO preview lists eligible lots by expiry, excludes expired lots and never promises a split", async () => {
    stockRows = [
      lot(2, "LOT-LATE", "2027-12-01"),
      lot(3, "LOT-EXPIRED", "2026-01-01", { is_expired: true }),
      lot(4, "LOT-SOON", "2027-01-01"),
    ];
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    const list = screen.getByText("Eligible lots, earliest expiry first").nextElementSibling as HTMLElement;
    expect(within(list).getAllByText(/^LOT-/).map((e) => e.textContent)).toEqual(["LOT-SOON", "LOT-LATE"]);
    expect(screen.queryByText("LOT-EXPIRED")).toBeNull();
    expect(screen.getByText("Preview only — the server selects the final lots.")).toBeInTheDocument();
  });

  it("FIFO lists the same lots but states that no FIFO order can be shown", async () => {
    stockRows = [lot(2, "LOT-B", "2027-12-01"), lot(4, "LOT-A", "2027-01-01")];
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await user.click(screen.getByRole("button", { name: /^FIFO/i }));
    expect(screen.getByText("Eligible lots")).toBeInTheDocument();
    expect(screen.getByText(/FIFO order is not shown/)).toBeInTheDocument();
    expect(screen.getByText("Preview only — the server selects the final lots.")).toBeInTheDocument();
  });

  it("the review shows the removal, the strategy and the labelled estimate, and sends nothing until Confirm", async () => {
    const user = userEvent.setup();
    await scanningWith(user, 2);
    await user.click(reviewButton(2));
    const dialog = screen.getByRole("dialog", { name: "Confirm stock out" });
    expect(within(dialog).getByText("Removes stock")).toBeInTheDocument();
    expect(within(dialog).getByText("−2.000")).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/10\.000.*8\.000.*estimate/);
    expect(within(dialog).getByText("Preview only — the server selects the final lots.")).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm −2.000" }));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0][0].body).toEqual({ endpoint: "stock/out-fefo", json: { product_id: 5, quantity: "2" } });
  });

  it("while the review is open a hardware scan neither counts nor confirms", async () => {
    const user = userEvent.setup();
    await scanningWith(user, 1);
    await user.click(reviewButton(1));
    clock += 5_000;
    await user.keyboard(`${PRODUCT.barcode}{Enter}`);
    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

/* --------------------- R4-TQ typed quantity + attempt lock --------------------- */

describe("StockOutConsole — R4-TQ typed quantity and the attempt lock", () => {
  const modeRadio = (name: RegExp) => screen.getByRole("radio", { name });
  const qtyField = () => screen.getByLabelText("Quantity to issue") as HTMLInputElement;
  async function enterQty(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.clear(qtyField());
    await user.click(qtyField());
    await user.paste(text);
  }
  async function typedSession(user: ReturnType<typeof userEvent.setup>, text: string, strategy?: RegExp) {
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    if (strategy) await user.click(screen.getByRole("button", { name: strategy }));
    await startScanning(user);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, text);
  }
  const activeKey = () =>
    JSON.parse(window.sessionStorage.getItem(`stock-out:session:${window.sessionStorage.getItem("stock-out:session:active")}`)!)
      .idempotencyKey as string;

  it("typed quantities keep the FEFO and FIFO endpoints and are sent canonically", async () => {
    const user = userEvent.setup();
    await typedSession(user, "0.75");
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0].body).toEqual({ endpoint: "stock/out-fefo", json: { product_id: 5, quantity: "0.750" } });
  });

  it("FIFO typed", async () => {
    const user = userEvent.setup();
    await typedSession(user, "2", /^FIFO/i);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0].body).toEqual({ endpoint: "stock/out-fifo", json: { product_id: 5, quantity: "2.000" } });
  });

  it("the review labels the entry method, the strategy and the server-picked lots honestly", async () => {
    const user = userEvent.setup();
    await typedSession(user, "1.5");
    await user.click(reviewButton());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Entered quantity")).toBeInTheDocument();
    expect(within(dialog).getByText("−1.500")).toBeInTheDocument();
    expect(within(dialog).getByText("Preview only — the server selects the final lots.")).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/estimate/);
    expect(within(dialog).getByRole("button", { name: "Confirm −1.500" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("over-availability stays an advisory warning for a typed quantity (the server decides)", async () => {
    const user = userEvent.setup();
    await typedSession(user, "25"); // pick() reports 20.000 available
    expect(screen.getByText("Over the last-known available quantity — 25.000 of 20.000. The backend re-checks at Save; this is only a heads-up.")).toBeInTheDocument();
    expect(reviewButton()).toBeEnabled();
  });

  it("Scan Count still sends the bare integer, byte-for-byte as in R4", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);
    for (let i = 1; i <= 2; i++) {
      resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
      await scan(user, PRODUCT.barcode);
      expect(await screen.findByText(new RegExp(`Matched — ready to issue ${i}`, "i"))).toBeInTheDocument();
    }
    await reviewAndConfirm(user);
    expect(JSON.stringify(saveMutate.mock.calls[0][0].body)).toBe('{"endpoint":"stock/out-fefo","json":{"product_id":5,"quantity":"2"}}');
  });

  it("a verified first-attempt 'Not enough stock' unlocks edits on the same key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 409, message: "Not enough stock" })));
    await typedSession(user, "30");
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(modeRadio(/scan count/i)).toBeEnabled();
    await enterQty(user, "3");
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[1][0].idempotencyKey).toBe(saveMutate.mock.calls[0][0].idempotencyKey);
    expect(saveMutate.mock.calls[1][0].body.json.quantity).toBe("3.000");
  });

  it("an uncertain outcome locks; the retry is identical; abandon needs the dialog and rotates the key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 500, message: "boom" })));
    await typedSession(user, "1");
    const oldKey = activeKey();
    await reviewAndConfirm(user);
    await reviewAndConfirm(user); // the sheet stays open: confirm again = retry
    expect(saveMutate.mock.calls[1][0]).toEqual(saveMutate.mock.calls[0][0]);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(modeRadio(/scan count/i)).toBeDisabled();
    expect(qtyField()).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "Abandon…" }));
    const dialog = screen.getByRole("dialog", { name: "Abandon this session?" });
    await user.click(within(dialog).getByRole("button", { name: "Abandon and start a new session" }));
    expect(activeKey()).not.toBe(oldKey);
    expect(saveMutate).toHaveBeenCalledTimes(2);
  });

  it("a scanner burst in the quantity field is rejected and cannot be submitted", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    await startScanning(user);
    await user.click(modeRadio(/enter quantity/i));
    await user.click(qtyField());
    await user.type(qtyField(), `${PRODUCT.barcode}{Enter}`);
    expect(qtyField()).toHaveValue("");
    expect(screen.getByText(/looked like barcode scanner input/i)).toBeInTheDocument();
    expect(reviewButton()).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveMutate).not.toHaveBeenCalled();
  });
});
