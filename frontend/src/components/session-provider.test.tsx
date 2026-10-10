import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/inventory/ledger",
}));
vi.mock("@/lib/api/browser", () => ({ setUnauthorizedHandler: vi.fn() }));

import { SessionProvider } from "./session-provider";

const user = (id: number, role = "warehouse") => ({ id, username: `u${id}`, role, is_active: true });

function Probe() {
  const [mountedAt] = React.useState(() => Math.random());
  return <span data-testid="probe">{mountedAt}</span>;
}

function tree(client: QueryClient, id: number) {
  return (
    <QueryClientProvider client={client}>
      <SessionProvider user={user(id) as never}>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>
  );
}

describe("SessionProvider identity isolation (Phase 14C, D10)", () => {
  it("keeps the cache while the same user re-renders", () => {
    const client = new QueryClient();
    const { rerender } = render(tree(client, 1));
    client.setQueryData(["inventory-movements", "list", "1", {}], { items: ["admin-only"] });
    rerender(tree(client, 1));
    expect(client.getQueryData(["inventory-movements", "list", "1", {}])).toEqual({ items: ["admin-only"] });
  });

  it("drops every cached response and remounts the subtree when the user changes", () => {
    const client = new QueryClient();
    const { rerender } = render(tree(client, 1));
    client.setQueryData(["inventory-movements", "list", "1", {}], { items: ["admin-only"] });
    client.setQueryData(["dashboard", "recent-transactions"], ["privileged remark"]);
    const before = screen.getByTestId("probe").textContent;

    rerender(tree(client, 2));

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.getByTestId("probe").textContent).not.toBe(before); // local UI state reset
  });
});
