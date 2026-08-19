"use client";

// 🍽️ THE MENU — what the diner sees when they scan the table.
//
//   "super admin can decide the menu page or he can upload the menu... super
//    admin can delete the menu, delete any recipe, mark as out of stock, or
//    over, or not served, only served at this particular time etc."
//   "while adding menu items we need feature like copy items from recipe
//    section... then if super wants to add 1 or 2 items manually then we need
//    allow him. We need to be flexible more and more."
//
// Two doors, neither of them the only one: pull the whole thing from Recipes
// (where the costing already lives, so margin comes free) or type one in. A
// kitchen that has built its recipes should not retype them; a kitchen that
// wants to add a special for tonight should not have to build a recipe first.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, postForm } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: string;
  emoji: string | null;
  availability: string;
  serve_from: string | null;
  serve_to: string | null;
  prep_minutes: number | null;
  recipe_id: string | null;
  has_photo?: boolean;
};

/** The four states, said the way a kitchen says them. */
const STATES: { key: string; label: string; hint: string; tone: string }[] = [
  { key: "available", label: "On the menu", hint: "Diners can order it", tone: "bg-brand-600 text-white" },
  { key: "out_of_stock", label: "Out of stock", hint: "Back when it arrives", tone: "bg-amber-500/80 text-white" },
  { key: "finished_today", label: "Finished today", hint: "Clears itself tomorrow", tone: "bg-amber-600/80 text-white" },
  { key: "not_served", label: "Off the menu", hint: "Hidden, but kept", tone: "bg-fg-faint/40 text-fg" },
];

