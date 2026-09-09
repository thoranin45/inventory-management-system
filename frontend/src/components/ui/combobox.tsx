"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ComboboxItem {
  id: number;
  label: string;
  sublabel?: string;
}

/**
 * Minimal server-driven combobox: the caller owns the option list (fetched
 * from a paginated search endpoint), we own keyboard + a11y. No thousands of
 * records are ever preloaded — `onSearch` is debounced by the caller's query.
 */
export function Combobox({
  value,
  onChange,
  items,
  onSearch,
  loading,
  placeholder = "Search…",
  emptyText = "No matches",
  ariaLabel,
  id,
}: {
  value: ComboboxItem | null;
  onChange: (item: ComboboxItem | null) => void;
  items: ComboboxItem[];
  onSearch: (term: string) => void;
  loading?: boolean;
  placeholder?: string;
  emptyText?: string;
  ariaLabel: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (item: ComboboxItem) => {
    onChange(item);
    setTerm("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && items[active]) {
        e.preventDefault();
        commit(items[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {value && !open ? (
        <button
          type="button"
          id={id}
          onClick={() => {
            setOpen(true);
            onSearch("");
          }}
          className="flex w-full items-center justify-between gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{value.label}</span>
            {value.sublabel ? (
              <span className="block truncate text-[11px] text-[var(--muted)]">{value.sublabel}</span>
            ) : null}
          </span>
          <ChevronsUpDown aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 focus-within:outline-2 focus-within:outline-[var(--focus)]">
          <Search aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
          <input
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={ariaLabel}
            autoComplete="off"
            value={term}
            placeholder={placeholder}
            onChange={(e) => {
              setTerm(e.target.value);
              setActive(0);
              setOpen(true);
              onSearch(e.target.value);
            }}
            onFocus={() => {
              setOpen(true);
              onSearch(term);
            }}
            onKeyDown={onKeyDown}
            className="min-h-11 w-full bg-transparent py-2 text-[13px] outline-none"
          />
          {loading ? <Loader2 aria-hidden className="h-4 w-4 flex-none animate-spin text-[var(--muted)] motion-reduce:animate-none" /> : null}
        </div>
      )}

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-[95] mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-lg)]"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[var(--muted)]">{loading ? "Searching…" : emptyText}</li>
          ) : (
            items.map((item, i) => (
              <li key={item.id} role="option" aria-selected={value?.id === item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(item)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px]",
                    i === active ? "bg-[var(--surface-sunken)]" : "",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.sublabel ? (
                      <span className="block truncate text-[11px] text-[var(--muted)]">{item.sublabel}</span>
                    ) : null}
                  </span>
                  {value?.id === item.id ? <Check aria-hidden className="h-4 w-4 flex-none text-[var(--accent)]" /> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
