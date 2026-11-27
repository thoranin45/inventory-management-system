import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/invoices",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role: "admin" } }) }));

const invRow = {
  id: 5, invoice_number: "INV-2026-0001", status: "ISSUED", is_overdue: false, sales_order_id: 63,
  sales_order_number: "SO-000063", customer_id: 3, customer_name: "ร้านลูกค้าดี", issue_date: "2026-11-27",
  due_date: "2026-12-27", credit_days: 30, grand_total: "700.00", adjusted_total: "0.00", balance: "700.00",
  payment_status: "UNPAID", paid_total: "0.00", created_at: null, updated_at: null,
};
const invRow2 = { ...invRow, id: 6, invoice_number: "INV-2026-0002", balance: "250.00", payment_status: "PARTIAL" };
const invDetail = (over: Record<string, unknown> = {}) => ({
  ...invRow, quotation_id: null, quotation_number: null, notes: null,
  customer_snapshot: { name: "ร้านลูกค้าดี" }, seller_snapshot: { vat_registered: false },
  subtotal: "700.00", discount_total: "0.00", vat_base: "700.00", vat_amount: "0.00",
  void_reason: null, issued_at: null, voided_at: null,
  items: [{ id: 11, line_no: 1, product_id: 8, description: "ถุงมือ", quantity: "1.000", unit_price: "700.00",
    discount_amount: "0.00", line_total: "700.00", adjusted_amount: "0.00" }],
  adjustments: [], return_receipts: [], payments: [],
  ...over,
});
let invoice = invDetail();
const page = <T,>(items: T[]) => ({
  data: { items, pagination: { page: 1, page_size: 20, total_items: items.length, total_pages: 1 } },
  isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn(),
});
const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: undefined });
const recordMut = mut();
const voidMut = mut();
const saveBillingMut = mut();
const exportRun = vi.fn();

vi.mock("@/lib/query/invoices", () => ({
  useInvoices: () => page([invRow, invRow2]),
  useInvoice: () => ({ data: invoice, isLoading: false, isError: false, refetch: vi.fn() }),
  useRevenueSummary: () => ({ data: undefined }),
  useInvoiceAction: () => mut(),
  useDeleteInvoiceDraft: () => mut(),
  useSaveInvoiceDraft: () => mut(),
  openInvoicePdf: vi.fn(),
  useAdjustment: () => ({ data: undefined, isLoading: true }),
  useAdjustmentAction: () => mut(),
  useDeleteAdjustmentDraft: () => mut(),
  useSaveAdjustmentDraft: () => mut(),
  openAdjustmentPdf: vi.fn(),
}));

const receipt = {
  id: 9, receipt_number: "RC-2026-0001", status: "ISSUED", customer_id: 3, customer_name: "ร้านลูกค้าดี",
  received_date: "2026-11-27", method: "TRANSFER", reference: "KBANK 1", amount_total: "693.00", wht_total: "7.00",
  settled_total: "700.00", created_at: null, notes: null, customer_snapshot: null, seller_snapshot: null,
  void_reason: null, voided_at: null,
  allocations: [{ id: 1, line_no: 1, invoice_id: 5, invoice_number: "INV-2026-0001", invoice_issue_date: "2026-11-27",
    invoice_total: "700.00", amount: "693.00", wht_amount: "7.00", wht_certificate_no: "W-1" }],
};
vi.mock("@/lib/query/payments", () => ({
  useReceipts: () => page([receipt]),
  useReceipt: () => ({ data: receipt, isLoading: false, isError: false, refetch: vi.fn() }),
  useRecordPayment: () => recordMut,
  useVoidReceipt: () => voidMut,
  openReceiptPdf: vi.fn(),
  useBillingNotes: () => page([]),
  useBillingNote: () => ({ data: undefined, isLoading: true }),
  useSaveBillingDraft: () => saveBillingMut,
  useDeleteBillingDraft: () => mut(),
  useBillingAction: () => mut(),
  openBillingPdf: vi.fn(),
  useArAging: () => ({
    data: {
      as_of: "2026-11-27",
      buckets: ["not_due", "days_1_30", "days_31_60", "days_61_90", "days_over_90"],
      rows: [{ customer_id: 3, customer_name: "ร้านลูกค้าดี", oldest_due_date: "2026-11-01", not_due: "700.00",
        days_1_30: "250.00", days_31_60: "0.00", days_61_90: "0.00", days_over_90: "0.00", total: "950.00", invoice_count: 2 }],
      totals: { not_due: "700.00", days_1_30: "250.00", days_31_60: "0.00", days_61_90: "0.00", days_over_90: "0.00",
        total: "950.00", invoice_count: 2 },
    },
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/query/sales", () => ({
  useCustomerSearch: () => ({ data: [{ id: 3, customer_name: "ร้านลูกค้าดี", phone: null, email: null }], isFetching: false }),
}));
vi.mock("@/lib/query/reports", () => ({ useReportExport: () => ({ running: false, run: exportRun }) }));

import { InvoicesView } from "@/components/invoices/invoices-view";
import { ArAgingView } from "./ar-aging-view";
import { BillingView } from "./billing-view";
import { ReceiptsView } from "./receipts-view";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  search = "";
  invoice = invDetail();
  for (const m of [recordMut, voidMut, saveBillingMut]) m.mutate.mockReset();
  exportRun.mockReset();
});

