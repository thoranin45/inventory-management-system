import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PRODUCT = { id: 5, sku: "WH-COFFEE", product_name: "Coffee 1kg", is_active: true, barcode: "880000000005" };

const resolveBarcode = vi.fn();
vi.mock("@/lib/query/sales", () => ({ resolveBarcode: (...a: unknown[]) => resolveBarcode(...a) }));

vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [PRODUCT] }, isFetching: false }),
}));

const createMutate = vi.fn();
let createState = { isPending: false, isError: false, error: null as unknown };
vi.mock("@/lib/query/stock-adjustment-requests", () => ({
  useCreateStockAdjustmentRequest: () => ({ mutate: createMutate, ...createState }),
}));

import { StockAdjustmentRequestForm } from "./request-form";

function lookupResult(available = "10.000") {
  return {
    product: { ...PRODUCT, track_batch: false, track_expiry: false, operational_available_quantity: available },
    batches: [],
    barcode: "x",
    context: "lookup",
  };
}

async function pickProduct(user: ReturnType<typeof userEvent.setup>) {
  resolveBarcode.mockResolvedValueOnce(lookupResult());
  await user.click(screen.getByRole("combobox", { name: /search products/i }));
  const option = await screen.findByRole("option", { name: /Coffee 1kg/ });
  await user.click(within(option).getByRole("button"));
}

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
  createState = { isPending: false, isError: false, error: null };
  push.mockReset();
});

describe("StockAdjustmentRequestForm", () => {
  it("prefills observed quantity from availability once a product is picked", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    const observed = await screen.findByLabelText("Observed quantity");
    expect(observed).toHaveValue("10.000");
  });

  it("disables submit until requested quantity and reason are valid", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "8.000");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("OTHER reason requires a note before submit is enabled", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "8.000");
    await user.click(screen.getByRole("button", { name: /Other \(note required\)/i }));
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/counted 38/i), "Shelf recount");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("submits once and shows the PENDING confirmation", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({
        id: 1, reference_number: "ADJ-000001", status: "PENDING",
        product: { id: 5, sku: "WH-COFFEE", product_name: "Coffee 1kg" },
      });
    });
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "8.000");
    await user.click(screen.getByRole("button", { name: /submit request/i }));
    expect(await screen.findByText(/Request submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/ADJ-000001/)).toBeInTheDocument();
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it("forces a new request on an idempotency-mismatch 409, never silently re-keys", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_vars, opts) => {
      opts.onError(new ApiError({ kind: "http", status: 409, message: "Idempotency-Key already used with a different payload" }));
    });
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "8.000");
    await user.click(screen.getByRole("button", { name: /submit request/i }));
    expect(await screen.findByText(/can no longer be submitted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start new request/i })).toBeInTheDocument();
  });

  it("reload (unmount + remount) preserves the draft and the same Idempotency-Key", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "8.000");
    const firstCallKeyHolder: { key?: string } = {};
    createMutate.mockImplementation((vars) => {
      firstCallKeyHolder.key = vars.idempotencyKey;
    });
    await user.click(screen.getByRole("button", { name: /submit request/i }));
    const keyBeforeReload = firstCallKeyHolder.key;
    expect(keyBeforeReload).toBeTruthy();

    unmount();
    render(<StockAdjustmentRequestForm />);
    const observedAfterReload = await screen.findByLabelText("Observed quantity");
    expect(observedAfterReload).toHaveValue("10.000");
    await user.click(screen.getByRole("button", { name: /submit request/i }));
    expect(firstCallKeyHolder.key).toBe(keyBeforeReload);
  });
});
