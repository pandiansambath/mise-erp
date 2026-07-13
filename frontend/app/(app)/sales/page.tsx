"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, downloadFile, postForm, type DaySummary, type SalesChannel } from "@/lib/api";
import { Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { CalendarHeat, Donut, Waffle, type DonutSegment, Sparkline } from "@/components/charts";
import { Select } from "@/components/Select";
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

  const [day, setDay] = useState(today());
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // add-line form
  const [channelId, setChannelId] = useState("");
  const [gross, setGross] = useState("");
  // 🧮 big-key till pad — which field it types into
  const [pad, setPad] = useState<null | "gross" | "counted">(null);
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
    const s = await api.get<DaySummary>(`/sales/days/${d}`);
    setSummary(s);
    setCounted(s.cash_counted ?? "");
    setCarried(false);
    if (s.opening_cash) {
      setOpening(s.opening_cash);
    } else {
      // Auto-carry: yesterday's closing count becomes today's opening (editable).
      const prev = new Date(d + "T00:00:00");
      prev.setDate(prev.getDate() - 1);
      try {
        const ps = await api.get<DaySummary>(`/sales/days/${localISODate(prev)}`);
        setOpening(ps.cash_counted ?? "");
        setCarried(Boolean(ps.cash_counted && ps.cash_counted !== ""));
      } catch {
        setOpening("");
      }
    }
  };

  useEffect(() => {
    Promise.all([
      api.get<SalesChannel[]>("/sales/channels").then((c) => {
        setChannels(c);
        if (c.length) setChannelId(c[0].id);
      }),
      loadDay(day),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeDay(d: string) {
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

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const s = await api.post<DaySummary>(`/sales/days/${day}/lines`, {
        channel_id: channelId,
        gross_amount: gross || "0",
        payment_method: method,
      });
      setSummary(s);
      setGross("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add sale");
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save cash");
    }
  }

  if (loading || !summary) return <Spinner />;

  const variance = summary.cash_variance;
  const varianceNum = variance != null ? parseFloat(variance) : null;

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
      <PageHeader title="Sales & Cash" subtitle="One day at a time — takings by channel, commissions and the till for the date you pick." />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-fg-soft">Date</label>
        <input
          type="date"
          value={day}
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
                className="rounded-lg border border-line-2 px-3 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
                title="Upload a day's sales (Excel/CSV) — checked strictly with exact errors"
              >
                ⬆ Import
              </button>
              <button
                onClick={() => downloadFile("/sales/sales-template.xlsx", "mise-sales-template.xlsx")}
                className="rounded-lg border border-line-2 px-3 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
              >
                ⬇ Template (Excel)
              </button>
              <button
                onClick={() => downloadFile("/sales/sales-template.csv", "mise-sales-template.csv")}
                className="rounded-lg border border-line-2 px-3 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
              >
                CSV
              </button>
            </>
          )}
          <button
            onClick={() => downloadFile(`/sales/days/${day}/sheet.pdf`, `sales-${day}.pdf`)}
            className="rounded-lg border border-line-2 px-3 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Add + lines */}
        <div className="min-w-0 lg:col-span-2">
          {canWrite && (
            <Card className="mb-4" id="sales-form">
              <form onSubmit={addLine} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-fg-soft">Channel</label>
                  <Select
                    value={channelId}
                    onChange={setChannelId}
                    className="mt-1"
                    options={channels
                      .filter((c) => c.is_active)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.name} (${c.commission_pct}%)`,
                      }))}
                  />
                </div>
                <div className="w-full sm:w-32">
                  <label className="flex items-center justify-between text-sm font-medium text-fg-soft">
                    Gross
                    <button
                      type="button"
                      onClick={() => setPad((c) => (c === "gross" ? null : "gross"))}
                      className={`mise-press rounded-md px-1.5 text-base leading-none ${pad === "gross" ? "text-brand-300" : "text-fg-faint"}`}
                      title="Big-key till pad"
                      aria-label="Toggle keypad"
                    >
                      🧮
                    </button>
                  </label>
                  <input
                    value={gross}
                    onChange={(e) => setGross(numeric(e.target.value))}
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm"
                  />
                </div>
                <div className="w-full sm:w-32">
                  <label className="block text-sm font-medium text-fg-soft">Method</label>
                  <Select
                    value={method}
                    onChange={setMethod}
                    className="mt-1"
                    options={METHODS.map((m) => ({ value: m, label: m }))}
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Add
                </button>
              </form>
              {pad === "gross" && <TillKeypad value={gross} onChange={setGross} onClose={() => setPad(null)} />}
              {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
            </Card>
          )}

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                    <th className="px-5 py-3 font-medium">Channel</th>
                    <th className="px-5 py-3 font-medium">Method</th>
                    <th className="px-5 py-3 text-right font-medium">Gross</th>
                    <th className="px-5 py-3 text-right font-medium">Commission</th>
                    <th className="px-5 py-3 text-right font-medium">Net</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-fg-faint">
                        No sales entered for this day yet.
                      </td>
                    </tr>
                  ) : (
                    summary.lines.map((l) => (
                      <tr key={l.id} className="border-b border-line">
                        <td className="px-5 py-3 font-medium text-fg">{l.channel_name}</td>
                        <td className="px-5 py-3 text-fg-faint">{l.payment_method}</td>
                        <td className="px-5 py-3 text-right text-fg-soft">{format(l.gross_amount)}</td>
                        <td className="px-5 py-3 text-right text-rose-400">{format(l.commission)}</td>
                        <td className="px-5 py-3 text-right font-medium text-fg">{format(l.net_amount)}</td>
                        <td className="px-5 py-3 text-right">
                          {canWrite && (
                            <button
                              onClick={() => removeLine(l.id)}
                              className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-paper-2"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Cash reconciliation */}
        <Card>
          <h3 className="font-semibold text-fg">Cash drawer</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <label className="block text-fg-faint">Opening cash</label>
              <input
                value={opening}
                onChange={(e) => { setOpening(numeric(e.target.value)); setCarried(false); }}
                inputMode="decimal"
                disabled={!canWrite}
                className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2"
              />
              {carried && (
                <p className="mt-1 text-[11px] text-brand-400">
                  ↩ carried from yesterday&apos;s closing count — edit if you added/removed cash.
                </p>
              )}
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-fg-soft">
              <span>+ Cash sales</span>
              <span>{format(summary.totals.cash_sales)}</span>
            </div>
            <div className="flex justify-between font-medium text-fg">
              <span>= Expected in drawer</span>
              <span>{format(summary.expected_cash)}</span>
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
                className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2"
              />
              {pad === "counted" && <TillKeypad value={counted} onChange={setCounted} onClose={() => setPad(null)} />}
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
                className="w-full rounded-lg bg-glass/10 ring-1 ring-glass/15 px-4 py-2 text-sm font-semibold text-white hover:bg-glass/15"
              >
                Save cash
              </button>
            )}
          </div>
        </Card>
      </div>

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
                className="w-14 rounded border border-line-2 bg-transparent px-2 py-1 text-right text-xs"
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