describe("record payment", () => {
  it("from an invoice: prefills its balance, takes WHT and sends one keyed receipt", async () => {
    search = "open=5";
    wrap(<InvoicesView />);
    const detail = await screen.findByRole("dialog", { name: "Invoice" });
    expect(within(detail).getByText("Unpaid")).toBeInTheDocument();
    await userEvent.click(within(detail).getByRole("button", { name: "Record payment" }));

    const form = await screen.findByRole("dialog", { name: "Record payment" });
    const amounts = within(form).getAllByLabelText("Amount received");
    expect(amounts[0]).toHaveValue("700.00");
    expect(amounts[1]).toHaveValue("");
    await userEvent.clear(amounts[0]);
    await userEvent.type(amounts[0], "693");
    await userEvent.type(within(form).getAllByLabelText(/^Withholding tax/)[0], "7");
    await userEvent.type(within(form).getByLabelText("WHT certificate number"), "W-1");
    expect(within(form).getByRole("region", { name: "Total (preview)" })).toHaveTextContent("700.00");
    await userEvent.click(within(form).getByRole("button", { name: "Record and issue receipt" }));

    await waitFor(() => expect(recordMut.mutate).toHaveBeenCalledTimes(1));
    const payload = recordMut.mutate.mock.calls[0][0];
    expect(payload).toMatchObject({
      customer_id: 3, method: "TRANSFER", reference: null,
      allocations: [{ invoice_id: 5, amount: "693", wht_amount: "7", wht_certificate_no: "W-1" }],
    });
    expect(payload.client_request_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("refuses more than the balance before calling the server", async () => {
    search = "open=5";
    wrap(<InvoicesView />);
    const detail = await screen.findByRole("dialog", { name: "Invoice" });
    await userEvent.click(within(detail).getByRole("button", { name: "Record payment" }));
    const form = await screen.findByRole("dialog", { name: "Record payment" });
    await userEvent.type(within(form).getAllByLabelText("Amount received")[1], "300");
    await userEvent.click(within(form).getByRole("button", { name: "Record and issue receipt" }));
    expect(await within(form).findByText("More than the balance")).toBeInTheDocument();
    expect(recordMut.mutate).not.toHaveBeenCalled();
  });

  it("an invoice with an issued receipt cannot be voided and lists the payment", async () => {
    invoice = invDetail({
      balance: "0.00", payment_status: "PAID", paid_total: "700.00",
      payments: [{ id: 9, receipt_number: "RC-2026-0001", status: "ISSUED", received_date: "2026-11-27",
        method: "TRANSFER", amount: "693.00", wht_amount: "7.00" }],
    });
    search = "open=5";
    wrap(<InvoicesView />);
    const detail = await screen.findByRole("dialog", { name: "Invoice" });
    expect(within(detail).queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    expect(within(detail).getByText("Void its receipts first.")).toBeInTheDocument();
    expect(within(detail).getByText("RC-2026-0001")).toBeInTheDocument();
  });
});

describe("receipts, billing notes and AR aging", () => {
  it("voids a receipt with a required reason", async () => {
    wrap(<ReceiptsView />);
    await userEvent.click(screen.getByText("RC-2026-0001"));
    const drawer = await screen.findByRole("dialog", { name: "Receipt" });
    expect(within(drawer).getByText("Withholding tax (W-1)")).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole("button", { name: "Void" }));
    const confirm = await screen.findByRole("dialog", { name: /Void RC-2026-0001/ });
    await userEvent.type(within(confirm).getByLabelText(/Reason/), "ผิดใบ");
    await userEvent.click(within(confirm).getByRole("button", { name: "Void" }));
    expect(voidMut.mutate).toHaveBeenCalledWith({ id: 9, reason: "ผิดใบ" }, expect.anything());
  });

  it("new billing note picks a customer and bills all their unpaid invoices by default", async () => {
    wrap(<BillingView />);
    await userEvent.click(screen.getByRole("button", { name: "New billing note" }));
    const form = await screen.findByRole("dialog", { name: "New billing note" });
    await userEvent.click(within(form).getByRole("combobox"));
    await userEvent.keyboard("ab");
    const option = await screen.findByRole("option", { name: /ร้านลูกค้าดี/ });
    await userEvent.click(within(option).getByRole("button"));
    expect(within(form).getByRole("region", { name: "Total (preview)" })).toHaveTextContent("950.00");
    await userEvent.click(within(form).getAllByRole("checkbox")[1]);
    await userEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(saveBillingMut.mutate).toHaveBeenCalledWith(
        { id: null, payload: { customer_id: 3, invoice_ids: [5], payment_due_date: null, notes: null } },
        expect.anything(),
      ),
    );
  });

  it("AR aging shows buckets and exports for the chosen date", async () => {
    wrap(<ArAgingView />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("1-30 days")).toBeInTheDocument();
    expect(within(table).getAllByText(/950\.00/).length).toBe(2);
    await userEvent.click(screen.getByRole("button", { name: "Export Excel" }));
    expect(exportRun).toHaveBeenCalledWith("/api/bff/invoices/ar-aging/export", { as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});
