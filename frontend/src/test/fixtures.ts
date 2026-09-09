/**
 * Contract fixtures — copied verbatim from real FastAPI responses captured
 * during the Step 0 live gate. Unit/component tests use these so they never
 * need the database.
 */
export const productListResponse = {
  success: true,
  message: "Products retrieved successfully",
  data: {
    items: [
      {
        id: 6,
        sku: "WH-TEA-200G",
        barcode: "885000000008",
        product_name: "Green Tea 200g",
        price: "78.00",
        stock_qty: "480.000",
        owned_quantity: "480.000",
        operational_available_quantity: "400.000",
        reserved_quantity: "40.000",
        expired_quantity: "0",
        near_expiry_quantity: "440.000",
        transit_quantity: "0",
        minimum_stock: "120.000",
        safety_stock: "40.000",
        maximum_stock: "1200.000",
        category_id: null,
        image_url: null,
        is_active: true,
        created_at: "2026-09-08T11:32:38.151241",
        track_batch: true,
        track_expiry: true,
        as_of_date: "2026-09-08",
      },
      {
        id: 3,
        sku: "WH-SUGAR-25KG",
        barcode: "885000000009",
        product_name: "Refined Sugar Sack 25kg",
        price: "640.00",
        stock_qty: "62.000",
        owned_quantity: "62.000",
        operational_available_quantity: "62.000",
        reserved_quantity: "0.000",
        expired_quantity: "0",
        near_expiry_quantity: "0",
        transit_quantity: "0",
        minimum_stock: "80.000",
        safety_stock: "0.000",
        maximum_stock: "400.000",
        category_id: null,
        image_url: null,
        is_active: true,
        created_at: "2026-09-08T11:32:38.151241",
        track_batch: false,
        track_expiry: false,
        as_of_date: "2026-09-08",
      },
    ],
    pagination: { page: 1, page_size: 20, total_items: 6, total_pages: 1 },
  },
};

export const stockBalanceListResponse = {
  success: true,
  message: "Stock balances retrieved successfully",
  data: {
    items: [
      {
        id: 7,
        product_id: 6,
        warehouse_id: 1,
        location_id: 1,
        batch_id: 4,
        on_hand_qty: "440.000",
        reserved_qty: "40.000",
        available_qty: "400.000",
        created_at: "2026-09-08T11:32:38.199062",
        updated_at: "2026-09-08T11:32:38.199062",
        is_transit: false,
        batch_expiry_date: "2026-09-26",
        days_to_expiry: 18,
        is_expired: false,
        as_of_date: "2026-09-08",
      },
      {
        id: 4,
        product_id: 4,
        warehouse_id: 1,
        location_id: 1,
        batch_id: null,
        on_hand_qty: "2990.000",
        reserved_qty: "300.000",
        available_qty: "2690.000",
        created_at: "2026-09-08T11:32:38.199062",
        updated_at: "2026-09-08T11:32:38.199062",
        is_transit: false,
        batch_expiry_date: null,
        days_to_expiry: null,
        is_expired: false,
        as_of_date: "2026-09-08",
      },
    ],
    pagination: { page: 1, page_size: 20, total_items: 7, total_pages: 1 },
  },
};

export const errorResponse401 = {
  success: false,
  message: "Not authenticated",
  errors: [],
  request_id: "2473728627f94c0ca7a15f24f88e2b36",
};

/* ---------------- Phase 3 — Sales Orders (captured from live FastAPI) ---------------- */

/** GET /api/v1/sales-orders/ — Phase 8 list body: money/qty are decimal STRINGS. */
export const salesOrderListResponse = {
  success: true,
  message: "Sales Orders Retrieved",
  data: {
    items: [
      {
        id: 2,
        so_number: "SO-000002",
        customer_id: 1,
        customer_name: "Acme Test Co",
        status: "DRAFT",
        item_count: 1,
        total_quantity: "3.000",
        total_amount: "630.00",
        created_at: "2026-09-07T09:12:44.101020",
        last_activity_at: "2026-09-07T09:12:44.101020",
        picked_pct: 0,
        packed_pct: 0,
        attention_reason: null,
      },
      {
        id: 1,
        so_number: "SO-000001",
        customer_id: 1,
        customer_name: "Acme Test Co",
        status: "CONFIRMED",
        item_count: 2,
        total_quantity: "7.000",
        total_amount: "2330.00",
        created_at: "2026-09-07T09:05:01.882410",
        last_activity_at: "2026-09-07T09:06:30.114552",
        picked_pct: 0,
        packed_pct: 0,
        attention_reason: null,
      },
    ],
    pagination: { page: 1, page_size: 20, total_items: 2, total_pages: 1 },
  },
};

