import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

/* ------------------------------- mocks -------------------------------- */

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));
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

const NON_BATCH = {
  id: 5,
  sku: "WH-SALT",
  product_name: "Sea Salt 500g",
  is_active: true,
  track_batch: false,
  track_expiry: false,
  barcode: "880000000005",
};
const BATCH = {
  id: 6,
  sku: "WH-LOT",
  product_name: "Lot Widget",
  is_active: true,
  track_batch: true,
  track_expiry: false,
  barcode: "880000000006",
};

const resolveBarcode = vi.fn();
vi.mock("@/lib/query/sales", () => ({ resolveBarcode: (...a: unknown[]) => resolveBarcode(...a) }));

vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [NON_BATCH, BATCH] }, isFetching: false }),
}));

let preselectData: unknown = undefined;
vi.mock("@/lib/query/products", () => ({
  useProduct: () => ({ data: preselectData }),
}));

const saveMutate = vi.fn();
let saveState = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };
vi.mock("@/lib/query/stock", () => ({
  useSaveStockInSession: () => ({ mutate: saveMutate, ...saveState }),
}));

import { StockInConsole } from "./stock-in-console";

/* ------------------------------- helpers ----------------------------- */

async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
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

function resolvesTo(product: { id: number; product_name: string }) {
  resolveBarcode.mockResolvedValueOnce({ product, batches: [], barcode: "x", context: "stock_in" });
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  saveState = { isPending: false, isError: false, error: null, reset: vi.fn() };
  searchParams = new URLSearchParams();
  preselectData = undefined;
});

/* ------------------------------- tests ------------------------------- */

describe("StockInConsole — setup", () => {
  it("requires a product before scanning can start", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
    await pick(user, /Sea Salt 500g/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
  });

  it("keeps scanning disabled for a batch product until a lot number is entered", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Lot Widget/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("LOT-…"), "LOT-A");
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
  });
});

describe("StockInConsole — scan session", () => {
  it("a matched scan increments the local count and moves no stock", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");

    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("a wrong registered product does not change the count", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 99, product_name: "Something Else" });
    await scan(user, "889999999999");

    expect(await screen.findByText(/Wrong product/i)).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("an unknown barcode does not change the count", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    await scan(user, "870000000000");

    expect(await screen.findByText(/product not registered/i)).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("Undo last scan decrements the local count only", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(screen.getByText(/↶ .* undo -1/)).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("warns when the count goes over an expected quantity but still allows Save", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await user.type(screen.getByPlaceholderText("0.000"), "1");
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");

    expect(await screen.findByText(/Over expected quantity/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save 2 items/i })).toBeEnabled();
  });
});

describe("StockInConsole — save-once", () => {
  async function toCountOne(user: ReturnType<typeof userEvent.setup>) {
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
  }

  it("Save sends exactly one mutation with an accumulated quantity + idempotency key", async () => {
    const user = userEvent.setup();
    await toCountOne(user);

    await user.click(screen.getByRole("button", { name: /save 1 item/i }));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const [args] = saveMutate.mock.calls[0];
    expect(args.body).toEqual({ endpoint: "stock/in", json: { product_id: 5, quantity: "1" } });
    expect(typeof args.idempotencyKey).toBe("string");
    expect(args.idempotencyKey.length).toBeGreaterThan(8);
  });

  it("shows the success panel only after the backend response", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ productId: 5, productName: "Sea Salt 500g", savedQuantity: "1.000", currentStock: "9.000", lotNo: null }),
    );
    await toCountOne(user);
    await user.click(screen.getByRole("button", { name: /save 1 item/i }));

    expect(await screen.findByText("Stock saved")).toBeInTheDocument();
    expect(screen.getByText(/On hand/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan next product/i })).toBeInTheDocument();
  });

  it("reuses the same idempotency key when a failed Save is retried", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 500, message: "boom", requestId: "req-1" })),
    );
    await toCountOne(user);

    await user.click(screen.getByRole("button", { name: /save 1 item/i }));
    await user.click(screen.getByRole("button", { name: /save 1 item/i }));

    expect(saveMutate).toHaveBeenCalledTimes(2);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    const k2 = saveMutate.mock.calls[1][0].idempotencyKey;
    expect(k1).toBe(k2);
    // session preserved: still on the scan screen with the count intact
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("forces a new session on an idempotency-mismatch 409 (no silent new key)", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "req-2" }),
      ),
    );
    await toCountOne(user);
    await user.click(screen.getByRole("button", { name: /save 1 item/i }));

    expect(await screen.findByText(/can no longer be saved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start new stock-in session/i })).toBeInTheDocument();
    // Save is blocked until a new session is started
    expect(screen.getByRole("button", { name: /save 1 item/i })).toBeDisabled();
  });
});

describe("StockInConsole — deep-link preselect (?product=)", () => {
  it("preselects the product named by ?product= without starting a scan session", async () => {
    searchParams = new URLSearchParams("product=5");
    preselectData = { id: 5, sku: "WH-SALT", product_name: "Sea Salt 500g", track_batch: false, track_expiry: false };

    render(<StockInConsole />);

    // Product is selected (combobox switches from search input to a value
    // button) but scanning has not begun — the operator still confirms
    // "Start scanning" explicitly.
    expect(await screen.findByText("Sea Salt 500g")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
    expect(screen.queryByLabelText("Barcode scan input")).not.toBeInTheDocument();
  });

  it("ignores a missing/invalid ?product= (falls back to manual picker)", async () => {
    searchParams = new URLSearchParams("product=not-a-number");
    render(<StockInConsole />);
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
  });
});
