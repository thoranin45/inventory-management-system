import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";
import { productDetailResponse } from "@/test/fixtures";

const uploadMut = { mutate: vi.fn(), isPending: false };
vi.mock("@/lib/query/products", () => ({ useUploadProductImage: () => uploadMut }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProductImagePanel } from "./product-image";

if (!URL.createObjectURL) {
  // jsdom has no object URLs
  Object.assign(URL, { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} });
}

const product = { ...productDetailResponse.data, image_url: null as string | null };

function file(type: string, size: number, name = "pic") {
  const f = new File([new Uint8Array(Math.min(size, 8))], `${name}.${type.split("/")[1]}`, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

beforeEach(() => {
  uploadMut.mutate.mockReset();
  uploadMut.isPending = false;
});

describe("ProductImagePanel", () => {
  it("rejects an oversized file client-side before any upload", async () => {
    render(<ProductImagePanel product={product} canEdit />);
    await userEvent.upload(screen.getByLabelText(/choose a product image/i), file("image/png", 6 * 1024 * 1024));
    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(uploadMut.mutate).not.toHaveBeenCalled();
  });

  it("rejects an unsupported type client-side", async () => {
    render(<ProductImagePanel product={product} canEdit />);
    await userEvent.upload(screen.getByLabelText(/choose a product image/i), file("image/gif", 1000));
    expect(await screen.findByText(/JPEG, PNG or WebP/i)).toBeInTheDocument();
    expect(uploadMut.mutate).not.toHaveBeenCalled();
  });

  it("uploads a valid file and shows the busy state", async () => {
    render(<ProductImagePanel product={product} canEdit />);
    await userEvent.upload(screen.getByLabelText(/choose a product image/i), file("image/jpeg", 2000));
    await waitFor(() => expect(uploadMut.mutate).toHaveBeenCalled());
    expect(uploadMut.mutate.mock.calls[0][0]).toMatchObject({ id: 6 });
  });

  it("shows 'Image is too large' on a 413 and the Request ID", async () => {
    uploadMut.mutate.mockImplementation((_a, { onError }) =>
      onError(new ApiError({ status: 413, message: "Image exceeds the 5242880 byte limit", requestId: "req-413" })),
    );
    render(<ProductImagePanel product={product} canEdit />);
    await userEvent.upload(screen.getByLabelText(/choose a product image/i), file("image/png", 4000));
    expect(await screen.findByText(/image is too large/i)).toBeInTheDocument();
    expect(screen.getByText("req-413")).toBeInTheDocument();
  });

  it("shows the backend message + Request ID on an invalid image", async () => {
    uploadMut.mutate.mockImplementation((_a, { onError }) =>
      onError(new ApiError({ status: 400, message: "File is not a valid image", requestId: "req-bad-img" })),
    );
    render(<ProductImagePanel product={product} canEdit />);
    await userEvent.upload(screen.getByLabelText(/choose a product image/i), file("image/png", 4000));
    expect(await screen.findByText(/isn't a valid JPEG, PNG or WebP image/i)).toBeInTheDocument();
    expect(screen.getByText("req-bad-img")).toBeInTheDocument();
  });

  it("hides the upload control from non-admins", () => {
    render(<ProductImagePanel product={product} canEdit={false} />);
    expect(screen.queryByLabelText(/choose a product image/i)).not.toBeInTheDocument();
  });
});
