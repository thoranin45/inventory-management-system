/**
 * UI-side permission hints derived from the `/auth/me` role. These only decide
 * what to *show* — the backend remains the security authority and will reject a
 * forbidden mutation with 403 regardless of the UI.
 *
 * Backend roles are lowercase ("warehouse", "admin"); compared case-insensitively.
 */
export type Role = string | null | undefined;

export function isAdmin(role: Role): boolean {
  return (role ?? "").toLowerCase() === "admin";
}
export function isWarehouse(role: Role): boolean {
  return (role ?? "").toLowerCase() === "warehouse";
}

export type UiAction =
  | "product:create"
  | "product:update"
  | "product:delete"
  | "master:write"
  | "stock-adjustment-request:create"
  | "stock-adjustment-request:approve";

export function canShowAction(role: Role, action: UiAction): boolean {
  switch (action) {
    case "product:create":
    case "product:update":
    case "product:delete":
    case "master:write":
      // Backend: create/update/delete on products, categories, customers and
      // suppliers all require_admin. Warehouse users get read-only screens.
      return isAdmin(role);
    case "stock-adjustment-request:create":
      // Backend: require_warehouse (admin is a superset role and may also
      // create). Phase 14B — direct /stock/adjust is retired.
      return isAdmin(role) || isWarehouse(role);
    case "stock-adjustment-request:approve":
      // Backend: require_admin, and the service also blocks self-approval.
      return isAdmin(role);
    default:
      return false;
  }
}
