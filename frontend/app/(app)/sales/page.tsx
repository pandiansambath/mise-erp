"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type DaySummary, type SalesChannel } from "@/lib/api";
import { Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const METHODS = ["CARD", "CASH", "ONLINE", "BANK"];
const today = () => new Date().toISOString().slice(0, 10);

export default function SalesPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "sales:write");
  const canConfig = can(user?.role, "sales:config");

  const [day, setDay] = useState(today());
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // add-line form
  const [channelId, setChannelId] = useState("");
  const [gross, setGross] = useState("");
  const [method, setMethod] = useState("CARD");

  // cash form
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");

  const loadDay = useCallback(async (d: string) => {
    const s = await api.get<DaySummary>(`/sales/days/${d}`);
    setSummary(s);
    setOpening(s.opening_cash ?? "");
    setCounted(s.cash_counted ?? "");
  }, []);

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

  return (
    <div>
      <PageHeader title="Sales & Cash" subtitle="Daily takings by channel, commissions, and the till." />

      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Date</label>
        <input
          type="date"
          value={day}
          onChange={(e) => changeDay(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          {canWrite && (
            <Card className="mb-4">
              <form onSubmit={addLine} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700">Channel</label>
                  <select
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.commission_pct}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-full sm:w-32">
                  <label className="block text-sm font-medium text-slate-700">Gross</label>
                  <input
                    value={gross}
                    onChange={(e) => setGross(e.target.value)}
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="w-full sm:w-32">
                  <label className="block text-sm font-medium text-slate-700">Method</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Add
                </button>
              </form>
              {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            </Card>
          )}

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
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
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                        No sales entered for this day yet.
                      </td>
                    </tr>
                  ) : (
                    summary.lines.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="px-5 py-3 font-medium text-slate-800">{l.channel_name}</td>
                        <td className="px-5 py-3 text-slate-500">{l.payment_method}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{format(l.gross_amount)}</td>
                        <td className="px-5 py-3 text-right text-rose-600">{format(l.commission)}</td>
                        <td className="px-5 py-3 text-right font-medium text-slate-900">{format(l.net_amount)}</td>
                        <td className="px-5 py-3 text-right">
                          {canWrite && (
                            <button
                              onClick={() => removeLine(l.id)}
                              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
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
          <h3 className="font-semibold text-slate-900">Cash drawer</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <label className="block text-slate-500">Opening cash</label>
              <input
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                inputMode="decimal"
                disabled={!canWrite}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-3 text-slate-600">
              <span>+ Cash sales</span>
              <span>{format(summary.totals.cash_sales)}</span>
            </div>
            <div className="flex justify-between font-medium text-slate-800">
              <span>= Expected in drawer</span>
              <span>{format(summary.expected_cash)}</span>
            </div>
            <div>
              <label className="block text-slate-500">Counted at close</label>
              <input
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                inputMode="decimal"
                disabled={!canWrite}
                placeholder="physical count"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            {varianceNum != null && (
              <div
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  varianceNum === 0
                    ? "bg-brand-50 text-brand-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                Variance: {format(variance)} {varianceNum === 0 ? "✓ balanced" : "— please check"}
              </div>
            )}
            {canWrite && (
              <button
                onClick={saveCash}
                className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
              >
                Save cash
              </button>
            )}
          </div>
        </Card>
      </div>

      {canConfig && <ChannelManager channels={channels} onChange={setChannels} />}
    </div>
  );
}

function ChannelManager({
  channels,
  onChange,
}: {
  channels: SalesChannel[];
  onChange: (c: SalesChannel[]) => void;
}) {
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const [open, setOpen] = useState(false);

  async function reload() {
    onChange(await api.get<SalesChannel[]>("/sales/channels"));
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/sales/channels", { name, commission_pct: pct || "0" });
    setName("");
    setPct("");
    await reload();
  }
  async function setCommission(id: string, value: string) {
    await api.patch(`/sales/channels/${id}`, { commission_pct: value || "0" });
    await reload();
  }

  return (
    <Card className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="font-semibold text-slate-900">Channels &amp; commission rates</h3>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{c.name}</span>
                <span className="flex items-center gap-1">
                  <input
                    defaultValue={c.commission_pct}
                    onBlur={(e) => setCommission(c.id, e.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                  />
                  <span className="text-slate-400">%</span>
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={add} className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">New channel</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Hungry Panda"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-full sm:w-28">
              <label className="block text-sm font-medium text-slate-700">Commission %</label>
              <input
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Add
            </button>
          </form>
        </div>
      )}
    </Card>
  );
}
