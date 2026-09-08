"use client";

// MOVING THINGS INTO A CATEGORY, THE WAY THE ROTA MOVES A SHIFT.
//
//   "in inventory we have a category edit option, but I want one enhanced
//    feature like: if I want to create a new category and want to move/copy
//    item to that category... but wait, if we copy means it will create
//    duplicate confusion, so better move — keep move option alone. With
//    enhanced UI, like move one or move multiple. Also show glowing effect for
//    moving things like we do in rota drag and move, that kinda glowing effect,
//    until we press OK. Until OK we undo redo with Ctrl+Z / Ctrl+Y."
//
// He asked for move OR copy and then talked himself out of copy inside the same
// sentence, which is the right instinct: the same sack of rice filed under two
// categories is one sack counted twice, and every total built on it is wrong
// afterwards. So there is no copy here, deliberately.
//
// The other half is the contract, and it is BETTER than the rota's. The rota
// writes each move immediately and undoes it with a second write, because a
// shift moved on a shared screen has to be true for everyone at once. Nothing
// here leaves the browser until OK, so undo is free and exact — Ctrl+Z is a
// pointer moving down a list, not a compensating trip to the server. That also
// means a closed tab changes nothing, which is the right way for a bulk edit to
// fail.

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { SheetPopup } from "@/components/SheetPopup";
import { Select } from "@/components/Select";

export type MovableItem = { id: string; name: string; category: string | null; unit?: string };

type Move = { ids: string[]; to: string; from: Record<string, string | null> };

