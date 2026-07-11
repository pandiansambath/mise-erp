"use client";

// ⌘K — the command bar. Not just navigation: every page carries one-click
// actions ("Create a recipe", "Copy last week's rota") that deep-link straight
// into the target form — the page opens it, spotlights it and focuses the first
// field (see useDeepLink/spotlight in fx.tsx). Glass panel that works in both
// themes, arrow-key navigation, recents remembered.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PaletteItem = {
  href: string;
  label: string;
  icon: string;
  /** extra search words, e.g. "p&l profit" for Reports */
  keywords?: string;
  group?: string;
  /** page href this action belongs under — actions render nested below it */
  parent?: string;
};

const RECENTS_KEY = "mise.palette.recents";

/** One-click actions — each lands on the target page with the form open,
 *  spotlighted and focused. `parent` nests it under that page in results. */
export const QUICK_ACTIONS: PaletteItem[] = [
  { href: "/recipes?new=1", label: "Create a recipe", icon: "🍲", keywords: "dish menu costing new", group: "Actions", parent: "/recipes" },
  { href: "/rota?copy=1", label: "Copy last week's rota", icon: "🗓️", keywords: "shifts schedule duplicate", group: "Actions", parent: "/rota" },
  { href: "/sales?new=1", label: "Record today's takings", icon: "🧾", keywords: "sales till cash close", group: "Actions", parent: "/sales" },
  { href: "/expenses?new=1", label: "Add an expense", icon: "💸", keywords: "cost spend bill", group: "Actions", parent: "/expenses" },
  { href: "/purchasing?new=1", label: "Start a purchase order", icon: "🛒", keywords: "po indent buy order", group: "Actions", parent: "/purchasing" },
  { href: "/inventory?filter=low", label: "Show low stock", icon: "⚠️", keywords: "reorder alert running out", group: "Actions", parent: "/inventory" },
  { href: "/employees?new=1", label: "Add an employee", icon: "👤", keywords: "staff hire person new", group: "Actions", parent: "/employees" },
  { href: "/stock-take?focus=1", label: "Start a stock take", icon: "📋", keywords: "count stocktake", group: "Actions", parent: "/stock-take" },
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

  // Only offer actions whose parent page the user can actually see (RBAC).
  const allowedActions = useMemo(() => {
    const visible = new Set(items.map((it) => it.href));
    return QUICK_ACTIONS.filter((a) => !a.parent || visible.has(a.parent));
  }, [items]);

  const results = useMemo(() => {
    if (!q) {
      // Browsing: one-click actions lead (they're the point), then pages,
      // recents floated to the top of each band.
      const rank = (href: string) => {
        const i = recents.indexOf(href);
        return i === -1 ? 999 : i;
      };
      const acts = [...allowedActions].sort((a, b) => rank(a.href) - rank(b.href)).slice(0, 5);
      const pages = [...items].sort((a, b) => rank(a.href) - rank(b.href)).slice(0, 8);
      return [...acts, ...pages];
    }
    // Searching: score pages, then slot each page's matching actions directly
    // beneath it — "recipes" shows the page AND "↳ Create a recipe".
    const pages = items
      .map((it) => ({ it, s: score(it, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
    const acts = allowedActions
      .map((it) => ({ it, s: score(it, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
    const out: PaletteItem[] = [];
    const placed = new Set<string>();
    for (const p of pages) {
      out.push(p);
      for (const a of acts) {
        if (a.parent === p.href && !placed.has(a.href)) {
          out.push(a);
          placed.add(a.href);
        }
      }
    }
    // Actions that matched but whose parent page didn't — or actions matching
    // by their own words alone ("copy" → rota copy) — appended by score.
    for (const a of acts) if (!placed.has(a.href)) out.push(a);
    return out.slice(0, 12);
  }, [items, allowedActions, q, recents]);

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

  const firstPageIdx = results.findIndex((r) => r.group !== "Actions");

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="mise-fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="mise-palette-in absolute left-1/2 top-[16vh] w-[min(600px,92vw)] -translate-x-1/2">
        <div className="mise-glass-panel overflow-hidden rounded-2xl">
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
              placeholder="Do something or jump somewhere…"
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
            />
            <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">esc</kbd>
          </div>
          <div ref={listRef} className="mise-noscrollbar max-h-[46vh] overflow-y-auto overscroll-contain px-2 pb-2">
            {results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-fg-faint">Nothing matches “{q}”</p>
            )}
            {results.map((it, i) => {
              const isAction = it.group === "Actions";
              const nested = isAction && !!q; // searching → actions sit under their page
              return (
                <div key={it.href}>
                  {!q && i === 0 && isAction && (
                    <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-faint">
                      One-click actions
                    </p>
                  )}
                  {!q && i === firstPageIdx && firstPageIdx > 0 && (
                    <p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-faint">
                      Pages
                    </p>
                  )}
                  <button
                    type="button"
                    data-idx={i}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                    className={`flex w-full items-center gap-3 rounded-xl py-2.5 pr-3 text-left text-sm transition-colors duration-150 ${
                      nested ? "pl-8" : "pl-3"
                    } ${sel === i ? "mise-raised text-fg" : "text-fg-soft"}`}
                  >
                    {nested && <span aria-hidden className="-ml-3 text-fg-faint">↳</span>}
                    <span aria-hidden className="w-5 text-center">{it.icon}</span>
                    <span className="flex-1 truncate">{it.label}</span>
                    {isAction ? (
                      <span className="rounded-full bg-copper-500/15 px-2 py-0.5 text-[10px] font-medium text-copper-300">
                        1-click
                      </span>
                    ) : recents.includes(it.href) && !q ? (
                      <span className="text-[10px] text-fg-faint">recent</span>
                    ) : null}
                    {sel === i && <kbd className="font-mono text-[10px] text-fg-faint">↵</kbd>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-fg-faint">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> run</span>
            <span className="ml-auto font-mono tracking-wide">MISE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