/**
 * GET /api/v1/sales-orders/{id} — success_response body: money/qty come back
 * as JSON NUMBERS (floats), NOT strings. No customer_name, no attention_reason,
 * allocations carry no expiry. Zod coerces the numbers to strings.
 */
export const salesOrderDetailResponse = {
  success: true,
  message: "Sales Order Retrieved",
  data: {
    id: 1,
    so_number: "SO-000001",
    customer_id: 1,
    status: "CONFIRMED",
    total_amount: 2330.0,
    created_at: "2026-09-07T09:05:01.882410",
    items: [
      {
        id: 10,
        sales_order_id: 1,
        product_id: 1,
        quantity: 5,
        unit_price: 210.0,
        total_price: 1050.0,
        batch_allocations: [{ id: 21, batch_id: 7, quantity: 5 }],
        fulfillment_allocations: [
          {
            id: 31,
            batch_id: 7,
            stock_balance_id: 3,
            quantity: 5,
            picked_quantity: 0,
            packed_quantity: 0,
          },
        ],
      },
      {
        id: 11,
        sales_order_id: 1,
        product_id: 3,
        quantity: 2,
        unit_price: 640.0,
        total_price: 1280.0,
        batch_allocations: [],
        fulfillment_allocations: [
          {
            id: 32,
            batch_id: null,
            stock_balance_id: 4,
            quantity: 2,
            picked_quantity: 0,
            packed_quantity: 0,
          },
        ],
      },
    ],
    picked_at: null,
    picked_by_user_id: null,
    packed_at: null,
    packed_by_user_id: null,
    shipped_at: null,
    shipped_by_user_id: null,
    shipment_number: null,
  },
};

/** POST /api/v1/sales-orders/ (and /confirm, /cancel) — note key `sales_order_id`. */
export const salesOrderCreateResponse = {
  success: true,
  message: "Sales Order Created",
  data: {
    sales_order_id: 1,
    so_number: "SO-000001",
    status: "DRAFT",
    shipment_number: null,
    total_amount: 2330.0,
  },
};

export const salesOrderConfirmResponse = {
  success: true,
  message: "Sales Order Confirmed",
  data: { sales_order_id: 1, so_number: "SO-000001", status: "CONFIRMED", shipment_number: null },
};

export const salesOrderCancelResponse = {
  success: true,
  message: "Sales Order Cancelled",
  data: { sales_order_id: 1, so_number: "SO-000001", status: "CANCELLED", shipment_number: null },
};

/** POST /confirm on an already-CONFIRMED order → 409. */
export const salesOrderConflictResponse = {
  success: false,
  message: "Sales Order state conflict: CONFIRMED; requires DRAFT",
  errors: [],
  request_id: "b71f0c9a5d2e4f1aa0c8d3e6f7b90a12",
};

/** POST / with quantity "-5" → 422, field-level errors. */
export const salesOrderValidationResponse = {
  success: false,
  message: "Validation error",
  errors: [
    { field: "items.0.quantity", message: "Input should be greater than 0", error_type: "greater_than" },
  ],
  request_id: "c92a1b7e4f6d4c2b8e0a5d3f1c7b6a04",
};

/** GET /api/v1/customers?search= */
export const customerListResponse = {
  success: true,
  message: "Customers Retrieved",
  data: {
    items: [
      { id: 1, customer_name: "Acme Test Co", phone: "02-000-0000", email: "ops@acme.test", address: "1 Test Rd" },
    ],
    pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
  },
};

/* ---------------- Phase 5 — Purchase Orders (captured from live FastAPI) ---------------- */

/** GET /api/v1/purchase-orders — every quantity / money value is a decimal STRING. */
export const purchaseOrderListResponse = {
  success: true,
  message: "Purchase orders retrieved successfully",
  data: {
    items: [
      {
        id: 1,
        po_number: "PO-000001",
        supplier_id: 1,
        supplier_name: "Golden Harvest Trading",
        status: "PARTIALLY_RECEIVED",
        ordered_quantity: "36.000",
        received_quantity: "8.000",
        remaining_quantity: "28.000",
        receiving_pct: 22.2,
        total_amount: "14220.00",
        created_at: "2026-09-08T13:55:40.274731",
        last_receipt_at: "2026-09-08T13:56:20.100000+00:00",
        receipt_count: 1,
      },
    ],
    pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
  },
};

