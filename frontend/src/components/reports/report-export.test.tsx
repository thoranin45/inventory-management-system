import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { ApiError } from "@/lib/api/errors";

const { bffBinary, saveBlob, toast } = vi.hoisted(() => ({
  bffBinary: vi.fn(),
  saveBlob: vi.fn(),
  toast: { loading: vi.fn(() => "t1"), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api/binary", () => ({ bffBinary, saveBlob }));
vi.mock("sonner", () => ({ toast }));

import { useReportExport } from "@/lib/query/reports";

beforeEach(() => {
  bffBinary.mockReset();
  saveBlob.mockReset();
  toast.loading.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("useReportExport", () => {
  it("fetches the XLSX, saves it with the Content-Disposition filename, and toasts success", async () => {
    bffBinary.mockResolvedValue({ blob: new Blob(["x"]), filename: "stock_report.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const { result } = renderHook(() => useReportExport());
    await act(async () => {
      await result.current.run("/api/bff/reports/export/stock");
    });
    expect(bffBinary).toHaveBeenCalledWith("/api/bff/reports/export/stock");
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "stock_report.xlsx");
    expect(toast.success).toHaveBeenCalled();
  });

  it("appends query params to the export URL", async () => {
    bffBinary.mockResolvedValue({ blob: new Blob(), filename: "low_stock_report.xlsx", contentType: "x" });
    const { result } = renderHook(() => useReportExport());
    await act(async () => {
      await result.current.run("/api/bff/reports/export/low-stock", { threshold: "25" });
    });
    expect(bffBinary).toHaveBeenCalledWith("/api/bff/reports/export/low-stock?threshold=25");
  });

  it("shows the 400 row-cap message with the Request ID and never saves a file", async () => {
    bffBinary.mockRejectedValue(
      new ApiError({ status: 400, message: "Export too large (73210 rows > 50000); narrow the filters and retry", requestId: "req-cap" }),
    );
    const { result } = renderHook(() => useReportExport());
    await act(async () => {
      await result.current.run("/api/bff/reports/export/sales");
    });
    expect(saveBlob).not.toHaveBeenCalled();
    const desc = toast.error.mock.calls[0][1].description as string;
    expect(desc).toMatch(/too large/i);
    expect(desc).toMatch(/req-cap/);
  });
});
