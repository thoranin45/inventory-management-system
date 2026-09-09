import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductActions } from "./product-actions";
import { canShowAction, isAdmin } from "@/lib/auth/permissions";

describe("permissions (backend roles are lowercase)", () => {
  it("isAdmin is case-insensitive", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("ADMIN")).toBe(true);
    expect(isAdmin("warehouse")).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
  it("product CRUD is admin-only; stock:adjust allows warehouse", () => {
    expect(canShowAction("warehouse", "product:create")).toBe(false);
    expect(canShowAction("admin", "product:update")).toBe(true);
    expect(canShowAction("warehouse", "stock:adjust")).toBe(true);
  });
});

describe("ProductActions — role-based rendering", () => {
  it("shows an enabled 'New product' trigger for admin and fires onNew", async () => {
    const onNew = vi.fn();
    render(<ProductActions role="admin" onNew={onNew} />);
    const create = screen.getByRole("button", { name: /new product/i });
    expect(create).toBeEnabled();
    await userEvent.click(create);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a warehouse user", () => {
    const { container } = render(<ProductActions role="warehouse" onNew={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the role is missing", () => {
    const { container } = render(<ProductActions role={null} onNew={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
