/**
 * Direct FastAPI calls used to ARRANGE data and to CHECK results. The flows
 * under test always go through the browser; this only sets the stage and reads
 * the authoritative balances afterwards.
 */
import { env, uniq, uniqueBarcode } from "./env";

type Json = Record<string, unknown>;

export class ApiError extends Error {}

export async function token(username: string, password: string): Promise<string> {
  const res = await fetch(`${env.apiURL}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, grant_type: "password" }),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || typeof body.access_token !== "string") {
    throw new ApiError(`login for ${username} failed: HTTP ${res.status}`);
  }
  return body.access_token;
}

export async function call<T = Json>(
  method: string,
  path: string,
  bearer: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${env.apiURL}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as { data?: T } | null;
  if (!res.ok) throw new ApiError(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  return (payload?.data ?? (payload as T)) as T;
}

const idem = (scope: string) => ({ "Idempotency-Key": `e2e-${scope}-${uniq()}` });

export type Product = { id: number; sku: string; barcode: string; product_name: string };

export async function createProduct(
  admin: string,
  opts: { prefix: string; batch: boolean },
): Promise<Product> {
  const tag = uniq();
  return call<Product>("POST", "/products", admin, {
    sku: `E2E-${opts.prefix}-${tag}`,
    barcode: uniqueBarcode(),
    product_name: `E2E ${opts.prefix} ${tag}`,
    price: "10.00",
    track_batch: opts.batch,
    track_expiry: opts.batch,
  });
}

type Location = { id: number; location_code: string };
type Warehouse = { id: number; warehouse_code: string; locations: Location[] };

/** The operational MAIN / DEFAULT storage every fresh database is migrated with. */
export async function mainStorage(bearer: string): Promise<{ warehouseId: number; locationId: number }> {
  const all = await call<Warehouse[]>("GET", "/warehouses", bearer);
  const main = all.find((w) => w.warehouse_code === "MAIN");
  const loc = main?.locations.find((l) => l.location_code === "DEFAULT");
  if (!main || !loc) throw new ApiError("MAIN / DEFAULT storage not found");
  return { warehouseId: main.id, locationId: loc.id };
}

export async function stockIn(bearer: string, productId: number, quantity: string): Promise<void> {
  const { warehouseId, locationId } = await mainStorage(bearer);
  await call("POST", "/stock/in", bearer, {
    product_id: productId, warehouse_id: warehouseId, location_id: locationId, quantity, remark: "e2e arrange",
  }, idem("stock-in"));
}

export async function receiveBatch(
  bearer: string,
  productId: number,
  lot: string,
  quantity: string,
  mfgDate: string,
  expiryDate: string,
): Promise<void> {
  await call("POST", "/batches", bearer, {
    product_id: productId, lot_no: lot, quantity, mfg_date: mfgDate, expiry_date: expiryDate,
  }, idem("batch"));
}

type Balance = { batch_id: number | null; batch_lot_no: string | null; on_hand_qty: string; is_transit: boolean };

/** Operational (non-transit) on-hand, total and per lot, straight from the server. */
export async function onHand(bearer: string, productId: number): Promise<{ total: number; byLot: Record<string, number> }> {
  const data = await call<{ items?: Balance[] } | Balance[]>("GET", `/stock-balances/product/${productId}`, bearer);
  const rows = (Array.isArray(data) ? data : data.items ?? []).filter((r) => !r.is_transit);
  const byLot: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const q = Number(r.on_hand_qty);
    total += q;
    if (r.batch_lot_no) byLot[r.batch_lot_no] = (byLot[r.batch_lot_no] ?? 0) + q;
  }
  return { total: Math.round(total * 1000) / 1000, byLot };
}

/** Customer + sales order for `quantity` of a non-batch product, driven to SHIPPED. */
export async function shippedSalesOrder(
  admin: string,
  warehouse: string,
  product: Product,
  quantity: string,
): Promise<{ id: number; soNumber: string }> {
  const customer = await call<{ id: number }>("POST", "/customers", admin, { customer_name: `E2E Customer ${uniq()}` });
  const so = await call<{ sales_order_id: number }>("POST", "/sales-orders/", admin, {
    customer_id: customer.id,
    items: [{ product_id: product.id, quantity, unit_price: "10.00" }],
  });
  const id = so.sales_order_id;
  await call("POST", `/sales-orders/${id}/confirm`, admin);
  await call("POST", `/sales-orders/${id}/start-picking`, warehouse);
  type Detail = { so_number: string; status: string; items: { fulfillment_allocations: { id: number; quantity: string }[] }[] };
  const detail = await call<Detail>("GET", `/sales-orders/${id}`, warehouse);
  const allocations = detail.items.flatMap((it) =>
    it.fulfillment_allocations.map((a) => ({ allocation_id: a.id, quantity: a.quantity })),
  );
  for (const a of allocations) {
    await call("POST", `/sales-orders/${id}/scan-pick`, warehouse, { barcode: product.barcode, ...a });
  }
  await call("POST", `/sales-orders/${id}/complete-picking`, warehouse, { allocations });
  for (const a of allocations) {
    await call("POST", `/sales-orders/${id}/scan-pack`, warehouse, { barcode: product.barcode, ...a });
  }
  await call("POST", `/sales-orders/${id}/complete-packing`, warehouse, { allocations });
  await call("POST", `/sales-orders/${id}/ship`, warehouse);
  const shipped = await call<Detail>("GET", `/sales-orders/${id}`, warehouse);
  if (shipped.status !== "SHIPPED") throw new ApiError(`sales order ${id} is ${shipped.status}, expected SHIPPED`);
  return { id, soNumber: shipped.so_number };
}
