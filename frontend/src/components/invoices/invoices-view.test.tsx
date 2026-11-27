import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
let role = "admin";
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: push, push }),
  usePathname: () => "/invoices",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const row = {
  id: 5, invoice_number: "INV-2026-0001", status: "ISSUED", is_overdue: false, sales_order_id: 63,
  sales_order_number: "SO-000063", customer_id: 3, customer_name: "ร้านลูกค้าดี", issue_date: "2026-11-27",
  due_date: "2026-12-27", credit_days: 30, grand_total: "700.00", adjusted_total: "0.00", balance: "700.00",
  created_at: null, updated_at: null,
};
const overdueRow = { ...row, id: 6, invoice_number: "INV-2026-0002", is_overdue: true, due_date: "2026-11-01" };
const detail = (over: Record<string, unknown> = {}) => ({
  ...row, quotation_id: null, quotation_number: null, notes: null,
  customer_snapshot: { name: "ร้านลูกค้าดี" }, seller_snapshot: { vat_registered: false },
  subtotal: "750.00", discount_total: "50.00", vat_base: "700.00", vat_amount: "0.00",
  void_reason: null, issued_at: null, voided_at: null,
  items: [
    { id: 11, line_no: 1, product_id: 8, description: "ถุงมือ", quantity: "3.000", unit_price: "250.00",
      discount_amount: "50.00", line_total: "700.00", adjusted_amount: "0.00" },
  ],
  adjustments: [],
  return_receipts: [
    { id: 21, receipt_number: "SR-000001", returned_at: "2026-11-27T03:00:00Z",
      items: [{ invoice_item_id: 11, product_id: 8, returned_quantity: "1.000", adjusted_quantity: "0.000" }] },
  ],
  ...over,
});

let current = detail();
const listQuery = {
  data: { items: [row, overdueRow], pagination: { page: 1, page_size: 20, total_items: 2, total_pages: 1 } },
  isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn(),
};
const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: undefined });
const actionMut = mut();
const deleteMut = mut();
const saveMut = mut();
const saveAdjMut = mut();
const createMut = mut();
const openPdf = vi.fn();

vi.mock("@/lib/query/invoices", () => ({
  useInvoices: (_q: unknown, enabled: boolean) => (enabled ? listQuery : { ...listQuery, data: undefined }),
  useInvoice: () => ({ data: current, isLoading: false, isError: false, refetch: vi.fn() }),
  useRevenueSummary: () => ({
    data: { year: 2026, invoiced_total: "1500000.00", adjusted_total: "0.00", net_revenue: "1500000.00",
      vat_threshold: "1800000.00", threshold_percent: "83.33", level: "warning" },
  }),
  useInvoiceAction: () => actionMut,
  useDeleteInvoiceDraft: () => deleteMut,
  useSaveInvoiceDraft: () => saveMut,
  openInvoicePdf: (id: number) => openPdf(id),
  useAdjustment: () => ({ data: undefined, isLoading: true }),
  useAdjustmentAction: () => mut(),
  useDeleteAdjustmentDraft: () => mut(),
  useSaveAdjustmentDraft: () => saveAdjMut,
  openAdjustmentPdf: vi.fn(),
  useCreateInvoiceFromOrder: () => createMut,
}));

import { InvoicesView } from "./invoices-view";
import { SalesDocuments } from "@/components/sales/sales-documents";

vi.mock("@/components/work/print-preview", () => ({ PrintPreview: () => null }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  role = "admin";
  search = "";
  current = detail();
  for (const m of [actionMut, deleteMut, saveMut, saveAdjMut, createMut]) m.mutate.mockReset();
  push.mockReset();
  openPdf.mockReset().mockResolvedValue({ opened: true });
});

