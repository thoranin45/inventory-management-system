import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [PRODUCT, OTHER] }, isFetching: false }),
}));

const saveMutate = vi.fn();
let saveState = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };
vi.mock("@/lib/query/stock", () => ({
  useSaveStockOutSession: () => ({ mutate: saveMutate, ...saveState }),
}));

import { StockOutConsole } from "./stock-out-console";

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

async function scan(user: ReturnType<typeof userEvent.setup>, code: string) {
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
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  saveState = { isPending: false, isError: false, error: null, reset: vi.fn() };
});

/* ------------------------------- tests ------------------------------- */

describe("StockOutConsole — setup", () => {
  it("requires a product before scanning can start, and defaults to FEFO", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
    await pick(user, /Coffee 1kg/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /เข้าก่อน ออกก่อน/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the fetched availability once a product is picked", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    expect(await screen.findByText("20.00")).toBeInTheDocument();
  });

  it("lets the operator switch strategy before starting, and the choice sticks", async () => {
    const user = userEvent.setup();
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    const fifoButton = screen.getByRole("button", { name: /เข้าก่อน ออกก่อน \(FIFO\)/i });
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

    expect(screen.queryByRole("button", { name: /เข้าก่อน ออกก่อน/i })).not.toBeInTheDocument();
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
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
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
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT, "1.000"));
    await scan(user, "880000000005");

    expect(await screen.findByText(/Over the last-known available quantity/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue 2 items/i })).toBeEnabled();
  });
});

describe("StockOutConsole — save-once", () => {
  async function toCountOne(user: ReturnType<typeof userEvent.setup>, strategy: "fefo" | "fifo" = "fefo") {
    render(<StockOutConsole />);
    await pick(user, /Coffee 1kg/);
    if (strategy === "fifo") {
      await user.click(screen.getByRole("button", { name: /เข้าก่อน ออกก่อน \(FIFO\)/i }));
    }
    await startScanning(user);
    resolveBarcode.mockResolvedValueOnce(lookupResult(PRODUCT));
    await scan(user, "880000000005");
  }

  it("FEFO (the default) saves to stock/out-fefo with one mutation + idempotency key", async () => {
    const user = userEvent.setup();
    await toCountOne(user, "fefo");

    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const [args] = saveMutate.mock.calls[0];
    expect(args.body).toEqual({ endpoint: "stock/out-fefo", json: { product_id: 5, quantity: "1" } });
    expect(typeof args.idempotencyKey).toBe("string");
    expect(args.idempotencyKey.length).toBeGreaterThan(8);
  });

  it("FIFO saves to stock/out-fifo — strategy picks the endpoint", async () => {
    const user = userEvent.setup();
    await toCountOne(user, "fifo");

    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));
    const [args] = saveMutate.mock.calls[0];
    expect(args.body.endpoint).toBe("stock/out-fifo");
  });

  it("shows the success panel only after the backend response", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ product_id: 5, product_name: "Coffee 1kg", previous_stock: "20.000", current_stock: "19.000", difference: "-1.000" }),
    );
    await toCountOne(user);
    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));

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

    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));
    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));

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
    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));

    expect(await screen.findByText(/can no longer be saved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start new stock-out session/i })).toBeInTheDocument();
    // Save is blocked until a new session is explicitly started
    expect(screen.getByRole("button", { name: /issue 1 item/i })).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));
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
    expect(screen.getByRole("button", { name: /issue 1 item/i })).toBeEnabled();

    // Retrying after the reload must reuse the exact same key — an
    // unresolved operation must never silently acquire a new one.
    await user.click(screen.getByRole("button", { name: /issue 1 item/i }));
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

    expect(await screen.findByText("7.00")).toBeInTheDocument(); // B's own availability

    // NOW let A's stale lookup resolve.
    await act(async () => {
      resolveA(lookupResult(PRODUCT, "99.000"));
      await Promise.resolve();
    });

    // A's stale value must never appear anywhere, and B's must still be shown.
    expect(screen.queryByText("99.00")).not.toBeInTheDocument();
    expect(screen.getByText("7.00")).toBeInTheDocument();
    expect(screen.getByText("Tea 1kg")).toBeInTheDocument();
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
