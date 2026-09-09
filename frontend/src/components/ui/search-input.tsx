"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/** Debounced search box. Local text state; commits `value` after `delay` ms. */
export function SearchInput({
  value,
  onCommit,
  placeholder = "Search…",
  ariaLabel = "Search",
  delay = 250,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  delay?: number;
  className?: string;
}) {
  const [text, setText] = React.useState(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // keep in sync when the URL / external value changes (back button, filter reset)
  const [prev, setPrev] = React.useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <label className={cn("relative flex min-w-[200px] flex-1 items-center", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-[10px] h-[14px] w-[14px] text-[var(--faint)]" />
      <input
        type="search"
        value={text}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onCommit(v), delay);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-9 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] pl-8 pr-3 text-[13px] outline-none focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      />
    </label>
  );
}