describe("InvoicesView", () => {
  it("lists invoices, marks overdue ones and shows the VAT threshold card", () => {
    wrap(<InvoicesView />);
    expect(screen.getByText("INV-2026-0001")).toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "83");
    expect(screen.getByText(/Getting close to the VAT threshold/)).toBeInTheDocument();
  });

  it("warehouse users see admins-only and no list", () => {
    role = "warehouse";
    wrap(<InvoicesView />);
    expect(screen.getByText("Admins only")).toBeInTheDocument();
    expect(screen.queryByText("INV-2026-0001")).not.toBeInTheDocument();
  });

  it("opens the invoice named in ?open= and voids it with a required reason", async () => {
    search = "open=5";
    wrap(<InvoicesView />);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("ถุงมือ")).toBeInTheDocument();
    expect(within(drawer).getByText(/Not a tax invoice/)).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole("button", { name: "Open PDF" }));
    expect(openPdf).toHaveBeenCalledWith(5);

    await userEvent.click(within(drawer).getByRole("button", { name: "Void" }));
    const confirm = await screen.findByRole("dialog", { name: /Void INV-2026-0001/ });
    const go = within(confirm).getByRole("button", { name: "Void" });
    expect(go).toBeDisabled();
    await userEvent.type(within(confirm).getByLabelText(/Reason/), "ออกผิด");
    await userEvent.click(go);
    expect(actionMut.mutate).toHaveBeenCalledWith({ id: 5, action: "void", reason: "ออกผิด" }, expect.anything());
  });

  it("void is hidden while an issued adjustment note exists", async () => {
    current = detail({ adjustments: [{ id: 3, adjustment_number: "ADJ-2026-0001", status: "ISSUED", grand_total: "10.00" }] });
    wrap(<InvoicesView />);
    await userEvent.click(screen.getByText("INV-2026-0001"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    expect(within(drawer).getByText(/Void its issued adjustment notes first/)).toBeInTheDocument();
  });

  it("draft editor sends discounts and credit days", async () => {
    current = detail({ status: "DRAFT", invoice_number: null, issue_date: null, due_date: null });
    wrap(<InvoicesView />);
    await userEvent.click(screen.getByText("INV-2026-0001"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: "Open PDF" })).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole("button", { name: "Edit draft" }));
    const discount = within(drawer).getByLabelText(/^Discount/);
    await userEvent.clear(discount);
    await userEvent.type(discount, "25");
    const days = within(drawer).getByLabelText(/^Credit days/);
    await userEvent.clear(days);
    await userEvent.type(days, "0");
    expect(within(drawer).getByRole("region", { name: "Total (preview)" })).toHaveTextContent("725.00");
    await userEvent.click(within(drawer).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(saveMut.mutate).toHaveBeenCalledWith(
        { id: 5, payload: { credit_days: 0, notes: null, items: [{ line_no: 1, discount_amount: "25", description: "ถุงมือ" }] } },
        expect.anything(),
      ),
    );
  });

  it("new adjustment from a return prefills the returned quantity at the net unit price", async () => {
    wrap(<InvoicesView />);
    await userEvent.click(screen.getByText("INV-2026-0001"));
    let drawer = await screen.findByRole("dialog");
    await userEvent.click(within(drawer).getByRole("button", { name: "New adjustment note" }));
    drawer = await screen.findByRole("dialog", { name: "New adjustment note" });
    expect(within(drawer).getByLabelText("Quantity")).toHaveValue("1.000");
    expect(within(drawer).getByLabelText("Reduction per unit")).toHaveValue("233.33");
    expect(within(drawer).getByText(/Returned, not yet adjusted: 1/)).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText("Reason"), "คืนของ 1 ชิ้น");
    await userEvent.click(within(drawer).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(saveAdjMut.mutate).toHaveBeenCalledWith(
        {
          id: null,
          payload: {
            invoice_id: 5, sales_return_receipt_id: 21, reason: "คืนของ 1 ชิ้น",
            items: [{ invoice_item_id: 11, quantity: "1.000", unit_price: "233.33", description: null }],
          },
        },
        expect.anything(),
      ),
    );
  });
});

describe("SalesDocuments create invoice", () => {
  it("admin on a shipped order creates (or reopens) the invoice and goes to it", async () => {
    createMut.mutate.mockImplementation((_id: number, opts: { onSuccess: (d: unknown) => void }) =>
      opts.onSuccess({ id: 5, invoice_created: false }),
    );
    wrap(<SalesDocuments orderId={63} status="SHIPPED" canInvoice />);
    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(createMut.mutate).toHaveBeenCalledWith(63, expect.anything());
    expect(push).toHaveBeenCalledWith("/invoices?open=5");
  });

  it("no button for warehouse users or before shipping", () => {
    const { rerender } = wrap(<SalesDocuments orderId={63} status="SHIPPED" canInvoice={false} />);
    expect(screen.queryByRole("button", { name: "Create invoice" })).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SalesDocuments orderId={63} status="READY_TO_SHIP" canInvoice />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Create invoice" })).not.toBeInTheDocument();
  });
});
