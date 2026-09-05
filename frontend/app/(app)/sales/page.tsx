"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, downloadFile, postForm, type CashEvent, type DaySummary, type ExpenseCategory, type PettyCashRow, type SalesChannel } from "@/lib/api";
import { PettyCash } from "@/components/PettyCash";
import { SubNav } from "@/components/SubNav";
import { recall, remember } from "@/lib/rangeMemory";
import { Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { CalendarHeat, Donut, Waffle, type DonutSegment, Sparkline } from "@/components/charts";
import { useConfirm } from "@/components/confirm";
import { ListManager } from "@/components/ListManager";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { localISODate } from "@/lib/date";
import { numeric } from "@/lib/sanitize";
import { spotlight, useDeepLink } from "@/components/fx";
import ChefMascot from "@/components/auth/ChefMascot";

const METHODS = ["CARD", "CASH", "ONLINE", "BANK"];
const today = () => localISODate();

export default function SalesPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "sales:write");
  const isSuper = user?.role === "SUPER_ADMIN";

  const reloadChannels = async () => {
    setChannels(await api.get<SalesChannel[]>("/sales/channels"));
  };

  // Sales defaults to TODAY, not a range: a till is counted daily, and
  // yesterday's takings are not what you open this page for. Still remembered
  // within a session so stepping back a day survives a trip to another page.
  const rememberedDay = typeof window === "undefined" ? null : recall("sales");
  const [day, setDay] = useState(rememberedDay?.from ?? today());
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [pettyRows, setPettyRows] = useState<PettyCashRow[]>([]);
  const [expenseCats, setExpenseCats] = useState<ExpenseCategory[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CashEvent[] | null>(null);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // add-line form
  // (The single-channel `channelId`/`gross` pair went with the old one-line
  //  form. The sheet keeps one draft per channel in `draft` instead.)
  // 🧮 big-key till pad — which field it types into
  const [pad, setPad] = useState<null | "gross" | "counted">(null);
  /** The takings popup — one channel, one amount. */
  /** channel id -> what he has typed for it today. One object rather than one
   *  state per channel: the sheet is filled in as a whole and saved as a whole. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingDraft, setSavingDraft] = useState(false);
  // per-channel gross over the trailing 7 days (for the channel tiles)
  const [chanTrend, setChanTrend] = useState<Record<string, number[]> | null>(null);
  const [trendLabels, setTrendLabels] = useState<string[]>([]);
  const [method, setMethod] = useState("CARD");

  // cash form
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [carried, setCarried] = useState(false); // opening auto-filled from yesterday's close

  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [heatDays, setHeatDays] = useState<{ date: string; value: number }[]>([]);

  // ⌘K "Record today's takings" (?new=1) → spotlight the entry form
  useDeepLink({ new: () => spotlight("sales-form") }, !loading);

  // Last ~10 weeks of takings for the rhythm heatmap — one query.
  useEffect(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 69);
    const iso = (d: Date) => localISODate(d);
    api
      .get<{ days: { date: string; net: string }[] }>(
        `/reports/sales-trend?date_from=${iso(from)}&date_to=${iso(to)}`,
      )
      .then((r) => setHeatDays(r.days.map((d) => ({ date: d.date, value: parseFloat(d.net) || 0 }))))
      .catch(() => {});
  }, []);

  const loadDay = async (d: string) => {
    // The carry-forward used to need a SECOND request for yesterday, on every
    // day change. The server now returns it as `suggested_opening`, so this is
    // one round trip and the rule lives in one place instead of two.
    const [s, petty] = await Promise.all([
      api.get<DaySummary>(`/sales/days/${d}`),
      api.get<PettyCashRow[]>(`/sales/days/${d}/petty`).catch(() => [] as PettyCashRow[]),
    ]);
    setSummary(s);
    setPettyRows(petty);
    setCounted(s.cash_counted ?? "");
    if (s.opening_cash && s.opening_cash !== "0" && s.opening_cash !== "0.00") {
      setOpening(s.opening_cash);
      setCarried(false);
    } else {
      setOpening(s.suggested_opening ?? "");
      setCarried(Boolean(s.suggested_opening));
    }
  };

  useEffect(() => {
    Promise.all([
      // No "first channel" to preselect any more — the sheet shows every
      // channel at once, so there is nothing to choose before typing.
      api.get<SalesChannel[]>("/sales/channels").then(setChannels),
      api.get<ExpenseCategory[]>("/expenses/categories").then(setExpenseCats).catch(() => {}),
      loadDay(day),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeDay(d: string) {
    remember("sales", { from: d, to: d });
    setDay(d);
    setLoading(true);
    await loadDay(d).finally(() => setLoading(false));
  }

  // Channel tiles' sparklines: the trailing week, loaded quietly after paint.
  useEffect(() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(localISODate(d));
    }
    setTrendLabels(days.map((d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" })));
    Promise.all(days.map((d) => api.get<DaySummary>(`/sales/days/${d}`).catch(() => null))).then((list) => {
      const map: Record<string, number[]> = {};
      list.forEach((sm, i) => {
        sm?.lines.forEach((l) => {
          (map[l.channel_name] ??= Array(7).fill(0))[i] += parseFloat(l.gross_amount) || 0;
        });
      });
      setChanTrend(map);
    });
  }, []);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await postForm<{ added: number; skipped: string[] }>(
        `/sales/days/${day}/import`,
        form,
      );
      await loadDay(day);
      setNotice(
        `Imported ${res.added} line${res.added === 1 ? "" : "s"}` +
          (res.skipped.length
            ? `, ${res.skipped.length} skipped (${res.skipped.slice(0, 3).join(", ")}${res.skipped.length > 3 ? "…" : ""})`
            : "") +
          ".",
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const d = err.detail as { errors?: string[] } | undefined;
        setError("Couldn't import — " + (d?.errors ?? ["the file didn't match the template."]).join("  •  "));
      } else {
        setError(err instanceof ApiError ? err.message : "Import failed");
      }
    } finally {
      e.target.value = "";
    }
  }


  /** Save every box that has a number in it.
   *
   * Sequential rather than parallel, deliberately: each call returns the whole
   * day's summary, and firing them together means the last response wins and
   * the others' lines vanish from the screen until a reload. A day's takings is
   * five requests at most.
   */
  async function saveDraft() {
    setError(null);
    setSavingDraft(true);
    try {
      let latest: DaySummary | null = null;
      for (const [channel_id, value] of Object.entries(draft)) {
        const amount = parseFloat(value);
        if (!(amount > 0)) continue;
        latest = await api.post<DaySummary>(`/sales/days/${day}/lines`, {
          channel_id,
          gross_amount: value,
          payment_method: method,
        });
      }
      if (latest) setSummary(latest);
      setDraft({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the takings");
    } finally {
      setSavingDraft(false);
    }
  }

  async function removeLine(id: string) {
    const ok = await confirm({
      title: "Remove this sales line?",
      message: "It will be deleted from today's takings.",
      confirmText: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      const s = await api.delete<DaySummary>(`/sales/days/${day}/lines/${id}`);
      setSummary(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove line");
    }
  }

  async function saveCash() {
    setError(null);
    try {
      await api.patch(`/sales/days/${day}`, {
        opening_cash: opening || "0",
        cash_counted: counted === "" ? null : counted,
      });
      await loadDay(day);
      // This save just wrote a history line. Drop the cached copy so the panel
      // shows it rather than the list from before the change.
      if (historyOpen) {
        try {
          setHistory(await api.get<CashEvent[]>(`/sales/days/${day}/cash-history`));
        } catch {
          /* the figures saved; a stale panel is not worth an error */
        }
      } else {
        setHistory(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save cash");
    }
  }

  if (loading || !summary) return <Spinner />;

  const variance = summary.cash_variance;
  const varianceNum = variance != null ? parseFloat(variance) : null;

  // "previous closing is today's opening, but this is not happening
  //  automatically... I need to click this grey dead save button, then only I
  //  can see the total cash amount."
  //
  // The carry-forward was already there — the server offers yesterday's close
  // as `suggested_opening` and it goes straight into the field. What did NOT
  // move was every total below it, because those came from the SAVED record,
  // where the opening is still zero. So the page showed a float in the box and
  // £0.00 expected at the same time, and the only way to reconcile them was to
  // press the one button that looked disabled.
  //
  // The server's number is adjusted by the difference rather than recomputed
  // here: `expected` also subtracts unbooked petty cash, which this panel never
  // shows, and a second copy of a money formula is a second thing to get wrong.
  const savedOpening = parseFloat(summary.opening_cash ?? "0") || 0;
  const typedOpening = parseFloat(opening || "0") || 0;
  const expectedNow = String(
    (parseFloat(summary.expected_cash ?? "0") || 0) + (typedOpening - savedOpening),
  );
  const dirtyCash = typedOpening !== savedOpening || (counted ?? "") !== (summary.cash_counted ?? "");

  // Today's takings by channel — the composition donut.
  const channelSegs: DonutSegment[] = (() => {
    const byChannel = new Map<string, number>();
    for (const l of summary.lines) {
      byChannel.set(l.channel_name, (byChannel.get(l.channel_name) ?? 0) + (parseFloat(l.gross_amount) || 0));
    }
    return [...byChannel.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
  })();

  // How today's money arrived — cash vs card vs apps, as a 100-square waffle.
  const METHOD_COLORS: Record<string, string> = {
    CASH: "#10b981", CARD: "#38bdf8", ONLINE: "#a78bfa", UPI: "#f59e0b", OTHER: "#94a3b8",
  };
  const methodSegs = (() => {
    const byMethod = new Map<string, number>();
    for (const l of summary.lines) {
      const key = (l.payment_method || "OTHER").toUpperCase();
      byMethod.set(key, (byMethod.get(key) ?? 0) + (parseFloat(l.gross_amount) || 0));
    }
    return [...byMethod.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: METHOD_COLORS[label] ?? "#94a3b8" }));
  })();

  return (
    <div>
      <PageHeader
        title="Sales & Cash"
        subtitle="One day at a time — takings by channel, commissions and the till for the date you pick."
      />

      {/* Just the number, pinned. The whole header was sticky before, which
          pinned a title and a subtitle nobody needs to keep reading and left a
          tall translucent band sitting over the page. */}
      <div
        // Full-bleed and OPAQUE. Inset with rounded corners and a translucent
        // background, the page scrolled through the strip above it and through
        // the bar itself — the "gap" that looked broken. A pinned toolbar has
        // to be a solid lid: it spans the content width exactly (matching
        // AppShell's px-4 lg:px-8) and nothing passes behind it.
        className="mise-cash-lid sticky top-0 z-30 -mx-4 mb-5 flex items-center justify-end gap-3 border-b border-line bg-paper px-4 py-2.5 lg:-mx-8 lg:px-8"
      >
        <span className="mr-auto text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          <span aria-hidden className="mr-1">🪙</span> In the cash box
        </span>
        <button
          type="button"
          onClick={() => spotlight("cash-drawer")}
          title="Open the cash drawer"
          className="mise-press flex items-baseline gap-2 rounded-xl px-2 py-1 text-right transition hover:bg-glass/5"
        >
          <span className="font-display text-xl font-semibold tabular-nums text-fg">
            {format(expectedNow)}
          </span>
          <span className="text-[10px] text-fg-faint">
            {summary.cash_counted
              ? varianceNum === 0
                ? "counted \u00b7 balanced \u2713"
                : `${(varianceNum ?? 0) > 0 ? "over" : "short"} ${format(String(Math.abs(varianceNum ?? 0).toFixed(2)))}`
              : "expected"}
          </span>
        </button>
      </div>

      {/* The three jobs of this page. Closing the till and settling petty cash
          were both below the fold, and they are the ones with a deadline. */}
      <SubNav
        items={[
          { key: "today", label: "Today", icon: "📅", onSelect: () => changeDay(localISODate()) },
          {
            key: "till",
            label: summary?.cash_counted ? "Till closed" : "Close the till",
            icon: "💷",
            tone: summary?.cash_counted ? "plain" : "warn",
            onSelect: () => spotlight("cash-drawer"),
          },
          {
            key: "petty",
            label: "Petty cash",
            icon: "🧾",
            // Money in someone's hand, not in the drawer. If this is not zero
            // the till cannot balance, so it belongs at the top.
            count: pettyRows.filter((r) => r.status === "OPEN").length,
            tone: "warn",
            onSelect: () => spotlight("cash-drawer"),
          },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-fg-soft">Date</label>
        <input
          type="date"
          value={day}
          // Takings cannot be recorded for a day that has not happened.
          max={localISODate()}
          onChange={(e) => changeDay(e.target.value)}
          className="mise-well rounded-lg px-3 py-2 text-sm outline-none"
        />
        {(() => {
          // vs the same weekday last week — instant context for the day you're on
          const get = (d: string) => heatDays.find((x) => x.date === d)?.value;
          const cur = get(day);
          const prev = new Date(day + "T00:00:00");
          prev.setDate(prev.getDate() - 7);
          const prevVal = get(localISODate(prev));
          if (cur == null || prevVal == null || prevVal <= 0) return null;
          const pct = ((cur - prevVal) / prevVal) * 100;
          const up = pct >= 0;
          return (
            <span
              className={`mise-well rounded-full px-2.5 py-1 text-xs font-medium ${up ? "text-brand-400" : "text-rose-400"}`}
              title={`vs the same weekday last week (${format(String(prevVal))})`}
            >
              {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs last week
            </span>
          );
        })()}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={onImportFile} />
              <button
                onClick={() => fileRef.current?.click()}
                className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
                title="Upload a day's sales (Excel/CSV) — checked strictly with exact errors"
              >
                ⬆ Import
              </button>
              <button
                onClick={() => downloadFile("/sales/sales-template.xlsx", "mise-sales-template.xlsx")}
                className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
              >
                ⬇ Template (Excel)
              </button>
              <button
                onClick={() => downloadFile("/sales/sales-template.csv", "mise-sales-template.csv")}
                className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
              >
                CSV
              </button>
            </>
          )}
          <button
            onClick={() => downloadFile(`/sales/days/${day}/sheet.pdf`, `sales-${day}.pdf`)}
            className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
          >
            ⬇ PDF
          </button>
        </div>
      </div>
      {notice && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{notice}</p>}
      {error && <p className="mb-4 rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <div className="mise-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Gross sales" value={format(summary.totals.gross)} />
        <StatCard label="Commission" value={format(summary.totals.commission)} accent="rose" />
        <StatCard label="Net received" value={format(summary.totals.net)} accent="brand" />
        <StatCard
          label="Cash variance"
          value={varianceNum == null ? "—" : format(variance)}
          accent={varianceNum == null ? "slate" : varianceNum === 0 ? "brand" : "amber"}
          hint={varianceNum == null ? "Count cash to check" : varianceNum === 0 ? "Balanced" : "Off"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Add + lines */}
        <div className="min-w-0 lg:col-span-2">
          {/* THE DAY SHEET.
              Rebuilt from the job rather than from another page's idiom.

              "I need to click each to enter which is hard job... same I need to
               scroll down to reach the entry area... what the hell tight UI is
               this."

              All three were mine. I had put channel TILES here, borrowed from
              the order pad — and the order pad's job is "pick a few things out
              of many", where a tile is exactly right. Sales is the opposite
              job: at close you already know five numbers and want to type them.
              Tiles turned that into five popups, and the popup was so cramped
              that the keypad scrolled inside it.

              So: every channel is a ROW with a box, all on screen at once, no
              popup and nothing to open. Type down the column the way you read a
              till report, then save once. The commission and what it nets are
              worked out live beside each figure, because the number you type is
              gross and the number that matters is what lands. */}
          {canWrite && (
            <div className="mb-4" id="sales-form">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-fg-soft">Today&apos;s takings</p>
                <p className="text-[11px] text-fg-faint">
                  type the gross — commission comes off automatically
                </p>
              </div>

              <div className="mise-card-inset divide-y divide-line/60 p-0">
                {channels
                  .filter((c) => c.is_active)
                  .map((c) => {
                    const typed = parseFloat(draft[c.id] ?? "");
                    const pct = parseFloat(c.commission_pct) || 0;
                    const net = Number.isFinite(typed) ? typed * (1 - pct / 100) : 0;
                    const already = summary.lines
                      .filter((l) => l.channel_name === c.name)
                      .reduce((t, l) => t + (parseFloat(l.net_amount) || 0), 0);
                    return (
                      <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-fg">
                            {c.name}
                          </span>
                          <span className="block text-[11px] text-fg-faint">
                            {pct > 0 ? `${pct}% commission` : "no commission"}
                            {already > 0 ? ` · ${format(String(already.toFixed(2)))} in already` : ""}
                          </span>
                        </span>

                        {/* What it will actually net, live. A figure you can see
                            before you commit is worth more than one you check
                            afterwards. */}
                        {Number.isFinite(typed) && typed > 0 && (
                          <span className="hidden shrink-0 text-right sm:block">
                            <span className="block font-display text-sm font-semibold tabular-nums text-brand-300">
                              {format(String(net.toFixed(2)))}
                            </span>
                            <span className="block text-[10px] text-fg-faint">nets</span>
                          </span>
                        )}

                        <input
                          value={draft[c.id] ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [c.id]: numeric(e.target.value) }))
                          }
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label={`Gross takings for ${c.name}`}
                          className="mise-well w-24 shrink-0 rounded-lg px-2.5 py-2 text-right text-sm tabular-nums outline-none sm:w-28"
                        />
                      </div>
                    );
                  })}
              </div>

              {/* THE ACTION BAR STICKS.
                  Measured, not guessed: with eight channels the save button sat
                  at 1035px on an 800px screen — the exact fault he reported on
                  Expenses, which I had just fixed there and then recreated
                  here. A sheet whose whole point is "fill several boxes" cannot
                  put the button that commits them past the bottom of the
                  screen.

                  Sticky rather than moved to the top: the natural order is
                  still type-then-save, and this keeps that while guaranteeing
                  the button is always in reach. */}
              <div className="sticky bottom-2 z-10 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper/95 p-2 backdrop-blur">
                <div className="mise-well flex gap-1 rounded-xl p-1">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`mise-press rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        method === m ? "bg-brand-600 text-white" : "text-fg-soft hover:text-fg"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {(() => {
                  const total = Object.entries(draft).reduce((t, [id, v]) => {
                    const n = parseFloat(v);
                    if (!(n > 0)) return t;
                    const pct = parseFloat(
                      channels.find((c) => c.id === id)?.commission_pct ?? "0",
                    ) || 0;
                    return t + n * (1 - pct / 100);
                  }, 0);
                  if (total <= 0) return null;
                  return (
                    <span className="text-xs text-fg-faint">
                      nets{" "}
                      <b className="font-display text-sm text-brand-300">
                        {format(String(total.toFixed(2)))}
                      </b>
                    </span>
                  );
                })()}
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={savingDraft || !Object.values(draft).some((v) => parseFloat(v) > 0)}
                  data-tone="brand"
                  className="mise-btn-flat mise-press ml-auto px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
                >
                  {savingDraft
                    ? "Saving…"
                    : (() => {
                        const n = Object.values(draft).filter((v) => parseFloat(v) > 0).length;
                        return n > 1 ? `Save ${n} takings` : "Save takings";
                      })()}
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
            </div>
          )}

          {/* THE DAY'S TAKINGS, AS CARDS — his reference pages have no tables.
              Four money columns squeezed onto a phone is what "overflow" meant
              here: gross, commission and net all fought for the same row. On a
              card the channel leads, the NET is the big number because that is
              what actually arrives, and the two that explain it sit under it in
              words rather than in unlabelled columns. */}
          <Card className="p-0">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold text-fg">Today&apos;s lines</h2>
            </div>
            {summary.lines.length === 0 ? (
              <p className="px-5 py-8 text-center text-fg-faint">
                No sales entered for this day yet.
              </p>
            ) : (
              <div className="mise-stagger space-y-2 p-3">
                {summary.lines.map((l) => (
                  <div
                    key={l.id}
                    className="mise-card-inset relative flex items-center gap-3 overflow-hidden px-4 py-3 pl-5"
                  >
                    <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand-400/70" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-display font-semibold text-fg">
                        {l.channel_name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-fg-faint">
                        {l.payment_method}
                        {" · "}
                        {format(l.gross_amount)} gross
                        {parseFloat(l.commission) > 0
                          ? ` · ${format(l.commission)} commission`
                          : ""}
                      </span>
                    </div>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono font-semibold tabular-nums text-fg">
                        {format(l.net_amount)}
                      </span>
                      <span className="block text-[10px] text-fg-faint">net</span>
                    </span>
                    {canWrite && (
                      <button
                        onClick={() => removeLine(l.id)}
                        className="mise-press shrink-0 rounded-md border border-line px-2 py-1 text-xs text-fg-faint transition hover:border-rose-400/50 hover:text-rose-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Cash reconciliation */}
        <Card id="cash-drawer" className="scroll-mt-24">
          <h3 className="font-semibold text-fg">Cash drawer</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <label className="block text-fg-faint">Opening cash</label>
              <input
                value={opening}
                onChange={(e) => { setOpening(numeric(e.target.value)); setCarried(false); }}
                inputMode="decimal"
                disabled={!canWrite}
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 outline-none"
              />
              {carried && (
                <p className="mt-1 text-[11px] text-brand-400">
                  ↩ carried from yesterday&apos;s closing count — edit if you added/removed cash.
                </p>
              )}
            </div>
            {/* The full workings. "Expected 480, counted 455" is an accusation;
                showing what made up the 480 is something you can check. Cash
                expenses and petty cash were invisible here before, so an
                honestly-run day always looked short. */}
            <div className="flex justify-between border-t border-line pt-3 text-fg-soft">
              <span>+ Cash sales</span>
              <span>{format(summary.totals.cash_sales)}</span>
            </div>
            {summary.drawer && Number(summary.drawer.cash_expenses) > 0 && (
              <div className="flex justify-between text-rose-300">
                <span>− Paid out in cash</span>
                <span>{format(summary.drawer.cash_expenses)}</span>
              </div>
            )}
            {summary.drawer && Number(summary.drawer.petty_out) > 0 && (
              <div className="flex justify-between text-amber-300">
                <span>− Petty cash still out</span>
                <span>{format(summary.drawer.petty_out)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium text-fg">
              <span>= Expected in drawer</span>
              <span>{format(expectedNow)}</span>
            </div>
            <div>
              <label className="flex items-center justify-between text-fg-faint">
                Counted at close
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setPad((c) => (c === "counted" ? null : "counted"))}
                    className={`mise-press rounded-md px-1.5 text-base leading-none ${pad === "counted" ? "text-brand-300" : "text-fg-faint"}`}
                    title="Big-key till pad"
                    aria-label="Toggle keypad"
                  >
                    🧮
                  </button>
                )}
              </label>
              <input
                value={counted}
                onChange={(e) => setCounted(numeric(e.target.value))}
                inputMode="decimal"
                disabled={!canWrite}
                placeholder="physical count"
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 outline-none"
              />
              {pad === "counted" && <TillKeypad value={counted} onChange={setCounted} onClose={() => setPad(null)} />}
              {summary.auto_closed && (
                <p className="mt-1.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-300">
                  Closed automatically after midnight using the expected figure —
                  nobody counted it. Enter the real count if you have it.
                </p>
              )}
            </div>

            <PettyCash
              day={day}
              rows={pettyRows}
              categories={expenseCats}
              canWrite={canWrite}
              onChanged={() => loadDay(day)}
            />

            {/* The cash trail. Quiet by default — you only want it when a figure
                looks wrong — but always there, because a closing amount that can
                be edited days later needs a record of who changed it and why. */}
            <div className="mt-4 border-t border-line pt-3">
              <button
                type="button"
                onClick={async () => {
                  const opening = !historyOpen;
                  setHistoryOpen(opening);
                  // Always re-read when opening. The old guard was
                  // `if (history === null)`, so it fetched once per page load
                  // and then never again — save the till three times and the
                  // panel still showed the empty list it had cached before the
                  // first save. An audit trail that lies is worse than none.
                  if (!opening) return;
                  try {
                    setHistory(await api.get<CashEvent[]>(`/sales/days/${day}/cash-history`));
                  } catch {
                    setHistory([]);
                  }
                }}
                className="flex items-center gap-1.5 text-[11px] text-fg-faint transition hover:text-fg-soft"
              >
                <span aria-hidden className={`transition-transform ${historyOpen ? "rotate-90" : ""}`}>▸</span>
                Cash history
              </button>
              {historyOpen && (
                <div className="mise-pop mt-2">
                  {history === null ? (
                    <p className="text-[11px] text-fg-faint">Loading…</p>
                  ) : history.length === 0 ? (
                    <p className="text-[11px] text-fg-faint">No changes recorded for this day.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {history.map((h) => (
                        <li key={h.id} className="rounded-lg border border-line bg-paper-2/40 px-2.5 py-1.5 text-[11px]">
                          <span className="text-fg-soft">
                            {h.field === "cash_counted" ? "Closing count" : "Opening cash"}
                          </span>{" "}
                          <span className="text-fg-faint">
                            {h.old_value !== null ? format(h.old_value) : "—"} →{" "}
                          </span>
                          <b className="text-fg">{h.new_value !== null ? format(h.new_value) : "—"}</b>
                          {h.source === "auto" && (
                            <span className="ml-1.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                              automatic
                            </span>
                          )}
                          <span className="block text-fg-faint">
                            {new Date(h.created_at).toLocaleString()}
                            {h.reason ? ` · ${h.reason}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            {varianceNum != null && (
              varianceNum === 0 ? (
                // The nightly payoff: the till settles, the tick draws itself.
                <div className="mise-pop-lg flex items-center gap-3 rounded-xl border border-brand-400/30 bg-brand-400/10 px-4 py-3">
                  <svg viewBox="0 0 24 24" className="mise-tick h-7 w-7 shrink-0" aria-hidden>
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#34d399" strokeOpacity="0.35" strokeWidth="2" />
                    <path
                      d="M7 12.5l3.2 3.2L17 9"
                      fill="none"
                      stroke="#34d399"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pathLength={1}
                    />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-brand-300">Till balanced</p>
                    <p className="font-mono text-xs text-brand-300/80">variance {format(variance)} · every penny accounted for</p>
                  </div>
                  <ChefMascot mood="serve" className="w-16 shrink-0" />
                </div>
              ) : (
                <div className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-300">
                  Variance: {format(variance)} — please check
                </div>
              )
            )}
            {canWrite && (
              <button
                onClick={saveCash}
                // It was bg-glass/10 with white text: a pale block that reads
                // as disabled, which is what he called "that grey color dead
                // save button". It is the only way to commit the count, so it
                // has to look like the primary action it is.
                className="mise-press w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {dirtyCash ? "Save cash" : "Saved"}
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* The charts come AFTER the day's takings, not before them.
          "core numbers first, pie charts last." A donut is how the day looked
          once it is over; entering and checking the lines is what someone is
          on this page to DO, and it was sitting below two charts and a heat
          map before you could reach it. */}
      {channelSegs.length > 0 && (
        <Card className="mise-feel mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-fg">Takings by channel</h2>
            <span className="text-xs text-fg-faint">{day}</span>
          </div>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <Donut
              segments={channelSegs}
              centerValue={format(summary.totals.gross)}
              centerLabel="gross today"
              className="mt-4"
              formatValue={(v) => format(String(v))}
            />
            {methodSegs.length > 0 && (
              <div className="mise-well mt-4 rounded-xl p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  How it was paid — each square is 1%
                </p>
                <Waffle segments={methodSegs} formatValue={(v) => format(String(v))} />
              </div>
            )}
          </div>
          {chanTrend && Object.keys(chanTrend).length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                Each channel&apos;s week — last 7 days
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(chanTrend)
                  .sort((a, b) => b[1][6] - a[1][6])
                  .slice(0, 6)
                  .map(([name, data]) => (
                    <div key={name} className="mise-well mise-feel rounded-xl p-3">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-fg">{name}</span>
                        <span className="mb-1 flex-1 border-b border-dotted border-line" />
                        <span className="font-mono text-sm text-fg-soft">{format(String(data[6]))}</span>
                      </div>
                      <Sparkline
                        data={data}
                        labels={trendLabels}
                        formatValue={(v) => format(String(v))}
                        height={26}
                        className="mt-2 h-[26px] w-full"
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {heatDays.length > 1 && (
        <Card className="mise-feel mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-fg">Takings rhythm — last 10 weeks</h2>
            <span className="text-xs text-fg-faint">darker = bigger day · hover for the figure</span>
          </div>
          <div className="mise-well mt-4 overflow-x-auto rounded-xl p-4">
            <CalendarHeat days={heatDays} formatValue={(v) => format(String(v))} />
          </div>
        </Card>
      )}

      {isSuper && (
        <ListManager
          title="Manage sales channels & commission"
          noun="channel"
          usageNoun="sales line"
          items={channels.map((c) => ({
            id: c.id,
            name: c.name,
            is_active: c.is_active,
            usage_count: c.usage_count ?? 0,
          }))}
          addFields={[
            { key: "commission_pct", label: "Commission %", type: "number", placeholder: "0", default: "" },
          ]}
          onAdd={async (name, extra) => {
            await api.post("/sales/channels", { name, commission_pct: extra.commission_pct || "0" });
          }}
          onRename={async (id, name) => {
            await api.patch(`/sales/channels/${id}`, { name });
          }}
          onSetActive={async (id, active) => {
            await api.patch(`/sales/channels/${id}`, { is_active: active });
          }}
          reload={reloadChannels}
          renderRowExtra={(item) => (
            <span className="flex shrink-0 items-center gap-1">
              <input
                defaultValue={channels.find((c) => c.id === item.id)?.commission_pct}
                onBlur={async (e) => {
                  await api.patch(`/sales/channels/${item.id}`, {
                    commission_pct: e.target.value || "0",
                  });
                  await reloadChannels();
                }}
                inputMode="decimal"
                className="mise-well w-14 rounded-md px-2 py-1 text-right text-xs outline-none"
                title="Commission %"
              />
              <span className="text-xs text-fg-faint">%</span>
            </span>
          )}
        />
      )}
    </div>
  );
}

/** Big neumorphic number pad — counting cash with thumbs, not a fiddly input. */
function TillKeypad({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const press = (k: string) => {
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === "." && value.includes(".")) return;
    const next = (value === "0" && k !== "." ? "" : value) + (k === "." && !value ? "0." : k);
    if (/^\d*(\.\d{0,2})?$/.test(next)) onChange(next);
  };
  return (
    <div className="mise-pop mt-3 max-w-xs">
      <div className="mise-well flex items-center justify-between rounded-xl px-4 py-2">
        <span className="font-mono text-2xl font-bold tabular-nums text-fg">{value || "0"}</span>
        <button type="button" onClick={() => onChange("")} className="text-xs text-fg-faint hover:text-fg">
          clear
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="mise-raised mise-press h-14 rounded-2xl text-xl font-semibold text-fg"
            aria-label={k === "⌫" ? "Delete last digit" : k}
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" onClick={onClose} className="mt-1.5 w-full py-1 text-center text-xs text-fg-faint hover:text-fg">
        hide keypad
      </button>
    </div>
  );
}
