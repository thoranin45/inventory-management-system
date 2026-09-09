"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search } from "lucide-react";

import { useGlobalSearch } from "@/lib/query/hooks";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

interface PaletteContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  openPalette: () => void;
}
const PaletteContext = React.createContext<PaletteContextValue | null>(null);

/** Maps a backend search-result type to an app route prefix. */
const TYPE_ROUTE: Record<string, string> = {
  product: "/products",
  sales_order: "/sales",
  purchase_order: "/purchase-orders",
  transfer: "/transfers",
  batch: "/stock",
  customer: "/customers",
  supplier: "/suppliers",
};
const TYPE_LABEL: Record<string, string> = {
  product: "Products",
  sales_order: "Sales orders",
  purchase_order: "Purchase orders",
  transfer: "Transfers",
  batch: "Batches",
  customer: "Customers",
  supplier: "Suppliers",
};

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const router = useRouter();

  const openPalette = React.useCallback(() => setOpen(true), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // reset the query when the palette closes — adjust during render, no effect
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open && query !== "") setQuery("");
  }

  const { data, isFetching, isError } = useGlobalSearch(query, open);

  const grouped = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["results"]>();
    for (const r of data?.results ?? []) {
      const list = map.get(r.type) ?? [];
      list.push(r);
      map.set(r.type, list);
    }
    return [...map.entries()];
  }, [data]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const value = React.useMemo(() => ({ open, setOpen, openPalette }), [open, openPalette]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        shouldFilter={false}
        className="fixed left-1/2 top-[12vh] z-[80] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]"
        overlayClassName="fixed inset-0 z-[80] bg-[rgba(10,11,13,0.4)]"
      >
        <div className="flex items-center gap-[10px] border-b border-[var(--border)] px-4">
          <Search aria-hidden className="h-4 w-4 flex-none text-[var(--faint)]" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search products, orders, lots…"
            className="h-12 flex-1 bg-transparent text-[14px] text-[var(--foreground)] outline-none placeholder:text-[var(--faint)]"
          />
          <kbd className="rounded-[var(--r-sm)] border border-[var(--border-strong)] px-[6px] py-[1px] text-[11px] text-[var(--muted)]">
            Esc
          </kbd>
        </div>

        <Command.List className="max-h-[52vh] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <>
              <Command.Group
                heading="Jump to"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:wc-section-label"
              >
                {NAV_ITEMS.map((n) => (
                  <PaletteItem key={n.key} onSelect={() => go(n.href)} title={n.label} sub="Navigate" />
                ))}
              </Command.Group>
            </>
          ) : isError ? (
            <div className="px-3 py-6 text-[12.5px] text-[var(--danger)]">Search is unavailable right now.</div>
          ) : (
            <>
              {isFetching && !data ? (
                <div className="px-3 py-6 text-[12.5px] text-[var(--muted)]">Searching…</div>
              ) : null}
              {!isFetching && data && data.results.length === 0 ? (
                <Command.Empty className="px-3 py-6 text-[12.5px] text-[var(--muted)]">
                  No matches for “{query}”.
                </Command.Empty>
              ) : null}
              {grouped.map(([type, items]) => (
                <Command.Group
                  key={type}
                  heading={TYPE_LABEL[type] ?? type}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:wc-section-label"
                >
                  {items.map((r) => (
                    <PaletteItem
                      key={`${r.type}:${r.id}`}
                      onSelect={() => go(`${TYPE_ROUTE[r.type] ?? "/dashboard"}/${r.id}`)}
                      title={r.label}
                      sub={[r.sublabel, r.status].filter(Boolean).join(" · ") || undefined}
                    />
                  ))}
                </Command.Group>
              ))}
              {data?.truncated ? (
                <div className="px-3 py-2 text-[11px] text-[var(--faint)]">Showing the top matches only.</div>
              ) : null}
            </>
          )}
        </Command.List>
      </Command.Dialog>
    </PaletteContext.Provider>
  );
}

function PaletteItem({
  title,
  sub,
  onSelect,
}: {
  title: string;
  sub?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--r-sm)] px-2 py-[10px] text-[13px]",
        "data-[selected=true]:bg-[var(--accent-subtle)] data-[selected=true]:text-[var(--foreground)]",
      )}
    >
      <span className="truncate font-medium">{title}</span>
      {sub ? <span className="truncate text-[11px] text-[var(--muted)]">{sub}</span> : null}
    </Command.Item>
  );
}

export function useCommandPalette(): PaletteContextValue {
  const ctx = React.useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within <CommandPaletteProvider>");
  return ctx;
}
