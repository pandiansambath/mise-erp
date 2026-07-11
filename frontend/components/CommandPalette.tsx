"use client";

// ⌘K — the command palette. One keystroke from anywhere to any page or quick
// action. Glass panel, well input, arrow-key navigation, recents remembered.
// Items arrive pre-filtered by RBAC/features from the shell.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PaletteItem = {
  href: string;
  label: string;
  icon: string;
  /** extra search words, e.g. "p&l profit" for Reports */
  keywords?: string;
  group?: string;
};

const RECENTS_KEY = "mise.palette.recents";

/** Quick deep-links that go beyond plain navigation. */
export const QUICK_ACTIONS: PaletteItem[] = [
  { href: "/inventory?low=1", label: "Show low stock", icon: "⚠️", keywords: "reorder alert stock", group: "Actions" },
  { href: "/purchasing?new=1", label: "New purchase order", icon: "🛒", keywords: "po indent buy", group: "Actions" },
  { href: "/expenses?new=1", label: "Add an expense", icon: "💸", keywords: "cost spend", group: "Actions" },
  { href: "/sales?new=1", label: "Record today's sales", icon: "🧾", keywords: "takings till cash", group: "Actions" },
  { href: "/rota?copy=1", label: "Copy last week's rota", icon: "🗓️", keywords: "shifts schedule", group: "Actions" },
];

function score(item: PaletteItem, q: string): number {
  if (!q) return 1;
  const hay = `${item.label} ${item.keywords ?? ""}`.toLowerCase();
  const needle = q.toLowerCase().trim();
  if (hay.startsWith(needle)) return 100;
  const wordStart = hay.split(/\s+/).some((w) => w.startsWith(needle));
  if (wordStart) return 60;
  if (hay.includes(needle)) return 30;
  // loose subsequence ("inv" → i·n·v anywhere, in order)
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i >= needle.length ? 8 : 0;
}

export default function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    try {
      setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"));
    } catch {
      setRecents([]);
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const all = useMemo(() => [...items, ...QUICK_ACTIONS], [items]);

  const results = useMemo(() => {
    const scored = all
      .map((it) => ({ it, s: score(it, q) }))
      .filter((x) => x.s > 0);
    if (!q) {
      // no query → recents first, then everything in shell order
      const rank = (href: string) => {
        const i = recents.indexOf(href);
        return i === -1 ? 999 : i;
      };
      scored.sort((a, b) => rank(a.it.href) - rank(b.it.href));
    } else {
      scored.sort((a, b) => b.s - a.s);
    }
    return scored.slice(0, 12).map((x) => x.it);
  }, [all, q, recents]);

  const go = useCallback(
    (item: PaletteItem) => {
      try {
        const next = [item.href, ...recents.filter((h) => h !== item.href)].slice(0, 6);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      onClose();
      router.push(item.href);
    },
    [onClose, recents, router],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter" && results[sel]) {
        e.preventDefault();
        go(results[sel]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, sel, onClose, go]);

  // keep the selected row in view
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="mise-fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="mise-palette-in absolute left-1/2 top-[16vh] w-[min(600px,92vw)] -translate-x-1/2">
        {/* theme-safe surface: paper, not glass — glass washes out in light mode */}
        <div className="overflow-hidden rounded-2xl border border-line bg-paper-2/95 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="mise-well m-3 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
            <span aria-hidden className="text-fg-faint">⌕</span>
            <input
              ref={inputRef}
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              placeholder="Jump to a page or action…"
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
            />
            <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">esc</kbd>
          </div>
          <div ref={listRef} className="mise-noscrollbar max-h-[46vh] overflow-y-auto overscroll-contain px-2 pb-2">
            {results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-fg-faint">Nothing matches “{q}”</p>
            )}
            {results.map((it, i) => (
              <button
                key={it.href}
                type="button"
                data-idx={i}
                onMouseEnter={() => setSel(i)}
                onClick={() => go(it)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-150 ${
                  sel === i ? "mise-raised text-fg" : "text-fg-soft"
                }`}
              >
                <span aria-hidden className="w-5 text-center">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.group === "Actions" ? (
                  <span className="rounded-full bg-copper-500/15 px-2 py-0.5 text-[10px] font-medium text-copper-300">action</span>
                ) : recents.includes(it.href) && !q ? (
                  <span className="text-[10px] text-fg-faint">recent</span>
                ) : null}
                {sel === i && <kbd className="font-mono text-[10px] text-fg-faint">↵</kbd>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-fg-faint">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span className="ml-auto font-mono tracking-wide">MISE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
