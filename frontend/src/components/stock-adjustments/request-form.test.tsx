import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PRODUCT = {
  id: 5, sku: "WH-COFFEE", product_name: "Coffee 1kg", is_active: true, barcode: "880000000005", track_batch: false,
};

// Phase 14D B2: the non-batch prefill reads the unbatched MAIN/DEFAULT balance.
// on_hand (10) and available (7) deliberately differ: 3 are reserved.
const DEFAULT_BALANCE = {
  id: 1, product_id: 5, warehouse_id: 1, location_id: 11, batch_id: null, on_hand_qty: "10.000",
  reserved_qty: "3.000", available_qty: "7.000", is_transit: false, batch_expiry_date: null,
  days_to_expiry: null, is_expired: false, as_of_date: "2026-06-15",
};
vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [PRODUCT] }, isFetching: false }),
  useAllProductStock: (id: number | null) => ({
    data: id ? { items: [DEFAULT_BALANCE] } : undefined, isLoading: false, isError: false,
  }),
}));
vi.mock("@/lib/query/warehouses", () => ({
  useWarehouses: () => ({
    data: [{ id: 1, warehouse_code: "MAIN", warehouse_name: "Main", warehouse_type: "MAIN", is_active: true,
      locations: [{ id: 11, location_code: "DEFAULT", location_name: "Default", location_type: null, is_active: true }] }],
    isLoading: false, isError: false,
  }),
}));

const createMutate = vi.fn();
let createState = { isPending: false, isError: false, error: null as unknown };
vi.mock("@/lib/query/stock-adjustment-requests", () => ({
  useCreateStockAdjustmentRequest: () => ({ mutate: createMutate, ...createState }),
}));

import { StockAdjustmentRequestForm } from "./request-form";
import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";

async function pickProduct(user: ReturnType<typeof userEvent.setup>) {
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
  it("prefills observed quantity from ON-HAND, not available, once a product is picked (B2)", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    const observed = await screen.findByLabelText("Observed quantity");
    expect(observed).toHaveValue("10.000"); // on-hand; available would be 7.000
  });

  it("sends no batch or storage fields for a non-batch product (legacy body)", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "12.000");
    await user.click(screen.getByRole("button", { name: /Damage/ })); // a non-batch DAMAGE increase stays valid (B1)
    await user.click(screen.getByRole("button", { name: /submit request/i }));
    expect(createMutate.mock.calls[0][0].body).toEqual({
      product_id: 5, observed_quantity: "10.000", requested_quantity: "12.000", reason_code: "DAMAGE",
    });
    expect(screen.queryByRole("button", { name: /Expiry write-off/ })).not.toBeInTheDocument();
  });

  it("disables submit until requested quantity and reason are valid", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Requested (corrected) quantity"), "8.000");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("shows the quantity message for invalid text without crashing and keeps a non-batch DAMAGE increase valid", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /Damage/ }));
    const requested = screen.getByLabelText("Requested (corrected) quantity");
    await user.type(requested, "abc");
    expect(screen.getByRole("alert")).toHaveTextContent("Requested: Quantity must be a number");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    await user.clear(requested);
    await user.type(requested, "12.000"); // non-batch: no decrease-only rule
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
      opts.onError(new ApiError({ kind: "conflict", status: 409, message: "Idempotency-Key already used with a different payload" }));
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

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("StockAdjustmentRequestForm — characterization (R3.0)", () => {
  const requested = () => screen.getByLabelText("Requested (corrected) quantity");
  const submitButton = () => screen.getByRole("button", { name: /submit request/i });
  const MISMATCH = "Idempotency-Key already used with a different payload";

  it("exact mutate arguments: trimmed note, key prefix adjreq-", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(requested(), "8.5");
    await user.type(screen.getByPlaceholderText(/counted 38/), "  recount  ");
    await user.click(submitButton());
    expect(createMutate.mock.calls[0][0]).toEqual({
      body: { product_id: 5, observed_quantity: "10.000", requested_quantity: "8.5", reason_code: "CYCLE_COUNT_VARIANCE", notes: "recount" },
      idempotencyKey: expect.stringMatching(/^adjreq-/),
    });
  });

  it("shows the difference with 3 decimals (display only)", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(requested(), "9.9");
    expect(screen.getByText("(-0.100)")).toBeInTheDocument();
  });

  it("non-batch: a request below the reserved quantity warns but stays submittable (batch requests are blocked instead)", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(requested(), "2");
    expect(screen.getByRole("alert")).toHaveTextContent(/below the 3.000 reserved/i);
    expect(submitButton()).toBeEnabled();
  });

  it("the mismatch predicate is 409 + /different payload/i; another status is a normal failure that keeps the key", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementationOnce((_v, opts) => opts.onError(new ApiError({ status: 422, message: MISMATCH })));
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(requested(), "8");
    await user.click(submitButton());
    expect(screen.queryByText(/can no longer be submitted/i)).not.toBeInTheDocument();
    createMutate.mockImplementationOnce((_v, opts) => opts.onError(new ApiError({ status: 409, message: "a DIFFERENT PAYLOAD" })));
    await user.click(submitButton());
    expect(await screen.findByText(/can no longer be submitted/i)).toBeInTheDocument();
    expect(createMutate.mock.calls[1][0]).toEqual(createMutate.mock.calls[0][0]);
  });

  it("mismatch recovery 'Start new request' clears the form and the next submit uses a NEW key", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementationOnce((_v, opts) => opts.onError(new ApiError({ status: 409, message: MISMATCH })));
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(requested(), "8");
    await user.click(submitButton());
    const k1 = createMutate.mock.calls[0][0].idempotencyKey;
    await user.click(await screen.findByRole("button", { name: /start new request/i }));
    expect(screen.queryByLabelText("Requested (corrected) quantity")).not.toBeInTheDocument(); // product cleared
    await pickProduct(user);
    await user.type(requested(), "8");
    await user.click(submitButton());
    expect(createMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
  });

  it("Submit is disabled and inert while a submission is pending", async () => {
    const user = userEvent.setup();
    createState = { ...createState, isPending: true };
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.type(requested(), "8");
    const pending = screen.getByRole("button", { name: /submitting…/i });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("a language switch keeps the draft and key and sends no business request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <LanguageProvider initialLocale="th">
          <LanguageSwitch />
          <StockAdjustmentRequestForm />
        </LanguageProvider>,
      );
      await pickProduct(user);
      await user.type(requested(), "8");
      const input = requested();
      await user.click(screen.getByRole("button", { name: "EN" }));
      await user.click(screen.getByRole("button", { name: "ไทย" }));
      expect(requested()).toBe(input);
      expect(input).toHaveValue("8");
      expect(createMutate).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.every((c) => (c as unknown[])[0] === "/api/prefs/language")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
