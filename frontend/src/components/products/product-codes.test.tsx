import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const bffBinary = vi.fn();
vi.mock("@/lib/api/binary", () => ({ bffBinary: (...a: unknown[]) => bffBinary(...a) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import { ProductCodes } from "./product-codes";

if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} });
window.open = vi.fn();

beforeEach(() => {
  bffBinary.mockReset().mockResolvedValue({ blob: new Blob(["x"]), contentType: "image/png" });
  toastError.mockReset();
});

describe("ProductCodes", () => {
  it("offers barcode / QR / label and never draws codes itself", () => {
    render(<ProductCodes productId={1} hasBarcode />);
    expect(screen.getByRole("button", { name: /view barcode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view qr/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open label/i })).toBeInTheDocument();
  });

  it("disables the barcode button when the product has no barcode", () => {
    render(<ProductCodes productId={1} hasBarcode={false} />);
    expect(screen.getByRole("button", { name: /view barcode/i })).toBeDisabled();
  });

  it("fetches the QR PNG through the binary BFF helper and previews it", async () => {
    render(<ProductCodes productId={42} hasBarcode />);
    await userEvent.click(screen.getByRole("button", { name: /view qr/i }));
    await waitFor(() => expect(bffBinary).toHaveBeenCalledWith("/api/bff/codes/products/42/qrcode"));
    expect(await screen.findByRole("img", { name: /product qr code/i })).toBeInTheDocument();
  });

  it("opens the label PDF in a new tab", async () => {
    render(<ProductCodes productId={7} hasBarcode />);
    await userEvent.click(screen.getByRole("button", { name: /open label/i }));
    await waitFor(() => expect(bffBinary).toHaveBeenCalledWith("/api/bff/labels/product/7"));
    expect(window.open).toHaveBeenCalled();
  });

  it("toasts a friendly message when the barcode endpoint 404s", async () => {
    bffBinary.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product has no barcode", requestId: "req-404" }));
    render(<ProductCodes productId={1} hasBarcode />);
    await userEvent.click(screen.getByRole("button", { name: /view barcode/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][1].description).toMatch(/no barcode yet|req-404/i);
  });
});
