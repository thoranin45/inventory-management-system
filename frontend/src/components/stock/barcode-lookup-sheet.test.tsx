import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

let role = "warehouse";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/components/work/use-beep", () => ({
  useBeep: () => ({ beepOk: vi.fn(), beepBad: vi.fn(), beepDone: vi.fn(), enabled: false, setEnabled: vi.fn() }),
}));

// The camera dialog itself is a business-neutral, already-tested component;
// stub it down to a button that immediately "decodes" a fixed code so this
// suite can drive the lookup/onboarding logic instead of camera internals.
let decodedCode = "8850000000XX";
vi.mock("@/components/work/camera-barcode-scanner", () => ({
  CameraBarcodeScanner: ({ open, onDecode }: { open: boolean; onDecode: (v: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onDecode(decodedCode)}>
        fake-camera-decode
      </button>
    ) : null,
}));

const resolveBarcode = vi.fn();
vi.mock("@/lib/query/sales", () => ({ resolveBarcode: (...a: unknown[]) => resolveBarcode(...a) }));

let createDrawerProps: { open: boolean; initialBarcode?: string; onCreated: (p: unknown) => void } | null = null;
vi.mock("@/components/products/create-product", () => ({
  CreateProductDrawer: (props: { open: boolean; initialBarcode?: string; onCreated: (p: unknown) => void }) => {
    createDrawerProps = props;
    return props.open ? (
      <button
        type="button"
        onClick={() =>
          props.onCreated({ id: 99, sku: "NEW-SKU", product_name: "Freshly Created", barcode: decodedCode, is_active: true })
        }
      >
        fake-create-submit
      </button>
    ) : null;
  },
}));

import { StockScanButton } from "./barcode-lookup-sheet";

beforeEach(() => {
  role = "warehouse";
  push.mockReset();
  resolveBarcode.mockReset();
  createDrawerProps = null;
  decodedCode = "8850000000XX";
});

async function scan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /scan barcode/i }));
  await user.click(await screen.findByRole("button", { name: /fake-camera-decode/i }));
}

describe("StockScanButton — lookup only, never mutates stock", () => {
  it("found: shows product, SKU, barcode, available and status; never calls a stock mutation", async () => {
    resolveBarcode.mockResolvedValueOnce({
      barcode: "8850000000XX",
      context: "lookup",
      product: {
        id: 1,
        sku: "MILK-001",
        product_name: "Fresh Milk 1L",
        track_batch: false,
        track_expiry: false,
        operational_available_quantity: "125.000",
        minimum_stock: "10.000",
        safety_stock: "0",
      },
      batches: [],
    });
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);

    expect(await screen.findByText("พบสินค้า")).toBeInTheDocument();
    expect(screen.getByText("Fresh Milk 1L")).toBeInTheDocument();
    expect(screen.getByText("MILK-001")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
    expect(resolveBarcode).toHaveBeenCalledWith("8850000000XX", "lookup");
    expect(resolveBarcode).toHaveBeenCalledTimes(1);
  });

  it("found → [Stock In] navigates to /stock-in?product=<id> instead of mutating anything", async () => {
    resolveBarcode.mockResolvedValueOnce({
      barcode: "8850000000XX",
      context: "lookup",
      product: {
        id: 42,
        sku: "MILK-001",
        product_name: "Fresh Milk 1L",
        track_batch: false,
        track_expiry: false,
        operational_available_quantity: "125.000",
      },
      batches: [],
    });
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByRole("button", { name: /^stock in$/i }));
    expect(push).toHaveBeenCalledWith("/stock-in?product=42");
  });

  it("found → [ดูรายละเอียด] hands the scanned barcode back to the caller instead of guessing a Product row", async () => {
    resolveBarcode.mockResolvedValueOnce({
      barcode: "8850000000XX",
      context: "lookup",
      product: { id: 1, sku: "MILK-001", product_name: "Fresh Milk 1L", track_batch: false, track_expiry: false, operational_available_quantity: "125" },
      batches: [],
    });
    const onOpenDetail = vi.fn();
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={onOpenDetail} />);
    await scan(user);
    await user.click(await screen.findByRole("button", { name: /ดูรายละเอียด/i }));
    expect(onOpenDetail).toHaveBeenCalledWith("8850000000XX");
  });

  it("unknown barcode (404): decoded successfully but Product Master has no match — distinct copy, no mutation", async () => {
    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);

    expect(await screen.findByText(/อ่าน Barcode สำเร็จ แต่ยังไม่มีสินค้านี้ในระบบ/)).toBeInTheDocument();
    expect(screen.getByText("8850000000XX")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("unknown barcode + warehouse role (no product:create): shows the admin-required copy, not a create button", async () => {
    role = "warehouse";
    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);

    await screen.findByText(/ยังไม่มีสินค้านี้ในระบบ/);
    expect(screen.getByText("กรุณาให้ Admin เพิ่มสินค้า")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /สร้างสินค้าใหม่/i })).not.toBeInTheDocument();
  });

  it("unknown barcode + admin role: [สร้างสินค้าใหม่] opens Create Product pre-filled with the scanned barcode", async () => {
    role = "admin";
    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);

    await user.click(await screen.findByRole("button", { name: /สร้างสินค้าใหม่/i }));
    expect(createDrawerProps?.open).toBe(true);
    expect(createDrawerProps?.initialBarcode).toBe("8850000000XX");
  });

  it("after Product Master creation succeeds, offers [นำเข้าสินค้า] rather than silently stocking it in", async () => {
    role = "admin";
    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByRole("button", { name: /สร้างสินค้าใหม่/i }));
    await user.click(await screen.findByRole("button", { name: /fake-create-submit/i }));

    expect(await screen.findByText("สร้างสินค้าเรียบร้อยแล้ว")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); // creation alone never navigates or mutates stock
    await user.click(screen.getByRole("button", { name: /นำเข้าสินค้า/i }));
    expect(push).toHaveBeenCalledWith("/stock-in?product=99");
  });

  it("a non-404 lookup failure gets its own message, distinct from 'unknown barcode'", async () => {
    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 500, message: "boom" }));
    const user = userEvent.setup();
    render(<StockScanButton onOpenDetail={vi.fn()} />);
    await scan(user);

    expect(await screen.findByText(/เกิดข้อผิดพลาด/)).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่มีสินค้านี้ในระบบ/)).not.toBeInTheDocument();
  });
});