export default function MenuPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "orders:write");

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", category: "Mains", prep: "" });
  // What the AI read out of an uploaded menu. NOTHING is saved until these are
  // confirmed — a model that can silently add twenty dishes priced from a
  // blurry photo is a mess somebody unpicks dish by dish.
  const [proposed, setProposed] = useState<
    { name: string; price: string; category: string; already_on_menu?: boolean }[] | null
  >(null);
  const [reading, setReading] = useState(false);

  function load() {
    return api
      .get<MenuItem[]>("/ordering/menu")
      .then(setItems)
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function patch(m: MenuItem, body: Record<string, unknown>) {
    setBusy(m.id);
    setErr(null);
    try {
      await api.patch(`/ordering/menu/${m.id}`, body);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save that.");
    } finally {
      setBusy(null);
    }
  }

  async function importRecipes() {
    setBusy("import");
    setErr(null);
    try {
      const made = await api.post<MenuItem[]>("/ordering/menu/import-recipes", {});
      await load();
      setErr(
        made.length
          ? null
          : "Every priced recipe is already on the menu — nothing new to bring across.",
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not import from recipes.");
    } finally {
      setBusy(null);
    }
  }

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    setErr(null);
    try {
      await api.post("/ordering/menu", {
        name: form.name.trim(),
        price: form.price,
        category: form.category.trim() || "Mains",
        ...(form.prep ? { prep_minutes: parseInt(form.prep, 10) } : {}),
      });
      setForm({ name: "", price: "", category: form.category, prep: "" });
      setAdding(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not add that dish.");
    } finally {
      setBusy(null);
    }
  }

  /** "he can upload the menu so that our AI can see the menu photo or excel." */
  async function readMenu(file: File) {
    setReading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const d = await postForm<{ items: typeof proposed; found: number }>(
        "/ordering/menu/read",
        fd,
      );
      setProposed(d.items ?? []);
      if (!d.found) setErr("I could not find any dishes with a price in that file.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not read that menu.");
    } finally {
      setReading(false);
    }
  }

  async function addProposed() {
    const wanted = (proposed ?? []).filter((p) => !p.already_on_menu);
    setBusy("bulk");
    try {
      for (const p of wanted) {
        await api
          .post("/ordering/menu", {
            name: p.name,
            price: p.price,
            category: p.category || "Mains",
          })
          .catch(() => {});
      }
      setProposed(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(m: MenuItem) {
    const ok = await confirm({
      title: `Remove ${m.name}?`,
      message:
        "It disappears from the diner's menu straight away. Past orders keep it, so your " +
        "history stays intact. To take it off for now instead, set it to “Off the menu”.",
      confirmText: "Remove it",
      tone: "danger",
    });
    if (!ok) return;
    await api.delete(`/ordering/menu/${m.id}`).catch(() => {});
    await load();
  }

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? items.filter(
          (m) => m.name.toLowerCase().includes(t) || m.category.toLowerCase().includes(t),
        )
      : items;
    return [...list].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
  }, [items, q]);

  const live = items.filter((m) => m.availability === "available").length;
  const off = items.length - live;

  return (
    <Workbench
      title="Menu"
      subtitle="What a diner sees when they scan the table."
      tools={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍  Find a dish…"
            className="mise-well min-w-[10rem] flex-1 rounded-xl px-3.5 py-2.5 text-sm outline-none"
          />
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => setAdding((a) => !a)}
                className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {adding ? "Close" : "＋ Add a dish"}
              </button>
              <label
                className="mise-press mise-raised cursor-pointer rounded-xl px-4 py-2.5 text-sm font-medium text-fg-soft"
                title="A photo of your menu, or a spreadsheet — DineAI reads it and you confirm"
              >
                {reading ? "Reading…" : "📷 Read a menu"}
                <input
                  type="file"
                  accept="image/*,.csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readMenu(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={importRecipes}
                disabled={busy === "import"}
                title="Bring every priced recipe across — the costing comes with it"
                className="mise-press mise-raised rounded-xl px-4 py-2.5 text-sm font-medium text-fg-soft disabled:opacity-40"
              >
                {busy === "import" ? "Importing…" : "📋 Copy from Recipes"}
              </button>
            </>
          )}
        </div>
      }
      tally={
        <p className="text-xs text-fg-faint">
          <b className="text-fg-soft tabular-nums">{live}</b> on the menu ·{" "}
          <b className="text-fg-soft tabular-nums">{off}</b> off or out of stock · a dish that is
          off still shows the diner <i>why</i>, and when it is back
        </p>
      }
    >
      {err && (
        <p className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          {err}
        </p>
      )}

      {/* THE PROPOSAL. Read, shown, and only written when a person says so. */}
      {proposed && (
        <div className="mise-card3d mise-pop mb-4 p-4">
          <p className="text-sm font-semibold text-fg">
            Found {proposed.length} dish{proposed.length === 1 ? "" : "es"}
          </p>
          <p className="mt-0.5 text-[11px] text-fg-faint">
            Nothing is saved yet. Check every price — a misread menu becomes a wrong bill.
          </p>
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {proposed.map((p, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-2 border-b border-line/50 py-1.5 text-sm last:border-0"
              >
                <input
                  value={p.name}
                  onChange={(e) =>
                    setProposed((ps) =>
                      (ps ?? []).map((x, k) => (k === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  className="mise-well min-w-0 flex-1 rounded-lg px-2 py-1 text-sm outline-none"
                />
                <input
                  value={p.price}
                  onChange={(e) =>
                    setProposed((ps) =>
                      (ps ?? []).map((x, k) =>
                        k === i ? { ...x, price: e.target.value.replace(/[^\d.]/g, "") } : x,
                      ),
                    )
                  }
                  className="mise-well w-20 rounded-lg px-2 py-1 text-right text-sm outline-none"
                />
                <input
                  value={p.category}
                  onChange={(e) =>
                    setProposed((ps) =>
                      (ps ?? []).map((x, k) => (k === i ? { ...x, category: e.target.value } : x)),
                    )
                  }
                  className="mise-well w-28 rounded-lg px-2 py-1 text-sm outline-none"
                />
                {p.already_on_menu && (
                  <span className="mise-tone-warn text-[10px]">already on the menu</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addProposed}
              disabled={busy === "bulk"}
              className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === "bulk"
                ? "Adding…"
                : `Add ${proposed.filter((p) => !p.already_on_menu).length} to the menu`}
            </button>
            <button
              type="button"
              onClick={() => setProposed(null)}
              className="mise-press rounded-xl border border-line px-3 py-2 text-sm text-fg-soft"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {adding && canWrite && (
        <form onSubmit={addOne} className="mise-card3d mise-pop mb-4 p-4">
          <p className="text-sm font-semibold text-fg">A dish, by hand</p>
          <p className="mt-0.5 text-[11px] text-fg-faint">
            For tonight&apos;s special, or anything that has no recipe behind it yet.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Name</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                placeholder="Mutton Chukka"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Price</span>
              <input
                required
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, "") })}
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                placeholder="12.50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Section</span>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                placeholder="Mains"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Takes about (min)</span>
              <input
                inputMode="numeric"
                value={form.prep}
                onChange={(e) => setForm({ ...form, prep: e.target.value.replace(/\D/g, "") })}
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                placeholder="20"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={busy === "add"}
            className="mise-press mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy === "add" ? "Adding…" : "Add it"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-4xl" aria-hidden>🍽️</p>
            <p className="mt-3 text-sm font-medium text-fg">
              {items.length === 0 ? "No menu yet" : "Nothing matches that"}
            </p>
            {items.length === 0 && (
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-fg-faint">
                Press <b>Copy from Recipes</b> to bring across everything you have already
                costed, then add anything else by hand.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <ul
          className="mise-stagger grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(19rem, 100%), 1fr))" }}
        >
          {shown.map((m) => {
            const state = STATES.find((s) => s.key === m.availability) ?? STATES[0];
            return (
              <li key={m.id}>
                <div className={`mise-card3d p-3.5 ${m.availability === "available" ? "" : "opacity-75"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display text-[15px] font-semibold text-fg">
                        {m.name}
                      </p>
                      <p className="text-[11px] text-fg-faint">
                        {m.category} · {format(m.price)}
                        {m.recipe_id ? " · from a recipe" : ""}
                      </p>
                    </div>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => remove(m)}
                        aria-label={`Remove ${m.name}`}
                        className="mise-press shrink-0 rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:border-rose-400/50 hover:text-rose-300"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* THE FOUR STATES, as one control — they are one question
                      with four answers, not four switches. */}
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {STATES.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        disabled={!canWrite || busy === m.id}
                        onClick={() => patch(m, { availability: s.key })}
                        title={s.hint}
                        className={`mise-press rounded-lg px-2 py-1 text-[10px] font-medium transition ${
                          m.availability === s.key ? state.tone : "mise-well text-fg-faint"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {/* Served only at certain hours, and how long it takes. */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line/50 pt-2.5 text-[11px] text-fg-faint">
                    <span>Served</span>
                    <input
                      type="time"
                      defaultValue={m.serve_from?.slice(0, 5) ?? ""}
                      disabled={!canWrite}
                      onBlur={(e) => patch(m, { serve_from: e.target.value || null })}
                      className="mise-well rounded-lg px-1.5 py-1 text-[11px] outline-none"
                    />
                    <span>to</span>
                    <input
                      type="time"
                      defaultValue={m.serve_to?.slice(0, 5) ?? ""}
                      disabled={!canWrite}
                      onBlur={(e) => patch(m, { serve_to: e.target.value || null })}
                      className="mise-well rounded-lg px-1.5 py-1 text-[11px] outline-none"
                    />
                    <span className="w-full text-[10px] text-fg-faint/80">
                      Leave both blank for all day
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span>Takes</span>
                      <input
                        inputMode="numeric"
                        defaultValue={m.prep_minutes ?? ""}
                        disabled={!canWrite}
                        placeholder="—"
                        aria-label={`Minutes to make ${m.name}`}
                        onBlur={(e) =>
                          patch(m, {
                            prep_minutes: e.target.value ? parseInt(e.target.value, 10) : null,
                          })
                        }
                        className="mise-well w-12 rounded-lg px-1.5 py-1 text-center text-[11px] outline-none"
                      />
                      <span>min</span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Workbench>
  );
}
