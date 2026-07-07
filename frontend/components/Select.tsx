"use client";

// A small custom <select> replacement with an animated popover (mise-pop),
// click-outside to close, a rotating chevron and a ✓ on the active option.
//
// The popover is rendered in a PORTAL with fixed positioning, so it can never be
// clipped by a scrolling/overflow-hidden parent (e.g. the purchasing tray). It
// auto-flips upward when there isn't room below, and follows scroll/resize.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string };

type Pos = { left: number; top: number; bottom: number; width: number; maxH: number; up: boolean };

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
  const [pos, setPos] = useState<Pos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 10;
    const above = r.top - 10;
    const up = below < 200 && above > below;
    const maxH = Math.max(120, Math.min(288, up ? above : below));
    setPos({ left: r.left, top: r.bottom, bottom: window.innerHeight - r.top, width: r.width, maxH, up });
  }, []);

  // Measure when opening (portal only renders once positioned, so there's no flash).
  useEffect(() => {
    if (open) place();
  }, [open, place]);

  // Close on outside click. CLOSE on scroll too (like a native <select>) so the
  // open popover never floats over other cards when a container scrolls.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = (e?: Event) => {
      // don't close when the scroll happens INSIDE the popover's own option list
      if (e && e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", close);
    // capture=true so we also catch scrolls inside any nested scroll container
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const sel = options.find((o) => o.value === value);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
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
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            className="mise-pop fixed z-[95] overflow-auto overscroll-contain rounded-xl border border-line bg-paper-2 p-1 shadow-2xl shadow-black/40"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxH,
              ...(pos.up ? { bottom: pos.bottom + 6 } : { top: pos.top + 6 }),
            }}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
