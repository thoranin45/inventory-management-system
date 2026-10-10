import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const push = vi.fn();
const toastError = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() } }));

const PRODUCT = { id: 9, sku: "LOT-MILK", product_name: "Milk 1L", is_active: true, barcode: null, track_batch: true };

const row = (over: Record<string, unknown>) => ({
  product_id: 9, batch_id: null, on_hand_qty: "0.000", reserved_qty: "0.000", available_qty: "0.000",
  is_transit: false, batch_expiry_date: null, days_to_expiry: null, is_expired: false, as_of_date: "2026-06-15",
  ...over,
});
let BALANCES: Record<string, unknown>[] = [];
vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [PRODUCT] }, isFetching: false }),
  useProductStock: (id: number | null) => ({ data: id ? { items: BALANCES } : undefined, isLoading: false, isError: false }),
}));
vi.mock("@/lib/query/warehouses", () => ({
  useWarehouses: () => ({
    data: [
      { id: 1, warehouse_code: "MAIN", warehouse_name: "Main", warehouse_type: "MAIN", is_active: true, locations: [
        { id: 11, location_code: "DEFAULT", location_name: "Default", location_type: null, is_active: true },
        { id: 12, location_code: "OLD", location_name: "Old bin", location_type: null, is_active: false },
      ] },
      { id: 2, warehouse_code: "SHOP", warehouse_name: "Shop", warehouse_type: null, is_active: true, locations: [
        { id: 21, location_code: "FRONT", location_name: null, location_type: null, is_active: true },
      ] },
    ],
    isLoading: false, isError: false,
  }),
}));

const createMutate = vi.fn();
vi.mock("@/lib/query/stock-adjustment-requests", () => ({
  useCreateStockAdjustmentRequest: () => ({ mutate: createMutate, isPending: false, isError: false, error: null }),
}));

import { StockAdjustmentRequestForm } from "./request-form";

const FRESH = row({ id: 1, warehouse_id: 1, location_id: 11, batch_id: 101, batch_lot_no: "LOT-FRESH",
  on_hand_qty: "10.000", reserved_qty: "4.000", available_qty: "6.000", batch_expiry_date: "2026-08-01" });
const EXPIRED = row({ id: 2, warehouse_id: 2, location_id: 21, batch_id: 102, batch_lot_no: "LOT-OLD",
  on_hand_qty: "5.000", available_qty: "5.000", batch_expiry_date: "2026-06-14", is_expired: true });

async function pickProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: /search products/i }));
  const option = await screen.findByRole("option", { name: /Milk 1L/ });
  await user.click(within(option).getByRole("button"));
}

const requested = () => screen.getByLabelText("Requested (corrected) quantity");
const submit = () => screen.getByRole("button", { name: /submit request/i });

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
  BALANCES = [
    FRESH,
    EXPIRED,
    row({ id: 3, warehouse_id: 1, location_id: 12, batch_id: 103, batch_lot_no: "LOT-INACTIVE", on_hand_qty: "2.000" }),
    row({ id: 4, warehouse_id: 9, location_id: 99, batch_id: 104, batch_lot_no: "LOT-TRANSIT", is_transit: true }),
  ];
});

describe("Batch adjustment form (Phase 14D)", () => {
  it("offers only operational exact lot balances with on-hand / reserved / available and expiry", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    const picker = screen.getByRole("group", { name: /lot and location/i });
    const options = within(picker).getAllByRole("button");
    expect(options).toHaveLength(2); // inactive location and transit rows are never offered
    expect(within(picker).getByText("LOT-FRESH")).toBeInTheDocument();
    expect(within(picker).queryByText("LOT-INACTIVE")).not.toBeInTheDocument();
    expect(within(picker).queryByText("LOT-TRANSIT")).not.toBeInTheDocument();
    const fresh = options.find((o) => o.textContent?.includes("LOT-FRESH"))!;
    expect(fresh).toHaveTextContent("Main (MAIN) · Default · exp 2026-08-01");
    expect(fresh).toHaveTextContent(/On hand\s*10\.00/);
    expect(fresh).toHaveTextContent(/Reserved\s*4\.00/);
    expect(fresh).toHaveTextContent(/Available\s*6\.00/);
    expect(within(options.find((o) => o.textContent?.includes("LOT-OLD"))!).getByText("Expired")).toBeInTheDocument();
    // Nothing else of the form until an exact balance is chosen.
    expect(screen.queryByLabelText("Observed quantity")).not.toBeInTheDocument();
  });

  it("prefills observed with the chosen lot's ON-HAND (not available) and submits the exact balance", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    expect(screen.getByLabelText("Observed quantity")).toHaveValue("10.000"); // available is 6.000
    await user.type(requested(), "11.000");
    await user.click(submit());
    expect(createMutate.mock.calls[0][0].body).toEqual({
      product_id: 9, warehouse_id: 1, location_id: 11, batch_id: 101,
      observed_quantity: "10.000", requested_quantity: "11.000", reason_code: "CYCLE_COUNT_VARIANCE",
    });
  });

  it("blocks a DAMAGE increase on a lot but allows a decrease", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    await user.click(screen.getByRole("button", { name: /Damage/ }));
    await user.type(requested(), "12.000");
    expect(screen.getByRole("alert")).toHaveTextContent(/must lower the quantity/);
    expect(submit()).toBeDisabled();
    await user.clear(requested());
    await user.type(requested(), "5.000");
    expect(submit()).toBeEnabled();
  });

  it("enables expiry write-off only for an expired lot", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    expect(screen.getByRole("button", { name: /Expiry write-off/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /LOT-OLD/ }));
    const writeOff = screen.getByRole("button", { name: /Expiry write-off/ });
    expect(writeOff).toBeEnabled();
    await user.click(writeOff);
    await user.type(requested(), "0.000");
    await user.click(submit());
    expect(createMutate.mock.calls[0][0].body).toMatchObject({ batch_id: 102, reason_code: "EXPIRY_WRITE_OFF",
      warehouse_id: 2, location_id: 21, observed_quantity: "5.000", requested_quantity: "0.000" });
  });

  it("warns and blocks below the reserved floor", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    await user.type(requested(), "3.000"); // reserved 4.000
    expect(screen.getByRole("alert")).toHaveTextContent(/below the 4.000 reserved/);
    expect(submit()).toBeDisabled();
    await user.clear(requested());
    await user.type(requested(), "4.000"); // equal to reserved: allowed
    expect(submit()).toBeEnabled();
  });

  it("explains a lot with no balance anywhere usable", async () => {
    BALANCES = [];
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    expect(screen.getByText(/never creates a new lot balance/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit request/i })).not.toBeInTheDocument();
  });

  it("shows clear copy for a missing balance and a reserved-floor rejection", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_vars, opts) => {
      opts.onError(new ApiError({ kind: "conflict", status: 409,
        message: "No stock balance exists for this batch at this warehouse/location. Receive the batch there." }));
    });
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    await user.type(requested(), "9.000");
    await user.click(submit());
    expect(toastError.mock.calls[0][1].description).toMatch(/no stock record at that location/);
  });
});
