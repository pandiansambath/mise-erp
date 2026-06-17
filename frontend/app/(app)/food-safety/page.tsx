"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type SafetyLog } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());

// UK food-safety temperature targets.
const TEMP_TYPES = [
  { key: "fridge", label: "Fridge (≤ 5°C)", ok: (t: number) => t <= 5 },
  { key: "freezer", label: "Freezer (≤ -18°C)", ok: (t: number) => t <= -18 },
  { key: "hot", label: "Hot-hold (≥ 63°C)", ok: (t: number) => t >= 63 },
  { key: "other", label: "Other", ok: () => true },
];

const DAILY_CHECKS = [
  "Fridges & freezers temped",
  "Surfaces & equipment sanitised",
  "Hand-wash station stocked",
  "Waste removed & bins cleaned",
  "Floors cleaned",
  "Opening checks done",
  "Closing checks done",
];

function StatusBadge({ s }: { s: string }) {
  if (s === "FAIL") return <Badge tone="red">FAIL</Badge>;
  if (s === "DONE") return <Badge tone="green">✓ done</Badge>;
  return <Badge tone="green">OK</Badge>;
}

export default function FoodSafetyPage() {
  const { user } = useAuth();
  const canWrite = can(user?.role, "inventory:write");

  const [logs, setLogs] = useState<SafetyLog[] | null>(null);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [msg, setMsg] = useState<string | null>(null);

  // temperature form
  const [loc, setLoc] = useState("");
  const [ttype, setTtype] = useState("fridge");
  const [temp, setTemp] = useState("");
  // checks
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  function reload() {
    return api
      .get<SafetyLog[]>(`/safety/logs?date_from=${from}&date_to=${to}`)
      .then(setLogs)
      .catch(() => setMsg("Could not load logs."));
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const tnum = parseFloat(temp);
  const type = TEMP_TYPES.find((t) => t.key === ttype)!;
  const tempStatus = temp !== "" && !Number.isNaN(tnum) ? (type.ok(tnum) ? "OK" : "FAIL") : null;

  async function saveTemp(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!loc.trim() || temp === "" || Number.isNaN(tnum)) {
      setMsg("Enter the appliance/location and a temperature.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/safety/logs", {
        kind: "TEMP",
        label: `${loc.trim()} · ${type.label}`,
        reading: temp,
        status: tempStatus,
      });
      setLoc("");
      setTemp("");
      await reload();
      setMsg("Temperature logged.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not log temperature");
    } finally {
      setBusy(false);
    }
  }

  async function saveChecks() {
    const tasks = DAILY_CHECKS.filter((t) => ticked[t]);
    if (tasks.length === 0) {
      setMsg("Tick at least one check.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      for (const t of tasks) {
        await api.post("/safety/logs", { kind: "CHECK", label: t, status: "DONE" });
      }
      setTicked({});
      await reload();
      setMsg(`Logged ${tasks.length} check${tasks.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not log checks");
    } finally {
      setBusy(false);
    }
  }

  if (!logs) return <Spinner />;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Food safety"
          subtitle="Temperature readings + daily cleaning/opening/closing checks — your EHO audit trail."
        />
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
        >
          🖨 Print
        </button>
      </div>

      {msg && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{msg}</p>}

      {canWrite && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-fg">Log a temperature</h3>
            <form onSubmit={saveTemp} className="mt-3 space-y-3">
              <input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                placeholder="Appliance / location (e.g. Walk-in fridge)"
                className="w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={ttype}
                  onChange={setTtype}
                  className="w-48"
                  options={TEMP_TYPES.map((t) => ({ value: t.key, label: t.label }))}
                />
                <input
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  inputMode="decimal"
                  placeholder="°C"
                  className="w-20 rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-center text-sm text-fg outline-none focus:border-brand-500"
                />
                {tempStatus && <StatusBadge s={tempStatus} />}
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                Log temperature
              </button>
            </form>
          </Card>

          <Card>
            <h3 className="font-semibold text-fg">Daily checks</h3>
            <div className="mt-3 space-y-2">
              {DAILY_CHECKS.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 text-sm text-fg-soft">
                  <input
                    type="checkbox"
                    checked={!!ticked[t]}
                    onChange={(e) => setTicked({ ...ticked, [t]: e.target.checked })}
                    className="h-4 w-4 accent-brand-500"
                  />
                  {t}
                </label>
              ))}
            </div>
            <button
              onClick={saveChecks}
              disabled={busy}
              className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Save checks
            </button>
          </Card>
        </div>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 className="font-semibold text-fg">Log</h3>
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line-2 bg-glass/5 px-2 py-1 text-fg-soft" />
            <span className="text-fg-faint">→</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line-2 bg-glass/5 px-2 py-1 text-fg-soft" />
          </div>
        </div>
        {logs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-faint">No entries for this range.</p>
        ) : (
          <ul className="divide-y divide-line">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">
                    {l.kind === "TEMP" ? "🌡 " : "🧼 "}{l.label}
                    {l.reading != null && <b className="ml-2 text-fg">{l.reading}°C</b>}
                  </span>
                  <span className="block text-xs text-fg-faint">
                    {l.date} · {new Date(l.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <StatusBadge s={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
