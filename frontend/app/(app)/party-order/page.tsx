"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtQtyNumber } from "@/lib/quantity";
import Link from "next/link";
import {
  api,
  ApiError,
  downloadFile,
  downloadFilePost,
  type PartyQuote,
  type Recipe,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useDeepLink } from "@/components/fx";
import { useConfirm } from "@/components/confirm";
import { CURRENCIES, useCurrency } from "@/lib/currency";

// `own` is the price per plate he typed himself, in BASE currency (the same unit as
// selling_price); null = charge the recipe's price. "default u can show the recipe
// price but it need to be configurable". Base, not display currency, so flipping
// the currency picker mid-build cannot turn ₹1500 into £1500.
type Line = { recipe_id: string; qty: number; own: number | null };

// Money already in the quote's saved currency — show as-is (frozen, no re-convert).
function money(sym: string, v: number) {
  return `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A plate's price rounded to the penny ONCE, half-up — the server's rule
// (Decimal(str(v)).quantize(0.01, ROUND_HALF_UP)), mirrored. The screen, the
// totals, the "own price" mark, the preview PDF and the saved quote all use
// this one figure, so they cannot disagree by a penny. The EPSILON nudge is
// what makes 1.005 round to 1.01 the way Decimal("1.005") does, not to 1.00.
function penny(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export default function PartyOrderPage() {
  const { format, currency } = useCurrency();
  const confirm = useConfirm();

  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [quotes, setQuotes] = useState<PartyQuote[] | null>(null);
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);

  // Deep link: /party-order?quote=<id> opens that quote directly. Gated on the
  // quotes having loaded - firing earlier would set an id that matches nothing
  // and silently open no quote at all.
  useDeepLink(
    {
      quote: () => {
        const id = new URLSearchParams(window.location.search).get("quote");
        if (id && quotes?.some((q) => q.id === id)) setOpenQuoteId(id);
      },
    },
    !!quotes?.length,
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [when, setWhen] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // The raw text of a price box while it is being typed, so "12." survives a
  // re-render; the committed number lives on the line.
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const rate = CURRENCIES[currency].rate;

  useEffect(() => {
    api
      .get<Recipe[]>("/recipes")
      .then((r) => setRecipes(r.filter((x) => x.is_active)))
      .catch(() => setRecipes([]));
    loadQuotes();
  }, []);

  function loadQuotes() {
    api
      .get<PartyQuote[]>("/party-quotes")
      .then(setQuotes)
      .catch(() => setQuotes([]));
  }

  const byId = useMemo(
    () => Object.fromEntries((recipes ?? []).map((r) => [r.id, r] as const)),
    [recipes]
  );

  const qtyById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of lines) m[l.recipe_id] = l.qty;
    return m;
  }, [lines]);

  function addDish(id: string) {
    setLines((prev) => {
      const existing = prev.find((l) => l.recipe_id === id);
      if (existing) return prev.map((l) => (l.recipe_id === id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { recipe_id: id, qty: 1, own: null }];
    });
    setJustAdded(id);
    setTimeout(() => setJustAdded((cur) => (cur === id ? null : cur)), 350);
  }

  function setQty(id: string, qty: number) {
    setLines((prev) => prev.map((l) => (l.recipe_id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  }
  function removeDish(id: string) {
    setLines((prev) => prev.filter((l) => l.recipe_id !== id));
  }
  function setOwn(id: string, own: number | null) {
    setLines((prev) => prev.map((l) => (l.recipe_id === id ? { ...l, own } : l)));
  }
  function dropDraft(id: string) {
    setPriceDraft((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }
  // Typed in the currency on screen, kept in base. An empty box goes back to the
  // recipe price; text that is not a price ("abc", "-3") stays in the box but never
  // reaches the totals, and the box shows the committed price again on blur.
  function typePrice(id: string, text: string) {
    setPriceDraft((d) => ({ ...d, [id]: text }));
    if (text.trim() === "") {
      setOwn(id, null);
      return;
    }
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) setOwn(id, n / rate);
  }
  function endPriceEdit(id: string) {
    dropDraft(id);
  }
  function resetPrice(id: string) {
    setOwn(id, null);
    dropDraft(id);
  }
  function resetBuilder() {
    setLines([]);
    setCustomer("");
    setWhen("");
    setEditingId(null);
    setPriceDraft({});
  }

  const rows = lines.map((l) => {
    const r = byId[l.recipe_id];
    const recipeUnit = r && r.selling_price ? Number(r.selling_price) : null; // base
    const unit = l.own ?? recipeUnit; // what each plate is CHARGED (?? keeps an own price of 0)
    // Per plate, in the currency ON SCREEN, rounded once (see penny()).
    const unitShown = unit != null ? penny(unit * rate) : null;
    const recipeShown = recipeUnit != null ? penny(recipeUnit * rate) : null;
    // An own price is one that differs from the recipe's TO THE PENNY on screen.
    const own = l.own != null && unitShown !== recipeShown;
    const hasPrice = unit != null;
    const cost = r ? Number(r.calculated_cost) * l.qty : 0;
    // Back to base for the totals, from the ROUNDED plate price — so the total
    // here is the total the server will store, not the raw float's.
    const price = unitShown != null ? (unitShown * l.qty) / rate : 0;
    return { l, r, cost, price, profit: price - cost, hasPrice, unit, recipeUnit, unitShown, recipeShown, own };
  });
  const totalCost = rows.reduce((s, x) => s + x.cost, 0);
  const totalPrice = rows.reduce((s, x) => s + x.price, 0);
  const totalProfit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (totalProfit / totalPrice) * 100 : 0;
  const anyUnpriced = rows.some((x) => !x.hasPrice);
  const ownCount = rows.filter((x) => x.own).length;

  const filtered = (recipes ?? []).filter((r) =>
    r.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  // The display symbol, kept latin-1 safe for the PDF (others fall back to the code).
  function payloadCurrency() {
    const c = CURRENCIES[currency];
    return /^[\x00-\xff]+$/.test(c.symbol) ? c.symbol : `${currency} `;
  }
  function buildLines() {
    const c = CURRENCIES[currency];
    // Both prices, always: unit_price is what the customer is CHARGED, recipe_price
    // the recipe's beside it. The server derives "own price" from the pair.
    return rows.map((x) => ({
      recipe_id: x.l.recipe_id,
      name: x.r?.name ?? "Dish",
      qty: x.l.qty,
      // The SAME rounded figures the screen shows (c.rate is the screen's rate).
      unit_price: x.unitShown,
      recipe_price: x.recipeShown,
      unit_cost: Number(x.r?.calculated_cost ?? 0) * c.rate,
    }));
  }

  async function previewPdf() {
    setDownloading(true);
    try {
      await downloadFilePost("/recipes/party-quote.pdf", "party-order-quote.pdf", {
        customer,
        when,
        currency: payloadCurrency(),
        lines: buildLines(),
      });
    } catch {
      setMsg({ tone: "err", text: "Could not build the preview PDF." });
    } finally {
      setDownloading(false);
    }
  }

  async function saveQuote() {
    if (rows.length === 0) return;
    setSaving(true);
    setMsg(null);
    const body = {
      customer,
      event_date: when || null,
      currency: payloadCurrency(),
      lines: buildLines(),
    };
    try {
      if (editingId) {
        await api.patch(`/party-quotes/${editingId}`, body);
        setMsg({ tone: "ok", text: "Quote updated." });
      } else {
        await api.post("/party-quotes", body);
        setMsg({ tone: "ok", text: "Quote confirmed & saved — it'll be here after a refresh." });
      }
      resetBuilder();
      loadQuotes();
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "Could not save the quote." });
    } finally {
      setSaving(false);
    }
  }

  function editQuote(q: PartyQuote) {
    const kept = q.lines.filter((l) => l.recipe_id && byId[l.recipe_id]);
    // A saved own price is a figure in the quote's currency. Read back under a
    // different one it would be divided by the wrong rate — a ₹1500 plate would
    // come back as a £1500 one — so refuse rather than guess.
    if (kept.some((l) => l.own_price) && q.currency !== payloadCurrency()) {
      setMsg({
        tone: "err",
        text: `This quote's prices are in ${q.currency.trim()} — switch the currency to it before editing, so its own prices are not misread.`,
      });
      return;
    }
    setEditingId(q.id);
    setCustomer(q.customer ?? "");
    setWhen(q.event_date ?? "");
    // Reload dishes by recipe; lines without a known recipe are skipped. A line he
    // priced himself keeps that price; the rest re-price live from the recipe.
    setLines(
      kept.map((l) => ({
        recipe_id: l.recipe_id as string,
        qty: l.qty,
        own: l.own_price && l.unit_price != null ? l.unit_price / rate : null,
      }))
    );
    setPriceDraft({});
    setMsg({ tone: "ok", text: "Editing this quote — change it and press Update." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeQuote(q: PartyQuote) {
    const ok = await confirm({
      title: "Remove this quote?",
      message: `This permanently deletes the quote${q.customer ? ` for ${q.customer}` : ""}. This can't be undone.`,
      tone: "danger",
      confirmText: "Remove",
    });
    if (!ok) return;
    try {
      await api.delete(`/party-quotes/${q.id}`);
      loadQuotes();
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "Could not remove the quote." });
    }
  }

  if (!recipes) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Party Order"
        subtitle="Build a bulk/party order, see cost, price & profit instantly — then confirm to save it."
      />

      {msg && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            msg.tone === "ok"
              ? "bg-brand-400/10 text-brand-300"
              : "bg-amber-400/10 text-amber-300"
          }`}
        >
          {msg.text}
        </p>
      )}

      {recipes.length > 0 && (
        <div className="mise-well mt-4 flex items-center gap-1 overflow-x-auto rounded-2xl p-2 text-xs sm:gap-2 sm:p-2.5">
          {(
            [
              ["1", "Pick dishes", rows.length > 0],
              ["2", "Price & margin", rows.length > 0 && totalPrice > 0],
              ["3", editingId ? "Update quote" : "Save / PDF", false],
            ] as [string, string, boolean][]
          ).map(([n, label, done], i, arr) => {
            const activeStep = rows.length === 0 ? 0 : totalPrice > 0 ? 2 : 1;
            const isActive = i === activeStep;
            return (
              <div key={n} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
                <div
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 transition-all duration-300 ${
                    isActive ? "mise-raised text-fg" : done ? "text-brand-300" : "text-fg-faint"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                      done ? "bg-brand-500/20 text-brand-300" : isActive ? "bg-brand-600 text-white" : "bg-glass/10"
                    }`}
                  >
                    {done ? "✓" : n}
                  </span>
                  <span className="truncate font-medium">{label}</span>
                </div>
                {i < arr.length - 1 && <span aria-hidden className="shrink-0 text-fg-faint">›</span>}
              </div>
            );
          })}
        </div>
      )}

      {recipes.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-fg-soft">
            You don&apos;t have any recipes yet. Add some on the{" "}
            <Link href="/recipes" className="text-brand-400 underline">Recipes</Link>{" "}page and they&apos;ll
            appear here, costed to the gram.
          </p>
        </Card>
      ) : (
        <>
          {/* Pick & select dishes */}
          <Card className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-fg">
                {editingId ? "Editing quote — pick dishes" : "Pick dishes"}
              </h3>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes…"
                className="w-48 rounded-lg border border-line-2 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand-500"
              />
            </div>
            <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((r) => {
                const inOrder = qtyById[r.id] ?? 0;
                return (
                  <button
                    key={r.id}
                    onClick={() => addDish(r.id)}
                    className={`group relative rounded-xl border p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                      inOrder
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-line-2 hover:border-brand-400"
                    } ${justAdded === r.id ? "ring-2 ring-brand-400" : ""}`}
                  >
                    {inOrder > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">
                        {inOrder}
                      </span>
                    )}
                    <span className="block truncate text-sm font-medium text-fg">{r.name}</span>
                    <span className="mt-0.5 block text-xs text-fg-faint">
                      {r.selling_price ? `${format(r.selling_price)}/plate` : "no price set"}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-fg-faint">
                  No dishes match &ldquo;{search}&rdquo;.
                </p>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-fg-soft">Customer / party (optional)</label>
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="e.g. Sharma wedding"
                  className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-soft">Event date (optional)</label>
                <input
                  type="date"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-fg-faint">
                  After this date the quote locks (prices freeze, view-only).
                </p>
              </div>
            </div>
          </Card>

          {/* The order */}
          <Card className="mt-4 p-0">
            <div className="overflow-x-auto">
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                    <th className="px-5 py-3">Dish</th>
                    <th className="px-5 py-3 text-right">Qty</th>
                    <th className="px-5 py-3 text-right">Per plate</th>
                    <th className="px-5 py-3 text-right">Line price</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                    <th className="px-5 py-3 text-right">Profit</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-fg-faint">
                        Tap dishes above to build the order.
                      </td>
                    </tr>
                  ) : (
                    rows.map((x) => (
                      <tr key={x.l.recipe_id} className="border-b border-line">
                        <td className="px-5 py-3 font-medium text-fg">
                          {x.r?.name ?? "—"}
                          {!x.hasPrice && <Badge tone="amber">no price</Badge>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <input
                            value={x.l.qty}
                            onChange={(e) => setQty(x.l.recipe_id, parseInt(e.target.value, 10) || 1)}
                            inputMode="numeric"
                            className="w-16 rounded-md border border-line-2 bg-transparent px-2 py-1 text-right text-sm"
                          />
                        </td>
                        {/* The recipe's price by default, his own whenever he types one —
                            "so both price flexibility i need". An own price is marked,
                            with the recipe's beside it and one tap back to it. */}
                        <td data-label="Per plate" className="px-5 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <input
                              value={priceDraft[x.l.recipe_id] ?? (x.unitShown != null ? x.unitShown.toFixed(2) : "")}
                              onChange={(e) => typePrice(x.l.recipe_id, e.target.value)}
                              onBlur={() => endPriceEdit(x.l.recipe_id)}
                              inputMode="decimal"
                              placeholder="set price"
                              aria-label={`Price per plate for ${x.r?.name ?? "dish"}`}
                              className={`w-24 rounded-md border bg-transparent px-2 py-1 text-right text-sm ${x.own ? "border-brand-500" : "border-line-2"}`}
                            />
                            {x.own && (
                              <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
                                <span className="mise-chip" data-tone="sky">own price</span>
                                <span className="text-fg-faint">
                                  recipe {x.recipeUnit != null ? format(x.recipeUnit) : "has no price"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => resetPrice(x.l.recipe_id)}
                                  className="mise-press rounded px-1.5 text-brand-400 hover:underline"
                                >
                                  {x.recipeUnit != null ? "use recipe price" : "clear"}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td data-label="Line price" className="px-5 py-3 text-right text-fg-soft">{x.hasPrice ? format(x.price) : "—"}</td>
                        <td data-label="Cost" className="px-5 py-3 text-right text-fg-soft">{format(x.cost)}</td>
                        <td className={`px-5 py-3 text-right ${x.profit >= 0 ? "text-fg" : "text-rose-400"}`}>
                          {x.hasPrice ? format(x.profit) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => removeDish(x.l.recipe_id)}
                            className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-paper-2"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Totals + actions */}
          {rows.length > 0 && (
            <Card className="mt-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Total price</p>
                  <p className="mt-1 text-xl font-bold text-fg">{format(totalPrice)}</p>
                  {ownCount > 0 && (
                    <p className="mt-0.5 text-[11px] text-fg-faint">
                      {ownCount} own price{ownCount === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Total cost</p>
                  <p className="mt-1 text-xl font-semibold text-fg-soft">{format(totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Profit</p>
                  <p className={`mt-1 text-xl font-bold ${totalProfit >= 0 ? "mise-tone-good" : "mise-tone-bad"}`}>
                    {format(totalProfit)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Margin</p>
                  <p className="mt-1 text-xl font-semibold text-fg">{totalPrice > 0 ? `${margin.toFixed(1)}%` : "—"}</p>
                </div>
              </div>
              {anyUnpriced && (
                <p className="mt-3 text-xs text-amber-300">
                  Some dishes have no price yet, so the total price/profit excludes them. Type a price per
                  plate on the line, or set one on{" "}
                  <Link href="/recipes" className="underline">Recipes</Link>.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={previewPdf}
                  disabled={downloading}
                  className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft disabled:opacity-60"
                >
                  {downloading ? "Preparing…" : "⬇ Preview PDF"}
                </button>
                <button
                  onClick={saveQuote}
                  disabled={saving}
                  className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : editingId ? "Update quote" : "✓ Confirm & save quote"}
                </button>
                {editingId && (
                  <button
                    onClick={resetBuilder}
                    className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft"
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </Card>
          )}

          {/* History */}
          <div className="mt-8">
            <h3 className="font-semibold text-fg">Saved quotes</h3>
            {quotes === null ? (
              <div className="mt-3"><Spinner /></div>
            ) : quotes.length === 0 ? (
              <Card className="mt-3">
                <p className="py-4 text-center text-sm text-fg-faint">
                  No saved quotes yet. Build an order above and press “Confirm & save quote”.
                </p>
              </Card>
            ) : (
              <div className="mt-3 grid gap-3">
                {quotes.map((q) => {
                  const dishes = q.lines.length;
                  const plates = q.lines.reduce((s, l) => s + l.qty, 0);
                  const owned = q.lines.filter((l) => l.own_price).length;
                  return (
                    <Card key={q.id} className="mise-card-slide mise-feel">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-fg">{q.customer || "Walk-in quote"}</span>
                            {q.is_expired ? (
                              <Badge tone="red">🔒 expired</Badge>
                            ) : (
                              <Badge tone="green">active</Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-fg-faint">
                            {q.event_date ? `Event ${q.event_date} · ` : ""}
                            {dishes} dish{dishes === 1 ? "" : "es"} · {plates} plates ·{" "}
                            {owned > 0 ? `${owned} own price${owned === 1 ? "" : "s"} · ` : ""}
                            {q.is_expired
                              ? "prices frozen"
                              : q.valid_until
                                ? `editable until ${q.valid_until}`
                                : "editable"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-fg">{money(q.currency, q.total_price)}</p>
                          <p className="text-xs text-fg-faint">
                            profit {money(q.currency, q.profit)} · {q.margin.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                      {/* the quote's money at a glance: cost vs profit share of the price */}
                      {q.total_price > 0 && (
                        <div className="mise-well mt-3 flex h-2.5 overflow-hidden rounded-full" title={`cost ${money(q.currency, q.total_price - q.profit)} · profit ${money(q.currency, q.profit)}`}>
                          <span className="h-full bg-rose-400/70" style={{ width: `${Math.max(0, Math.min(100, ((q.total_price - q.profit) / q.total_price) * 100))}%` }} />
                          <span className="h-full bg-brand-500/80" style={{ width: `${Math.max(0, Math.min(100, (q.profit / q.total_price) * 100))}%` }} />
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => setOpenQuoteId((id) => (id === q.id ? null : q.id))}
                          aria-expanded={openQuoteId === q.id}
                          className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft"
                        >
                          {openQuoteId === q.id ? "▾ Hide details" : `▸ View details (${dishes})`}
                        </button>
                        <button
                          onClick={() => downloadFile(`/party-quotes/${q.id}.pdf`, `party-quote-${q.id.slice(0, 8)}.pdf`)}
                          className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft"
                        >
                          ⬇ Download PDF
                        </button>
                        {!q.is_expired && (
                          <>
                            <button
                              onClick={() => editQuote(q)}
                              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft"
                            >
                              ✎ Edit
                            </button>
                            <button
                              onClick={() => removeQuote(q)}
                              className="mise-press rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/10"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                      {openQuoteId === q.id && (
                        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-line text-left text-fg-faint">
                                <th className="px-3 py-2">Dish</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-right">Unit price</th>
                                <th className="px-3 py-2 text-right">Line price</th>
                                <th className="px-3 py-2 text-right">Line cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {q.lines.map((l, li) => (
                                <tr key={li} className="border-b border-line/60 last:border-0">
                                  <td className="px-3 py-2 font-medium text-fg">{l.name}</td>
                                  <td className="px-3 py-2 text-right text-fg-soft">{fmtQtyNumber(l.qty)}</td>
                                  <td className="px-3 py-2 text-right text-fg-soft">
                                    {l.unit_price != null ? money(q.currency, l.unit_price) : "—"}
                                    {/* Beside the FROZEN recipe price — the honest comparison
                                        for a quote that may already be locked. */}
                                    {l.own_price && (
                                      <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                                        <span className="mise-chip" data-tone="sky">own</span>
                                        <span className="text-fg-faint">
                                          recipe {l.recipe_price != null ? money(q.currency, l.recipe_price) : "—"}
                                        </span>
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right text-fg-soft">
                                    {l.unit_price != null ? money(q.currency, l.unit_price * l.qty) : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-right text-fg-soft">
                                    {money(q.currency, l.unit_cost * l.qty)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
