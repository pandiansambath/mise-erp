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
import { api, ApiError, API_BASE, postForm } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";
import { SheetPopup } from "@/components/SheetPopup";
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
  // The dish whose details are open. Everything that used to sit inline on
  // every card lives in here now.
  const [editing, setEditing] = useState<MenuItem | null>(null);
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

  // WHY THIS PAGE WAS HARD TO READ, and it was not the cards.
  //
  //   "now menu section: see this UI, cards are not nice to see, i think you
  //    need to rebuild the whole menu page from the scratch."
  //
  // Thirteen dishes came out as thirteen identical rows, each saying "Main"
  // and each carrying a solid dark-red pill reading "On the menu". A word
  // printed thirteen times carries no information — the two that said "Off the
  // menu" were the whole message, and they were the hardest things on the page
  // to find because everything else was shouting the same colour.
  //
  // A menu has a SHAPE: starters, then mains, then desserts. That shape was
  // being thrown away by an alphabetical list, which is why every card had to
  // repeat its own category to make up for it. Group by course and the category
  // line disappears from every card at once, leaving room for the thing a menu
  // is actually about, which is the price.
  const [cat, setCat] = useState<string>("");

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const m of items) seen.set(m.category, (seen.get(m.category) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = items;
    if (needle) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(needle) || m.category.toLowerCase().includes(needle),
      );
    }
    if (cat) list = list.filter((m) => m.category === cat);
    return [...list].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
  }, [items, q, cat]);

  /** The visible dishes, in courses. A search that spans courses still shows
   *  them grouped, because "three of these are starters" is worth knowing even
   *  when you went looking for the word "chicken". */
  const courses = useMemo(() => {
    const by = new Map<string, MenuItem[]>();
    for (const m of shown) {
      const list = by.get(m.category);
      if (list) list.push(m);
      else by.set(m.category, [m]);
    }
    return [...by.entries()];
  }, [shown]);

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
                data-tone="brand"
                className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm"
              >
                {adding ? "Close" : "＋ Add a dish"}
              </button>
              <label
                className="mise-btn-flat mise-press flex cursor-pointer items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-fg-soft"
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
                className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm font-semibold text-fg-soft disabled:opacity-40"
              >
                {busy === "import" ? "Importing…" : "📋 Copy from Recipes"}
              </button>
            </>
          )}
        </div>
      }
      tally={
        /* CLICK, DON'T SCROLL. A menu with six courses and sixty dishes is a
           long page; the courses are the index for it, and an index you can
           press beats one you scroll past. */
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCat("")}
            className={`mise-press rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
              cat === "" ? "mise-btn-flat text-fg" : "text-fg-faint hover:text-fg-soft"
            }`}
            data-tone={cat === "" ? "brand" : undefined}
          >
            All {items.length}
          </button>
          {categories.map(([name, n]) => (
            <button
              key={name}
              type="button"
              onClick={() => setCat((c) => (c === name ? "" : name))}
              className={`mise-press rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                cat === name ? "mise-btn-flat text-fg" : "text-fg-faint hover:text-fg-soft"
              }`}
              data-tone={cat === name ? "brand" : undefined}
            >
              {name} {n}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-fg-faint">
            <b className="tabular-nums text-fg-soft">{live}</b> on ·{" "}
            <b className="tabular-nums text-fg-soft">{off}</b> off
          </span>
        </div>
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
        <div className="space-y-5">
          {courses.map(([course, dishes]) => (
            <section key={course}>
              {/* THE COURSE, said once. It used to be printed on all thirteen
                  cards because there was nothing else to tell you where you
                  were in the menu. */}
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-fg-soft">
                  {course}
                </h2>
                <span className="text-[11px] tabular-nums text-fg-faint">{dishes.length}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </div>

              <ul
                className="mise-stagger grid gap-2"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(15rem, 100%), 1fr))" }}
              >
                {dishes.map((m) => {
                  const state = STATES.find((s) => s.key === m.availability) ?? STATES[0];
                  const off = m.availability !== "available";
                  return (
                    <li key={m.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditing(m)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            setEditing(m);
                          }
                        }}
                        data-testid="menu-dish"
                        className={`mise-card-inset mise-press flex h-full cursor-pointer flex-col rounded-2xl p-3 ${
                          off ? "opacity-70" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {/* A FACE. The photo if there is one, the dish's own
                              emoji if not, and the first letter as the last
                              resort — anything rather than fourteen cards that
                              differ only in a line of text. */}
                          <span
                            aria-hidden
                            className="mise-well grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl text-lg"
                          >
                            {m.has_photo ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={`${API_BASE}/api/public/order/menu-photo/${m.id}`}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              (m.emoji ?? m.name.slice(0, 1).toUpperCase())
                            )}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-[15px] font-bold leading-tight text-fg">
                              {m.name}
                            </p>
                            {/* THE PRICE, at the size a price deserves. It was
                                11px grey, tucked behind the category, on a page
                                whose entire subject is what things cost. */}
                            <p className="mt-0.5 text-base font-bold tabular-nums text-fg">
                              {format(m.price)}
                            </p>
                          </div>
                        </div>

                        {(m.prep_minutes || m.serve_from || m.serve_to) && (
                          <p className="mt-2 truncate text-[11px] text-fg-faint">
                            {m.prep_minutes ? `${m.prep_minutes} min` : ""}
                            {m.prep_minutes && (m.serve_from || m.serve_to) ? " · " : ""}
                            {m.serve_from || m.serve_to
                              ? `${m.serve_from?.slice(0, 5) ?? "…"}–${m.serve_to?.slice(0, 5) ?? "…"}`
                              : ""}
                          </p>
                        )}

                        {/* THE STATUS, ONLY WHEN IT IS NEWS.
                            Thirteen pills reading "On the menu" told you
                            nothing and buried the two that said otherwise. A
                            dish being available is the default; the exception
                            is the whole message, so only the exception is
                            drawn. */}
                        <div className="mt-auto flex items-center gap-2 pt-2">
                          {off ? (
                            <span
                              className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${state.tone}`}
                            >
                              {state.label}
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              ● On
                            </span>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              disabled={busy === m.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                patch(m, { availability: off ? "available" : "sold_out" });
                              }}
                              title={off ? "Put it back on" : "Mark it sold out"}
                              data-testid="menu-toggle"
                              className="mise-btn-flat mise-press ml-auto min-h-[30px] shrink-0 px-2.5 text-[11px] font-semibold text-fg-soft"
                            >
                              {busy === m.id ? "…" : off ? "Put back" : "Sold out"}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <SheetPopup
          onClose={() => setEditing(null)}
          title={editing.name}
          subtitle={`${editing.category} · ${format(editing.price)}`}
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                On the menu?
              </p>
              {/* One question with four answers, not four switches. */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {STATES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    disabled={!canWrite || busy === editing.id}
                    onClick={() => {
                      patch(editing, { availability: s.key });
                      setEditing({ ...editing, availability: s.key });
                    }}
                    title={s.hint}
                    className={`mise-press min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      editing.availability === s.key ? s.tone : "mise-well text-fg-faint"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Served between
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  defaultValue={editing.serve_from?.slice(0, 5) ?? ""}
                  disabled={!canWrite}
                  onBlur={(e) => patch(editing, { serve_from: e.target.value || null })}
                  data-testid="menu-from"
                  className="mise-well min-h-[42px] rounded-lg px-2 text-sm outline-none"
                />
                <span className="text-fg-faint">to</span>
                <input
                  type="time"
                  defaultValue={editing.serve_to?.slice(0, 5) ?? ""}
                  disabled={!canWrite}
                  onBlur={(e) => patch(editing, { serve_to: e.target.value || null })}
                  className="mise-well min-h-[42px] rounded-lg px-2 text-sm outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-fg-faint">Leave both blank for all day.</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Takes to make
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  inputMode="numeric"
                  defaultValue={editing.prep_minutes ?? ""}
                  disabled={!canWrite}
                  placeholder="—"
                  aria-label={`Minutes to make ${editing.name}`}
                  onBlur={(e) =>
                    patch(editing, {
                      prep_minutes: e.target.value ? parseInt(e.target.value, 10) : null,
                    })
                  }
                  className="mise-well min-h-[42px] w-20 rounded-lg px-2 text-center text-sm outline-none"
                />
                <span className="text-sm text-fg-faint">minutes</span>
              </div>
              <p className="mt-1 text-[11px] text-fg-faint">
                What the diner is quoted, and what the kitchen screen counts down.
              </p>
            </div>

            {canWrite && (
              <div className="border-t border-line pt-3 text-center">
                <button
                  type="button"
                  onClick={() => {
                    remove(editing);
                    setEditing(null);
                  }}
                  data-testid="menu-remove"
                  className="text-[11px] text-fg-faint underline underline-offset-2 hover:text-rose-400"
                >
                  Take {editing.name} off the menu
                </button>
              </div>
            )}
          </div>
        </SheetPopup>
      )}
    </Workbench>
  );
}