/** GET /api/v1/purchase-orders/{id} — ApiResponse[PurchaseOrderResponse]. */
export const purchaseOrderDetailResponse = {
  success: true,
  message: "Purchase order retrieved successfully",
  data: {
    id: 1,
    po_number: "PO-000001",
    supplier_id: 1,
    status: "PARTIALLY_RECEIVED",
    total_amount: "14220.00000",
    created_at: "2026-09-08T13:55:40.274731",
    items: [
      {
        id: 1,
        po_id: 1,
        product_id: 1,
        quantity: "10.000",
        received_quantity: "3.000",
        remaining_quantity: "7.000",
        unit_price: "180.00",
        total_price: "1800.00000",
      },
      {
        id: 2,
        po_id: 1,
        product_id: 3,
        quantity: "20.000",
        received_quantity: "5.000",
        remaining_quantity: "15.000",
        unit_price: "600.00",
        total_price: "12000.00000",
      },
      {
        id: 3,
        po_id: 1,
        product_id: 6,
        quantity: "6.000",
        received_quantity: "0.000",
        remaining_quantity: "6.000",
        unit_price: "70.00",
        total_price: "420.00000",
      },
    ],
  },
};

export const purchaseOrderConfirmResponse = {
  success: true,
  message: "Purchase order confirmed successfully",
  data: { id: 1, po_number: "PO-000001", status: "CONFIRMED" },
};
export const purchaseOrderCancelResponse = {
  success: true,
  message: "Purchase order cancelled successfully",
  data: { id: 2, po_number: "PO-000002", status: "CANCELLED" },
};

/** POST /api/v1/purchase-orders/{id}/receive → ApiResponse[PurchaseOrderReceiveResponse]. */
export const purchaseOrderReceiveResponse = {
  success: true,
  message: "Purchase order received successfully",
  data: {
    id: 1,
    po_number: "PO-000001",
    status: "PARTIALLY_RECEIVED",
    received_batches: [
      {
        batch_id: 6,
        product_id: 1,
        lot_no: "LOT-CF-A",
        received_quantity: "3.000",
        current_stock: "1604.000",
      },
    ],
    received_items: [
      {
        po_item_id: 1,
        product_id: 1,
        batch_id: 6,
        stock_balance_id: 9,
        received_quantity: "3.000",
        current_stock: "1604.000",
      },
      {
        po_item_id: 2,
        product_id: 3,
        batch_id: null,
        stock_balance_id: 4,
        received_quantity: "5.000",
        current_stock: "67.000",
      },
    ],
    receipt_id: 1,
    receipt_number: "POR-9b47835832a0411e809d3b402c2da9c9",
  },
};

/** Same key + different payload → 409. */
export const purchaseOrderIdempotencyMismatchResponse = {
  success: false,
  message: "Idempotency-Key already used with a different payload",
  errors: [],
  request_id: "16a6840233d9490b9132853cb55637af",
};
/** Over-receive → 409. */
export const purchaseOrderOverReceiveResponse = {
  success: false,
  message: "Received quantity exceeds remaining purchase order quantity for product_id 1",
  errors: [],
  request_id: "b2d2605829a946f4aeac9ba979e526bf",
};

/** GET /api/v1/suppliers?search= */
export const supplierListResponse = {
  success: true,
  message: "Suppliers retrieved successfully",
  data: {
    items: [
      { id: 1, supplier_name: "Golden Harvest Trading", contact_name: "Somchai", phone: "+66 2 900 1180", email: null, address: "12 Trade Rd" },
    ],
    pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
  },
};

/* ---------------- Phase 6 — Inventory Transfers (captured from live FastAPI) ---------------- */

/** GET /api/v1/inventory-transfers — enveloped; every quantity is a decimal STRING. */
export const transferListResponse = {
  success: true,
  message: "Inventory transfers retrieved successfully",
  data: {
    items: [
      {
        id: 1,
        transfer_number: "TR-20260908215819350799",
        source_warehouse_id: 1,
        source_warehouse_name: "Main Warehouse",
        destination_warehouse_id: 2,
        destination_warehouse_name: "Shop Warehouse",
        status: "IN_TRANSIT",
        line_count: 2,
        total_quantity: "9.000",
        dispatched_quantity: "9.000",
        received_quantity: "0.000",
        outstanding_quantity: "9.000",
        progress_pct: 0.0,
        dispatched_at: "2026-09-08T14:58:42.710517+00:00",
        latest_receipt_at: null,
        legacy_completed: false,
      },
      {
        id: 7,
        transfer_number: "TR-LEGACY-0007",
        source_warehouse_id: 1,
        source_warehouse_name: "Main Warehouse",
        destination_warehouse_id: 2,
        destination_warehouse_name: "Shop Warehouse",
        status: "COMPLETED",
        line_count: 1,
        total_quantity: "0.000",
        dispatched_quantity: "0.000",
        received_quantity: "0.000",
        outstanding_quantity: "0.000",
        progress_pct: 0.0,
        dispatched_at: null,
        latest_receipt_at: null,
        legacy_completed: true,
      },
    ],
    pagination: { page: 1, page_size: 20, total_items: 2, total_pages: 1 },
  },
};

