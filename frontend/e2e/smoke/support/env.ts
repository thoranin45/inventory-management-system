/**
 * P8 smoke suite settings. Everything comes from the environment so the same
 * suite runs in CI (fresh database) and against a local stack. Nothing here is
 * a real credential: CI creates a throwaway admin on a throwaway database.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name} (see frontend/e2e/smoke/README.md)`);
  return value;
}

export const env = {
  /** Next.js app (the only thing the browser talks to). */
  baseURL: (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, ""),
  /** FastAPI, used only by the tests to arrange data and to check results. */
  apiURL: (process.env.E2E_API_URL ?? "http://127.0.0.1:8081/api/v1").replace(/\/+$/, ""),
  admin: { username: required("E2E_ADMIN_USERNAME"), password: required("E2E_ADMIN_PASSWORD") },
  /** Created by auth.setup.ts through POST /auth/register if it does not exist. */
  warehouse: {
    username: process.env.E2E_WAREHOUSE_USERNAME ?? "e2e-warehouse",
    password: process.env.E2E_WAREHOUSE_PASSWORD ?? "e2e-warehouse-password",
  },
};

export const STATE = {
  admin: "e2e/.auth/admin.json",
  warehouse: "e2e/.auth/warehouse.json",
};

/** Unique, short suffix so every run can share one database without collisions. */
export function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
}

/** A 12-digit numeric barcode that is unique per call. */
let barcodeSeq = 0;
export function uniqueBarcode(): string {
  barcodeSeq += 1;
  return `2${String(Date.now()).slice(-9)}${String(barcodeSeq % 100).padStart(2, "0")}`;
}

/** YYYY-MM-DD, `days` from today (UTC is fine: offsets are weeks or months). */
export function isoDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
