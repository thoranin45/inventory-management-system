import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const push = vi.fn();
const toastError = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() } }));

const PRODUCT = { id: 9, sku: "LOT-MILK", product_name: "Milk 1L", is_active: true, barcode: null, track_batch: true };
const PRODUCT_B = { id: 10, sku: "LOT-YOG", product_name: "Yogurt", is_active: true, barcode: null, track_batch: true };

const row = (over: Record<string, unknown>) => ({
  product_id: 9, batch_id: null, on_hand_qty: "0.000", reserved_qty: "0.000", available_qty: "0.000",
  is_transit: false, batch_expiry_date: null, days_to_expiry: null, is_expired: false, as_of_date: "2026-06-15",
  ...over,
});
let BALANCES: Record<string, unknown>[] = [];
let STOCK_ERROR = false;
/** A background refetch of already-loaded balances: still running, or failed. */
let REFETCH: "fetching" | "error" | null = null;
const refetch = vi.fn();
vi.mock("@/lib/query/hooks", () => ({
  useProducts: () => ({ data: { items: [PRODUCT, PRODUCT_B] }, isFetching: false }),
  useAllProductStock: (id: number | null) =>
    STOCK_ERROR
      ? { data: undefined, isLoading: false, isError: true, isFetching: false, refetch }
      : {
          data: id ? { items: BALANCES.filter((b) => b.product_id === id) } : undefined,
          isLoading: false,
          isError: REFETCH === "error",
          isFetching: REFETCH === "fetching",
          refetch,
        },
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
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
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

async function pickProduct(user: ReturnType<typeof userEvent.setup>, name: RegExp = /Milk 1L/) {
  await user.click(screen.getByRole("combobox", { name: /search products/i }));
  const option = await screen.findByRole("option", { name });
  await user.click(within(option).getByRole("button"));
}

const requested = () => screen.getByLabelText("Requested (corrected) quantity");
const submit = () => screen.getByRole("button", { name: /submit request/i });

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
  STOCK_ERROR = false;
  REFETCH = null;
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

  it("offers every eligible lot beyond the first 50 balances and lets a later-page lot be picked", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      row({ id: 1000 + i, warehouse_id: 2, location_id: 21, batch_id: 2000 + i,
        batch_lot_no: `LOT-${String(i).padStart(3, "0")}`, on_hand_qty: `${i + 1}.000`, available_qty: `${i + 1}.000` }),
    );
    BALANCES = [
      ...many,
      row({ id: 5, warehouse_id: 1, location_id: 12, batch_id: 105, batch_lot_no: "LOT-INACTIVE" }),
      row({ id: 6, warehouse_id: 9, location_id: 99, batch_id: 106, batch_lot_no: "LOT-TRANSIT", is_transit: true }),
      row({ id: 7, warehouse_id: 1, location_id: 11, batch_id: null }), // unbatched
    ];
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    const picker = screen.getByRole("group", { name: /lot and location/i });
    expect(within(picker).getAllByRole("button")).toHaveLength(60);
    expect(within(picker).queryByText("LOT-INACTIVE")).not.toBeInTheDocument();
    expect(within(picker).queryByText("LOT-TRANSIT")).not.toBeInTheDocument();
    await user.click(within(picker).getByText("LOT-055").closest("button")!); // beyond the old 50-row page
    expect(screen.getByLabelText("Observed quantity")).toHaveValue("56.000"); // B2 on-hand prefill
    await user.type(requested(), "50");
    await user.click(submit());
    expect(createMutate.mock.calls[0][0].body).toMatchObject({ warehouse_id: 2, location_id: 21, batch_id: 2055 });
  }, 15_000);

  it("shows a visible error (no partial lot list) when the balances cannot be fully loaded", async () => {
    STOCK_ERROR = true;
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    expect(screen.getByRole("alert")).toHaveTextContent(/load this product.s lots/);
    expect(screen.queryByRole("group", { name: /lot and location/i })).not.toBeInTheDocument();
  });

  it.each([
    ["abc", "Quantity must be a number"],
    ["5.", "Quantity must be a number"],
    ["-1", "Quantity must be a number"],
    ["5.1234", "At most 3 decimal places"],
  ])("DAMAGE on a lot with requested %j shows the quantity message instead of crashing", async (text, message) => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    await user.click(screen.getByRole("button", { name: /Damage/ }));
    await user.type(requested(), text);
    expect(screen.getByRole("alert")).toHaveTextContent(`Requested: ${message}`);
    expect(submit()).toBeDisabled();
  });

  it("shows the quantity message for invalid observed text on a lot", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestForm />);
    await pickProduct(user);
    await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
    await user.click(screen.getByRole("button", { name: /Damage/ }));
    await user.type(requested(), "5.000");
    const observed = screen.getByLabelText("Observed quantity");
    await user.clear(observed);
    await user.type(observed, "ten");
    expect(screen.getByRole("alert")).toHaveTextContent("Observed: Quantity must be a number");
    expect(submit()).toBeDisabled();
  });

  describe("stale or unverified lot selection", () => {
    /** Pick LOT-FRESH (on hand 10.000, reserved 4.000) and type a valid decrease. */
    async function pickFreshReady(user: ReturnType<typeof userEvent.setup>) {
      await pickProduct(user);
      await user.click(screen.getByRole("button", { name: /LOT-FRESH/ }));
      await user.type(requested(), "8.000");
      expect(submit()).toBeEnabled();
    }
    const replaceFresh = (over: Record<string, unknown>) => {
      BALANCES = BALANCES.map((b) => (b.id === 1 ? { ...b, ...over } : b));
    };

    it("disables Submit while the balance refetch is running", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      REFETCH = "fetching";
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      expect(screen.getByText(/Checking the latest balance/)).toBeInTheDocument();
    });

    it("disables Submit when the balance refetch fails and offers a refresh", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      REFETCH = "error";
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      await user.click(screen.getByRole("button", { name: /Refresh balance/ }));
      expect(refetch).toHaveBeenCalled();
      await user.click(submit());
      expect(createMutate).not.toHaveBeenCalled();
    });

    it("keeps Submit enabled after a refresh that returns the same balance", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      REFETCH = "fetching";
      rerender(<StockAdjustmentRequestForm />);
      REFETCH = null;
      BALANCES = BALANCES.map((b) => ({ ...b })); // fresh objects, identical values
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("disables Submit when the selected balance disappears after a refresh", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      BALANCES = BALANCES.filter((b) => b.id !== 1);
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/no longer available at that location/);
    });

    it.each([
      ["moves to an inactive location", { location_id: 12 }],
      ["becomes transit", { is_transit: true }],
      ["is reported for a different batch", { batch_id: 999 }],
    ])("disables Submit when the selected balance %s", async (_label, over) => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      replaceFresh(over);
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/Pick a lot again/);
    });

    it("requires using the refreshed balance when on-hand changed, then re-prefills observed", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      replaceFresh({ on_hand_qty: "12.000", available_qty: "8.000" });
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/balance changed since you picked it \(now on hand 12.000/);
      expect(screen.getByLabelText("Observed quantity")).toHaveValue("10.000"); // never silently rewritten
      await user.click(screen.getByRole("button", { name: /Use refreshed balance/ }));
      expect(screen.getByLabelText("Observed quantity")).toHaveValue("12.000");
      expect(submit()).toBeEnabled();
      await user.click(submit());
      expect(createMutate.mock.calls[0][0].body).toMatchObject({
        batch_id: 101, observed_quantity: "12.000", requested_quantity: "8.000",
      });
    });

    it("treats a reserved change as a changed balance too", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      replaceFresh({ reserved_qty: "9.000", available_qty: "1.000" });
      rerender(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      await user.click(screen.getByRole("button", { name: /Use refreshed balance/ }));
      // The refreshed 9.000 reservation now trips the reserved floor for 8.000.
      expect(screen.getByRole("alert")).toHaveTextContent(/below the 9.000 reserved/);
      expect(submit()).toBeDisabled();
    });

    it("disables Submit for a restored draft whose balance changed or vanished", async () => {
      const user = userEvent.setup();
      const first = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      first.unmount();

      replaceFresh({ on_hand_qty: "7.000" });
      const second = render(<StockAdjustmentRequestForm />);
      expect(screen.getByLabelText("Observed quantity")).toHaveValue("10.000");
      expect(submit()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/balance changed since you picked it/);
      second.unmount();

      BALANCES = BALANCES.filter((b) => b.id !== 1);
      render(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/no longer available/);
    });

    it("restores a still-valid draft as submittable", async () => {
      const user = userEvent.setup();
      const first = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      first.unmount();
      render(<StockAdjustmentRequestForm />);
      expect(submit()).toBeEnabled();
    });

    it("disables Submit for a draft saved before the picked on-hand was recorded", async () => {
      const user = userEvent.setup();
      const first = render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      first.unmount();
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i)!;
        let raw: { lines?: Record<number, Record<string, unknown>> } | null = null;
        try {
          raw = JSON.parse(window.sessionStorage.getItem(key)!);
        } catch {
          continue; // not a draft record
        }
        if (raw?.lines?.[0]) {
          delete raw.lines[0].pickedOnHand;
          window.sessionStorage.setItem(key, JSON.stringify(raw));
        }
      }
      render(<StockAdjustmentRequestForm />);
      expect(submit()).toBeDisabled();
      expect(screen.getByRole("button", { name: /Use refreshed balance/ })).toBeInTheDocument();
    });

    it("never reuses the previous product's selection after switching products", async () => {
      // Same warehouse/location/batch ids under a different product.
      BALANCES = [...BALANCES, row({ id: 50, product_id: 10, warehouse_id: 1, location_id: 11, batch_id: 101,
        batch_lot_no: "YOG-1", on_hand_qty: "3.000", available_qty: "3.000" })];
      const user = userEvent.setup();
      render(<StockAdjustmentRequestForm />);
      await pickFreshReady(user);
      await user.click(screen.getByText("Milk 1L").closest("button")!); // reopen the product picker
      await pickProduct(user, /Yogurt/);
      const picker = screen.getByRole("group", { name: /lot and location/i });
      expect(within(picker).getAllByRole("button")).toHaveLength(1);
      expect(within(picker).getByRole("button", { name: /YOG-1/ })).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByLabelText("Observed quantity")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /submit request/i })).not.toBeInTheDocument();
    });
  });
});
