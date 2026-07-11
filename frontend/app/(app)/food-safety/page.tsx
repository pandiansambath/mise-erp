"use client";

import { useEffect, useState } from "react";
import { api, ApiError, downloadFile, type SafetyLog } from "@/lib/api";
import { Badge, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { Donut } from "@/components/charts";
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

  // Range health: temps in/out of range + how many of today's checks are done
  const temps = logs.filter((l) => l.kind === "TEMP");
  const tempsOk = temps.filter((l) => l.status !== "FAIL").length;
  const tempsFail = temps.length - tempsOk;
  const todayChecks = new Set(
    logs.filter((l) => l.kind === "CHECK" && l.date === today()).map((l) => l.label),
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Food safety"
          subtitle="Temperature readings + daily cleaning/opening/closing checks — your EHO audit trail."
        />
        <Button
          variant="soft"
          onClick={() =>
            downloadFile(
              `/safety/logs.pdf?date_from=${from}&date_to=${to}`,
              `food-safety-log-${from}_${to}.pdf`
            )
          }
        >
          ⬇ Download (PDF)
        </Button>
      </div>

      {temps.length > 0 && (
        <Card className="mise-feel mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-[220px] flex-1">
              <h3 className="font-semibold text-fg">Temperatures in range</h3>
              <p className="text-xs text-fg-faint">for the picked date range — a FAIL is what an EHO asks about first</p>
              <div className="mt-4">
                <Donut
                  centerLabel="readings"
                  centerValue={String(temps.length)}
                  segments={[
                    { label: "In range", value: tempsOk, color: "#10b981" },
                    { label: "FAIL", value: tempsFail, color: "#f43f5e" },
                  ].filter((s) => s.value > 0)}
                />
              </div>
            </div>
            <div className="mise-well min-w-[220px] rounded-xl p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-faint">Today&apos;s checks</p>
              <p className="mt-1 text-2xl font-bold text-fg">
                {todayChecks.size}<span className="text-sm font-medium text-fg-faint"> / {DAILY_CHECKS.length} done</span>
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-glass/10">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${todayChecks.size === DAILY_CHECKS.length ? "bg-brand-500" : "bg-amber-500"}`}
                  style={{ width: `${(todayChecks.size / DAILY_CHECKS.length) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {msg && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{msg}</p>}

      {canWrite && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card className="mise-feel">
            <h3 className="font-semibold text-fg">Log a temperature</h3>
            <form onSubmit={saveTemp} className="mt-3 space-y-3">
              <input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                placeholder="Appliance / location (e.g. Walk-in fridge)"
                className="mise-well w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
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
                  className="mise-well w-20 rounded-lg px-3 py-2 text-center text-sm text-fg outline-none"
                />
                {tempStatus && <StatusBadge s={tempStatus} />}
              </div>
              <Button type="submit" variant="primary" busy={busy}>
                Log temperature
              </Button>
            </form>
          </Card>

          <Card className="mise-feel">
            <h3 className="font-semibold text-fg">Daily checks</h3>
            <div className="mt-3 space-y-2">
              {DAILY_CHECKS.map((t) => (
                <label
                  key={t}
                  className={`mise-well mise-feel flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                    ticked[t] ? "text-fg" : "text-fg-soft"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!ticked[t]}
                    onChange={(e) => setTicked({ ...ticked, [t]: e.target.checked })}
                    className="h-4 w-4 accent-brand-500"
                  />
                  {t}
                  {todayChecks.has(t) && <Badge tone="green">✓ logged today</Badge>}
                </label>
              ))}
            </div>
            <Button className="mt-3" variant="primary" onClick={saveChecks} busy={busy}>
              Save checks
            </Button>
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
