"use client";

// A small custom <select> replacement with an animated popover (mise-pop),
// click-outside to close, a rotating chevron and a ✓ on the active option.
// Solid surface (no transparency) so it always reads crisp.

import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const sel = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none transition hover:border-brand-400/50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
      >
        <span className={sel ? "truncate text-fg" : "truncate text-fg-faint"}>
          {sel ? sel.label : placeholder}
        </span>
        <span
          aria-hidden
          className={`ml-2 shrink-0 text-[10px] text-fg-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          className="mise-pop absolute z-40 mt-1.5 max-h-60 w-full overflow-auto rounded-xl border border-line bg-paper-2 p-1 shadow-2xl shadow-black/40"
        >
          {options.map((o) => (
            <button
              key={o.value || "_empty"}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-glass/10 ${
                o.value === value ? "font-medium text-brand-300" : "text-fg-soft"
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <span className="text-brand-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
