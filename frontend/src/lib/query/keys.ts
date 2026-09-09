/** Centralised, stable TanStack Query keys. */
export const queryKeys = {
  session: ["session"] as const,
  dashboardSummary: ["dashboard", "summary"] as const,
  attentionSummary: ["attention", "summary"] as const,
  recentActivity: ["dashboard", "recent-transactions"] as const,
  search: (q: string) => ["search", q] as const,

  products: {
    all: ["products"] as const,
    list: (params: Record<string, unknown>) => ["products", "list", params] as const,
    detail: (id: number | string) => ["products", "detail", String(id)] as const,
  },
  stock: {
    all: ["stock-balances"] as const,
    list: (params: Record<string, unknown>) => ["stock-balances", "list", params] as const,
    byProduct: (id: number | string, params: Record<string, unknown>) =>
      ["stock-balances", "product", String(id), params] as const,
    inTransit: (params: Record<string, unknown>) => ["stock-balances", "in-transit", params] as const,
  },
  sales: {
    all: ["sales-orders"] as const,
    list: (params: Record<string, unknown>) => ["sales-orders", "list", params] as const,
    detail: (id: number | string) => ["sales-orders", "detail", String(id)] as const,
    packingSlip: (id: number | string) => ["sales-orders", "packing-slip", String(id)] as const,
    shippingLabel: (id: number | string) => ["sales-orders", "shipping-label", String(id)] as const,
  },
  scanResolve: (barcode: string, context: string) => ["scan", "resolve", context, barcode] as const,
  customers: {
    all: ["customers"] as const,
    list: (params: Record<string, unknown>) => ["customers", "list", params] as const,
    detail: (id: number | string) => ["customers", "detail", String(id)] as const,
  },
  categories: {
    all: ["categories"] as const,
    list: (params: Record<string, unknown>) => ["categories", "list", params] as const,
    detail: (id: number | string) => ["categories", "detail", String(id)] as const,
  },
  batches: {
    all: ["batches"] as const,
    list: (params: Record<string, unknown>) => ["batches", "list", params] as const,
  },
  reports: {
    all: ["reports"] as const,
    view: (name: string, params: Record<string, unknown>) => ["reports", name, params] as const,
  },
  audit: {
    all: ["audit-logs"] as const,
  },
  purchaseOrders: {
    all: ["purchase-orders"] as const,
    list: (params: Record<string, unknown>) => ["purchase-orders", "list", params] as const,
    detail: (id: number | string) => ["purchase-orders", "detail", String(id)] as const,
  },
  suppliers: {
    all: ["suppliers"] as const,
    list: (params: Record<string, unknown>) => ["suppliers", "list", params] as const,
    detail: (id: number | string) => ["suppliers", "detail", String(id)] as const,
  },
  transfers: {
    all: ["inventory-transfers"] as const,
    list: (params: Record<string, unknown>) => ["inventory-transfers", "list", params] as const,
    detail: (id: number | string) => ["inventory-transfers", "detail", String(id)] as const,
  },
};
