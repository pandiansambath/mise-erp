"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useConfirm } from "@/components/confirm";
import { CURRENCIES, useCurrency } from "@/lib/currency";

type Line = { recipe_id: string; qty: number };

// Money already in the quote's saved currency — show as-is (frozen, no re-convert).
function money(sym: string, v: number) {
  return `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PartyOrderPage() {
  const { format, currency } = useCurrency();
  const confirm = useConfirm();

  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [quotes, setQuotes] = useState<PartyQuote[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [when, setWhen] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

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
      return [...prev, { recipe_id: id, qty: 1 }];
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
  function resetBuilder() {
    setLines([]);
    setCustomer("");
    setWhen("");
    setEditingId(null);
  }

  const rows = lines.map((l) => {
    const r = byId[l.recipe_id];
    const cost = r ? Number(r.calculated_cost) * l.qty : 0;
    const hasPrice = !!(r && r.selling_price);
    const price = hasPrice ? Number(r!.selling_price) * l.qty : 0;
    return { l, r, cost, price, profit: price - cost, hasPrice };
  });
  const totalCost = rows.reduce((s, x) => s + x.cost, 0);
  const totalPrice = rows.reduce((s, x) => s + x.price, 0);
  const totalProfit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (totalProfit / totalPrice) * 100 : 0;
  const anyUnpriced = rows.some((x) => !x.hasPrice);

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
    return rows.map((x) => ({
      recipe_id: x.l.recipe_id,
      name: x.r?.name ?? "Dish",
      qty: x.l.qty,
      unit_price: x.hasPrice && x.r?.selling_price != null ? Number(x.r.selling_price) * c.rate : null,
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
    setEditingId(q.id);
    setCustomer(q.customer ?? "");
    setWhen(q.event_date ?? "");
    // Reload dishes by recipe (re-priced live); lines without a known recipe are skipped.
    setLines(
      q.lines
        .filter((l) => l.recipe_id && byId[l.recipe_id])
        .map((l) => ({ recipe_id: l.recipe_id as string, qty: l.qty }))
    );
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

      {recipes.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-fg-soft">
            You don&apos;t have any recipes yet. Add some on the{" "}
            <Link href="/recipes" className="text-brand-400 underline">Recipes</Link> page and they&apos;ll
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                    <th className="px-5 py-3">Dish</th>
                    <th className="px-5 py-3 text-right">Qty</th>
                    <th className="px-5 py-3 text-right">Price</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                    <th className="px-5 py-3 text-right">Profit</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-fg-faint">
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
                        <td className="px-5 py-3 text-right text-fg-soft">{x.hasPrice ? format(x.price) : "—"}</td>
                        <td className="px-5 py-3 text-right text-fg-soft">{format(x.cost)}</td>
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
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Total cost</p>
                  <p className="mt-1 text-xl font-semibold text-fg-soft">{format(totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Profit</p>
                  <p className={`mt-1 text-xl font-bold ${totalProfit >= 0 ? "text-brand-400" : "text-rose-400"}`}>
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
                  Some dishes have no selling price set, so the total price/profit excludes them. Set prices on{" "}
                  <Link href="/recipes" className="underline">Recipes</Link> for a complete quote.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={previewPdf}
                  disabled={downloading}
                  className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2 disabled:opacity-60"
                >
                  {downloading ? "Preparing…" : "⬇ Preview PDF"}
                </button>
                <button
                  onClick={saveQuote}
                  disabled={saving}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : editingId ? "Update quote" : "✓ Confirm & save quote"}
                </button>
                {editingId && (
                  <button
                    onClick={resetBuilder}
                    className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
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
                  return (
                    <Card key={q.id} className="mise-card-slide">
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => downloadFile(`/party-quotes/${q.id}.pdf`, `party-quote-${q.id.slice(0, 8)}.pdf`)}
                          className="rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-fg-soft hover:bg-paper-2"
                        >
                          ⬇ Download PDF
                        </button>
                        {!q.is_expired && (
                          <>
                            <button
                              onClick={() => editQuote(q)}
                              className="rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-fg-soft hover:bg-paper-2"
                            >
                              ✎ Edit
                            </button>
                            <button
                              onClick={() => removeQuote(q)}
                              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/10"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
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
