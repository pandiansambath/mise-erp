"use client";

// Searchable typeahead: type to live-filter existing options, click a match,
// or keep what you typed as a brand-new value. Case-insensitive matching so
// "Main" and "main" don't become duplicates. Used for category/unit/dish-name.
import { useEffect, useRef, useState } from "react";

export function ComboBox({
  value,
  onChange,
  options,
  placeholder = "Type to search…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // close when clicking outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = value.trim().toLowerCase();
  // de-dupe options case-insensitively (keep first spelling), then filter by query
  const seen = new Set<string>();
  const uniq = options.filter((o) => {
    const k = o.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const matches = q ? uniq.filter((o) => o.toLowerCase().includes(q)) : uniq;
  const exact = uniq.some((o) => o.toLowerCase() === q);
  const showAddNew = q.length > 0 && !exact;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  const base =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={base}
        autoComplete="off"
      />
      {open && (matches.length > 0 || showAddNew) && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {matches.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full px-3 py-2 text-left ${
                  i === active ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {o}
              </button>
            </li>
          ))}
          {showAddNew && (
            <li className="border-t border-slate-100">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(value.trim());
                }}
                className="block w-full px-3 py-2 text-left font-medium text-brand-700 hover:bg-brand-50"
              >
                + Use &quot;{value.trim()}&quot; (new)
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