/** GET /api/v1/inventory-transfers/{id} — RAW InventoryTransferResponse (NOT enveloped). */
export const transferDetailResponse = {
  dispatched_at: "2026-09-08T14:58:42.710517Z",
  dispatched_by_user_id: 2,
  legacy_completed: false,
  id: 1,
  transfer_number: "TR-20260908215819350799",
  status: "IN_TRANSIT",
  source_warehouse_id: 1,
  destination_warehouse_id: 2,
  requested_by_user_id: 2,
  completed_by_user_id: null,
  remark: "QA transfer",
  created_at: "2026-09-08T14:58:19.319152",
  completed_at: null,
  updated_at: "2026-09-08T14:58:42.619744",
  items: [
    {
      dispatched_quantity: "5.000",
      received_quantity: "0.000",
      outstanding_quantity: "5.000",
      source_stock_balance_id: 1,
      transit_stock_balance_id: 34,
      id: 1,
      transfer_id: 1,
      product_id: 1,
      batch_id: 1,
      from_location_id: 1,
      to_location_id: 2,
      quantity: "5.000",
      created_at: "2026-09-08T14:58:19.319152",
    },
    {
      dispatched_quantity: "4.000",
      received_quantity: "0.000",
      outstanding_quantity: "4.000",
      source_stock_balance_id: 4,
      transit_stock_balance_id: 35,
      id: 2,
      transfer_id: 1,
      product_id: 3,
      batch_id: null,
      from_location_id: 1,
      to_location_id: 2,
      quantity: "4.000",
      created_at: "2026-09-08T14:58:19.319152",
    },
  ],
};

/** POST /inventory-transfers/{id}/receive → TransferReceiptResponse (RAW). */
export const transferReceiptResponse = {
  receipt_id: 1,
  receipt_number: "TRR-c412e429a47c4ff7ad8fc4c12fdbf09f",
  transfer: {
    ...transferDetailResponse,
    status: "PARTIALLY_RECEIVED",
    items: [
      { ...transferDetailResponse.items[0], received_quantity: "2.000", outstanding_quantity: "3.000" },
      { ...transferDetailResponse.items[1], received_quantity: "1.000", outstanding_quantity: "3.000" },
    ],
  },
};

export const transferIdempotencyMismatchResponse = {
  success: false,
  message: "Idempotency-Key already used with a different payload",
  errors: [],
  request_id: "9cc25b27ed02423fa446e83bcb136656",
};
export const transferOverReceiveResponse = {
  success: false,
  message: "Receipt exceeds outstanding dispatched quantity",
  errors: [],
  request_id: "df766aba4e244f3b9f1930e2c37c92ec",
};
export const transferExpiredBatchDispatchResponse = {
  success: false,
  message: "Cannot dispatch expired batch: 7",
  errors: [],
  request_id: "c12c4c1acf5844ca8719ee88c9e27c3d",
};

/* ---- Phase 7: Product & Master-Data CRUD ---- */

export const productDetailResponse = {
  success: true,
  message: "Product retrieved successfully",
  data: {
    id: 6,
    sku: "WH-TEA-200G",
    barcode: "885000000008",
    product_name: "Green Tea 200g",
    price: "78.00",
    stock_qty: "480.000",
    category_id: null,
    image_url: null,
    is_active: true,
    created_at: "2026-09-08T11:32:38.151241",
    track_batch: true,
    track_expiry: true,
  },
};

export const categoryListResponse = {
  success: true,
  message: "Categories retrieved successfully",
  data: {
    items: [
      { id: 2, category_name: "Beverages" },
      { id: 5, category_name: "Bakery" },
    ],
    pagination: { page: 1, page_size: 20, total_items: 2, total_pages: 1 },
  },
};

export const categoryInUseResponse = {
  success: false,
  message: "Cannot delete category with active products",
  errors: [],
  request_id: "req-cat-inuse-1",
};

export const customerConstraintResponse = {
  success: false,
  message: "Database constraint error",
  errors: [{ message: "Database constraint error", error_type: "integrity_error" }],
  request_id: "req-cust-fk-1",
};

