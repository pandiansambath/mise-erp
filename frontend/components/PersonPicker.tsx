"use client";

// Pick a person by typing their name.
//
//   "here pandian sambath is big name which hiding the emp id. we need to handle
//    this too. dropdown also not that much nice, we need cool ui dropdown with
//    search feature"
//
// The native select truncated to "pandian sambath (EMPO…", swallowing the one
// part that tells two people apart — and on a roster of thirty it is a list you
// scroll rather than a thing you choose from.
//
// So: type to narrow, name and code on separate lines so neither has to fight
// the other for width, and the code stays legible however long the name is.

import { useEffect, useMemo, useRef, useState } from "react";

export type Person = { id: string; name: string; code?: string | null; note?: string | null };

export function PersonPicker({
  people,
  value,
  onChange,
  placeholder = "Search staff…",
  className = "",
  testId,
}: {
  people: Person[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  const chosen = people.find((p) => p.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    // Name OR code, because people search by whichever they happen to know.
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.code ?? "").toLowerCase().includes(needle),
    );
  }, [people, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setQ("");
          setActive(0);
        }}
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mise-well mise-press flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none"
      >
        <span className="min-w-0 flex-1">
          {chosen ? (
            <>
              <span className="block truncate font-medium text-fg">{chosen.name}</span>
              {chosen.code && (
                // Its own line. Sharing one with the name is what pushed the
                // code off the end of the box.
                <span className="block truncate text-[11px] text-fg-faint">{chosen.code}</span>
              )}
            </>
          ) : (
            <span className="text-fg-faint">{placeholder}</span>
          )}
        </span>
        <span aria-hidden className={`shrink-0 text-fg-faint transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="mise-pop absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-paper shadow-2xl shadow-black/40">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, matches.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && matches[active]) {
                  e.preventDefault();
                  onChange(matches[active].id);
                  setOpen(false);
                }
              }}
              placeholder={placeholder}
              className="mise-well min-h-[38px] w-full rounded-lg px-3 py-2 text-sm outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-64 overflow-y-auto p-1">
            {matches.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-fg-faint">Nobody matches “{q}”.</li>
            ) : (
              matches.map((p, i) => {
                const on = p.id === value;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                      className={`mise-press flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${
                        on
                          ? "bg-brand-500/15 text-brand-200"
                          : i === active
                            ? "bg-glass/10 text-fg"
                            : "text-fg-soft"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-[11px] text-fg-faint">
                          {p.code}
                          {p.note ? ` · ${p.note}` : ""}
                        </span>
                      </span>
                      {on && <span aria-hidden className="shrink-0 text-brand-300">✓</span>}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