export function MoveToCategory({
  items,
  categories,
  onClose,
  onDone,
}: {
  items: MovableItem[];
  categories: string[];
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState("");
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The staged moves, and the ones taken back. Two stacks is all an undo/redo
  // is when nothing has been written yet.
  const [moves, setMoves] = useState<Move[]>([]);
  const [redos, setRedos] = useState<Move[]>([]);

  /** Where each item sits RIGHT NOW, staged moves applied. */
  const staged = useMemo(() => {
    const at: Record<string, string | null> = {};
    for (const it of items) at[it.id] = it.category;
    for (const m of moves) for (const id of m.ids) at[id] = m.to;
    return at;
  }, [items, moves]);

  /** Which items a staged move has touched — the glow. */
  const glowing = useMemo(() => {
    const s = new Set<string>();
    for (const m of moves) for (const id of m.ids) s.add(id);
    return s;
  }, [moves]);

  const target = (newName.trim() || dest).trim();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(needle) ||
            (staged[i.id] ?? "").toLowerCase().includes(needle),
        )
      : items;
    // Grouped by where they are NOW, so a staged move visibly relocates the row
    // rather than just tinting it — you can see the category filling up.
    const by = new Map<string, MovableItem[]>();
    for (const i of list) {
      const k = staged[i.id] ?? "Uncategorised";
      const arr = by.get(k);
      if (arr) arr.push(i);
      else by.set(k, [i]);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, q, staged]);

  function stage() {
    const ids = [...picked].filter((id) => staged[id] !== target);
    if (!target || ids.length === 0) return;
    const from: Record<string, string | null> = {};
    for (const id of ids) from[id] = staged[id];
    setMoves((m) => [...m, { ids, to: target, from }]);
    setRedos([]); // a fresh move ends the redo trail, as in every editor
    setPicked(new Set());
    setNewName("");
  }

  function undo() {
    setMoves((m) => {
      if (m.length === 0) return m;
      const last = m[m.length - 1];
      setRedos((r) => [...r, last]);
      return m.slice(0, -1);
    });
  }

  function redo() {
    setRedos((r) => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      setMoves((m) => [...m, last]);
      return r.slice(0, -1);
    });
  }

  // Ctrl+Z / Ctrl+Y, and Ctrl+Shift+Z because that is the same key everywhere
  // else. Never while typing in a field: Ctrl+Z in the name box has to mean
  // what it means in every other box on earth.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function apply() {
    if (moves.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      // Collapsed to ONE call per destination: staging six moves into the same
      // category and sending six requests would be six chances to half-apply.
      const byDest = new Map<string, Set<string>>();
      for (const m of moves) {
        for (const id of m.ids) {
          const cur = byDest.get(m.to) ?? new Set<string>();
          cur.add(id);
          byDest.set(m.to, cur);
        }
      }
      // An item staged twice belongs only to where it ended up.
      for (const [to, ids] of byDest) {
        for (const id of [...ids]) if (staged[id] !== to) ids.delete(id);
      }
      for (const [to, ids] of byDest) {
        if (ids.size === 0) continue;
        await api.post("/inventory/categories/move", { item_ids: [...ids], to_name: to });
      }
      await onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not move those items.");
    } finally {
      setBusy(false);
    }
  }

  const movedCount = glowing.size;

  return (
    <SheetPopup
      depth={2}
      columns={3}
      onClose={onClose}
      title="Move items into a category"
      subtitle="Nothing is saved until you press OK"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-soft">
            {movedCount === 0
              ? "Nothing staged yet"
              : `${movedCount} item${movedCount === 1 ? "" : "s"} will move`}
          </span>
          {moves.length > 0 && (
            <button
              type="button"
              onClick={undo}
              data-testid="move-undo"
              className="mise-btn-flat mise-press min-h-[38px] px-3 text-xs font-semibold text-fg-soft"
            >
              ↶ Undo
            </button>
          )}
          {redos.length > 0 && (
            <button
              type="button"
              onClick={redo}
              data-testid="move-redo"
              className="mise-btn-flat mise-press min-h-[38px] px-3 text-xs font-semibold text-fg-soft"
            >
              ↷ Redo
            </button>
          )}
          <span className="text-[11px] text-fg-faint">Ctrl+Z undo · Ctrl+Y redo</span>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || moves.length === 0}
            data-tone="brand"
            data-testid="move-apply"
            className="mise-btn-flat mise-press ml-auto min-h-[44px] px-5 text-sm disabled:opacity-40"
          >
            {busy ? "Moving…" : "OK — move them"}
          </button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <section className="mise-card-inset rounded-2xl p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
            Where to
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] text-fg-soft">An existing category</span>
              <Select
                value={dest}
                onChange={(v) => {
                  setDest(v);
                  setNewName("");
                }}
                options={[
                  { value: "", label: "Choose…" },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-fg-soft">…or a brand new one</span>
              <input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (e.target.value) setDest("");
                }}
                placeholder="e.g. Spices"
                data-testid="move-new-category"
                className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-sm outline-none"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-fg-faint">
            {/* A category IS just a name on the item, so typing an unused one is
                how you make it — which is why this is one action and not two. */}
            Typing a name nobody has used yet creates that category. Items only ever
            MOVE — nothing is copied, because the same item in two categories is one
            sack of rice counted twice.
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 Find an item…"
            aria-label="Find an item"
            className="mise-well min-h-[42px] flex-1 rounded-xl px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={stage}
            disabled={!target || picked.size === 0}
            data-tone="brand"
            data-testid="move-stage"
            className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm disabled:opacity-40"
          >
            Move {picked.size > 0 ? picked.size : ""} →{" "}
            {target || "…"}
          </button>
        </div>

        {err && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300">
            {err}
          </p>
        )}

        <div className="mise-noscrollbar max-h-[46vh] space-y-3 overflow-y-auto pr-1">
          {shown.map(([cat, rows]) => (
            <section key={cat}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-fg-soft">{cat}</h3>
                <span className="text-[11px] tabular-nums text-fg-faint">{rows.length}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </div>
              <ul
                className="grid gap-1.5"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(14rem,100%),1fr))" }}
              >
                {rows.map((it) => {
                  const on = picked.has(it.id);
                  const moved = glowing.has(it.id);
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(it.id)) n.delete(it.id);
                            else n.add(it.id);
                            return n;
                          })
                        }
                        data-testid="move-item"
                        // The glow is the rota's, reused rather than reinvented:
                        // "show glowing effect for moving things like we do in
                        // rota drag and move".
                        className={`mise-card-inset mise-press flex w-full items-center gap-2 rounded-xl p-2 text-left ${
                          moved ? "mise-moved-glow" : ""
                        } ${on ? "ring-2 ring-brand-400/60" : ""}`}
                      >
                        <span
                          aria-hidden
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${
                            on
                              ? "border-brand-400 bg-brand-500 text-white"
                              : "border-line-2 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{it.name}</span>
                        {moved && (
                          <span className="shrink-0 rounded-md bg-copper-500 px-1 py-0.5 text-[9px] font-bold text-white">
                            moved
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-fg-faint">Nothing matches “{q}”.</p>
          )}
        </div>
      </div>
    </SheetPopup>
  );
}