export const imageTooLargeResponse = {
  success: false,
  message: "Image exceeds the 5242880 byte limit",
  errors: [],
  request_id: "req-img-413",
};

export const invalidImageResponse = {
  success: false,
  message: "File is not a valid image",
  errors: [],
  request_id: "req-img-bad",
};

/* ---- Phase 8: Reports ---- */

export const operationalStockReportResponse = {
  success: true,
  message: "Operational stock report",
  data: {
    items: [
      {
        id: 6, sku: "WH-TEA-200G", barcode: "885000000008", product_name: "Green Tea 200g",
        price: "78.00", stock_qty: "452.000", owned_quantity: "452.000",
        operational_available_quantity: "392.000", reserved_quantity: "54.000",
        expired_quantity: "6.000", near_expiry_quantity: "440.000", transit_quantity: "0",
        minimum_stock: "120.000", safety_stock: "40.000", maximum_stock: "1200.000",
        category_id: null, image_url: null, is_active: true,
        created_at: "2026-09-08T11:32:38", track_batch: true, track_expiry: true, as_of_date: "2026-09-09",
      },
    ],
    pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
  },
};

export const movementReportResponse = {
  success: true,
  message: "Stock movement report",
  data: {
    items: [
      { id: 34, product_id: 3, transaction_type: "IN_PO", quantity: "1.000", remark: "Receive from PO-000033", created_at: "2026-09-08T17:18:28.797889" },
      { id: 33, product_id: 1, transaction_type: "OUT_FEFO", quantity: "2.000", remark: null, created_at: "2026-09-08T17:00:00" },
    ],
    pagination: { page: 1, page_size: 25, total_items: 34, total_pages: 2 },
  },
};

export const expiredStockReportResponse = {
  items: [
    { batch_id: 7, product_id: 1, lot_no: "LOT-EXPIRED-2020", quantity: 1, expiry_date: "2020-01-01", days_to_expiry: -2443 },
    { batch_id: 13, product_id: 1, lot_no: "QA-CF2", quantity: 7, expiry_date: "2026-09-06", days_to_expiry: -3 },
  ],
};

export const nearExpiryReportResponse = {
  items: [
    { batch_id: 5, product_id: 1, lot_no: "LOT-AMB-EARLY", quantity: 1, expiry_date: "2026-09-25", days_to_expiry: 16 },
    { batch_id: 4, product_id: 6, lot_no: "LOT-TEA-19", quantity: 440, expiry_date: "2026-09-26", days_to_expiry: 17 },
  ],
};

export const inTransitReportResponse = {
  items: [
    { id: 35, product_id: 3, batch_id: null, warehouse_id: 3, location_id: 3, on_hand_qty: 50 },
    { id: 40, product_id: 1, batch_id: 8, warehouse_id: 3, location_id: 3, on_hand_qty: 1 },
    { id: 34, product_id: 1, batch_id: 1, warehouse_id: 3, location_id: 3, on_hand_qty: 0 },
  ],
};

export const lowStockOperationalReportResponse = {
  items: [
    { product_id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg", operational_available_quantity: 2, threshold: 10 },
    { product_id: 8, sku: "QA-P7-img", product_name: "QA P7 Image", operational_available_quantity: 0, threshold: 10 },
  ],
};

export const salesSummaryResponse = { total_orders: 59, total_sales_amount: 41409 };
export const chartSalesResponse = [{ date: "2026-09-07", orders: 12, sales: 5000 }, { date: "2026-09-08", orders: 47, sales: 36409 }];
export const chartStockResponse = [{ product_name: "All-Purpose Flour 1kg", stock_qty: 3110 }, { product_name: "Arabica Whole Bean 1kg", stock_qty: 1624 }];
export const chartExpiryResponse = [
  { batch_id: 7, product_id: 1, lot_no: "LOT-EXPIRED-2020", quantity: 1, expiry_date: "2020-01-01", series: "expired" },
  { batch_id: 4, product_id: 6, lot_no: "LOT-TEA-19", quantity: 440, expiry_date: "2026-09-26", series: "near_expiry" },
  { batch_id: 1, product_id: 1, lot_no: "LOT-2406-A", quantity: 1600, expiry_date: "2026-10-19", series: "eligible" },
];

export const exportRowCapResponse = {
  success: false,
  message: "Export too large (73210 rows > 50000); narrow the filters and retry",
  errors: [],
  request_id: "req-export-cap-1",
};

export const reportInvalidFilterResponse = {
  success: false,
  message: "Validation error",
  errors: [{ field: "days", message: "Input should be greater than or equal to 1", error_type: "greater_than_equal" }],
  request_id: "req-report-422",
};
