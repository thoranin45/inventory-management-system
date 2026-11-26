import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const replace = vi.fn();
let role = "admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/quotations",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const row = {
  id: 5, quotation_number: "QT-2026-0007", status: "ISSUED", is_expired: false, customer_id: 3,
  customer_name: "ร้านลูกค้าดี", issue_date: "2026-11-27", valid_until: "2026-12-27", grand_total: "761.26",
  sales_order_id: null, created_at: null, updated_at: null,
};
const draftRow = { ...row, id: 6, quotation_number: null, status: "DRAFT", issue_date: null, valid_until: null, grand_total: "11.26" };
const detail = (over: Record<string, unknown> = {}) => ({
  ...row, notes: "ส่งภายใน 7 วัน", customer_snapshot: { name: "ร้านลูกค้าดี", tax_id: "0105536092641" },
  seller_snapshot: { vat_registered: false }, subtotal: "761.26", vat_base: "761.26", vat_amount: "0.00",
  sales_order_number: null, revision_of_id: null, revised_by_id: null, void_reason: null,
  items: [
    { id: 1, line_no: 1, product_id: 7, description: "SKU-7 น้ำดื่ม", quantity: "1.125", unit_price: "10.01", line_total: "11.26" },
    { id: 2, line_no: 2, product_id: 8, description: "ถุงมือ", quantity: "3.000", unit_price: "250.00", line_total: "750.00" },
  ],
  ...over,
});

let current = detail();
const listQuery = { data: { items: [row, draftRow], pagination: { page: 1, page_size: 20, total_items: 2, total_pages: 1 } }, isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn() };
const actionMut = { mutate: vi.fn(), isPending: false, isError: false, error: undefined };
const deleteMut = { mutate: vi.fn(), isPending: false, isError: false, error: undefined };
const saveMut = { mutate: vi.fn(), isPending: false, isError: false, error: undefined };
const openPdf = vi.fn();

vi.mock("@/lib/query/quotations", () => ({
  useQuotations: (_q: unknown, enabled: boolean) => (enabled ? listQuery : { ...listQuery, data: undefined }),
  useQuotation: () => ({ data: current, isLoading: false, isError: false, refetch: vi.fn() }),
  useQuotationAction: () => actionMut,
  useDeleteQuotationDraft: () => deleteMut,
  useSaveQuotationDraft: () => saveMut,
  openQuotationPdf: (id: number) => openPdf(id),
}));
vi.mock("@/lib/query/sales", () => ({ useCustomerSearch: () => ({ data: [], isFetching: false }) }));
vi.mock("@/lib/query/hooks", () => ({ useGlobalSearch: () => ({ data: undefined, isFetching: false }) }));

import { QuotationsView } from "./quotations-view";

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuotationsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = "admin";
  current = detail();
  actionMut.mutate.mockReset();
  deleteMut.mutate.mockReset();
  saveMut.mutate.mockReset();
  openPdf.mockReset().mockResolvedValue({ opened: true });
});

describe("QuotationsView", () => {
  it("lists quotations with number, customer, status chip and total", () => {
    renderView();
    expect(screen.getByText("QT-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Draft #6")).toBeInTheDocument();
    expect(screen.getAllByText("ร้านลูกค้าดี").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issued").length).toBeGreaterThan(0);
    expect(screen.getByText("27/12/2026")).toBeInTheDocument();
  });

  it("shows an admins-only message to warehouse users and never loads the list", () => {
    role = "warehouse";
    renderView();
    expect(screen.getByText("Admins only")).toBeInTheDocument();
    expect(screen.queryByText("QT-2026-0007")).not.toBeInTheDocument();
  });

  it("issued quotation: accept, reject, revise, PDF and void with a required reason", async () => {
    renderView();
    await userEvent.click(screen.getByText("QT-2026-0007"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("SKU-7 น้ำดื่ม")).toBeInTheDocument();
    expect(within(drawer).getByText(/Not a tax invoice/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Create sales order" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Edit draft" })).not.toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole("button", { name: "Open PDF" }));
    expect(openPdf).toHaveBeenCalledWith(5);

    await userEvent.click(within(drawer).getByRole("button", { name: "Void" }));
    const confirm = await screen.findByRole("dialog", { name: /Void QT-2026-0007/ });
    const go = within(confirm).getByRole("button", { name: "Void" });
    expect(go).toBeDisabled();
    await userEvent.type(within(confirm).getByLabelText(/Reason/), "ลูกค้ายกเลิก");
    await userEvent.click(go);
    expect(actionMut.mutate).toHaveBeenCalledWith({ id: 5, action: "void", reason: "ลูกค้ายกเลิก" }, expect.anything());
  });

  it("expired quotation cannot be accepted and says why", async () => {
    current = detail({ is_expired: true });
    renderView();
    await userEvent.click(screen.getByText("QT-2026-0007"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/Expired on 27\/12\/2026/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Customer accepted" })).not.toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Revise" })).toBeInTheDocument();
  });

  it("accepted quotation converts to a sales order after confirmation", async () => {
    current = detail({ status: "ACCEPTED" });
    renderView();
    await userEvent.click(screen.getByText("QT-2026-0007"));
    const drawer = await screen.findByRole("dialog");
    await userEvent.click(within(drawer).getByRole("button", { name: "Create sales order" }));
    const confirm = await screen.findByRole("dialog", { name: /Create a sales order from QT-2026-0007/ });
    await userEvent.click(within(confirm).getByRole("button", { name: "Create sales order" }));
    expect(actionMut.mutate).toHaveBeenCalledWith({ id: 5, action: "convert", reason: undefined }, expect.anything());
  });

  it("draft: no PDF yet, and issuing asks first", async () => {
    current = detail({ ...draftRow, status: "DRAFT", quotation_number: null, valid_until: null, notes: null });
    renderView();
    await userEvent.click(screen.getByText("Draft #6"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: "Open PDF" })).not.toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole("button", { name: "Issue" }));
    const confirm = await screen.findByRole("dialog", { name: /Issue Draft #6/ });
    await userEvent.click(within(confirm).getByRole("button", { name: "Issue" }));
    expect(actionMut.mutate).toHaveBeenCalledWith({ id: 6, action: "issue", reason: undefined }, expect.anything());
  });

  it("draft form previews totals with half-up rounding and sends a full replacement", async () => {
    current = detail({ ...draftRow, status: "DRAFT", quotation_number: null, valid_until: null, notes: null });
    renderView();
    await userEvent.click(screen.getByText("Draft #6"));
    let drawer = await screen.findByRole("dialog");
    await userEvent.click(within(drawer).getByRole("button", { name: "Edit draft" }));
    drawer = await screen.findByRole("dialog", { name: "Edit draft #6" });
    const preview = within(drawer).getByRole("region", { name: "Total (preview)" });
    expect(preview).toHaveTextContent("761.26");          // 11.26 (1.125 x 10.01 half up) + 750.00

    await userEvent.type(within(drawer).getByLabelText("Notes"), "ราคารวมค่าส่ง");
    await userEvent.click(within(drawer).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(saveMut.mutate).toHaveBeenCalledWith(
        {
          id: 6,
          payload: {
            customer_id: 3,
            valid_until: null,
            notes: "ราคารวมค่าส่ง",
            items: [
              { product_id: 7, quantity: "1.125", unit_price: "10.01", description: "SKU-7 น้ำดื่ม" },
              { product_id: 8, quantity: "3.000", unit_price: "250.00", description: "ถุงมือ" },
            ],
          },
        },
        expect.anything(),
      ),
    );
  });
});
