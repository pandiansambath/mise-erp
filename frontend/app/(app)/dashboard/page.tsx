"use client";

// The dashboard — the owner's first 10 seconds every morning. Numbers count,
// the week draws itself, money composition is a donut, targets are meters,
// and everything presses like a real surface. Data is 100% live (no fakes):
// KPIs + P&L ranges + a 7-day series assembled from per-day P&L calls.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type DashboardKpis, type PnL, type POSummary } from "@/lib/api";
import { AreaChart, Bars, CalendarHeat, Donut, Meter, type DonutSegment } from "@/components/charts";
import { AnimatedNumber } from "@/components/fx";
import { Badge, Button, Card, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { localISODate } from "@/lib/date";

interface LowStock {
  item_id: string;
  name: string;
  current_stock: string;
  min_stock_level: string;
}

type DayPoint = { label: string; net: number };

/** One week-over-week metric with a ▲▼ delta coloured by whether the move is good. */
function WowStat({
  label,
  cur,
  prev,
  fmt,
  pct = false,
  higherBetter = true,
}: {
  label: string;
  cur: string;
  prev: string;
  fmt: (v: string) => string;
  pct?: boolean;
  higherBetter?: boolean;
}) {
  const c = parseFloat(cur) || 0;
  const p = parseFloat(prev) || 0;
  const diff = c - p;
  const pctChange = p !== 0 ? (diff / Math.abs(p)) * 100 : c !== 0 ? 100 : 0;
  const good = higherBetter ? diff >= 0 : diff <= 0;
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "→";
  const show = (v: string) => (pct ? `${v}%` : fmt(v));
  return (
    <div className="mise-well mise-feel rounded-xl p-3.5">
      <p className="text-xs uppercase tracking-wide text-fg-faint">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-fg">{show(cur)}</p>
      <p className={`mt-0.5 text-xs ${diff === 0 ? "text-fg-faint" : good ? "text-brand-400" : "text-rose-400"}`}>
        {arrow} {Math.abs(pctChange).toFixed(0)}% vs {show(prev)} last week
      </p>
    </div>
  );
}

const ACTIONS = [
  { href: "/reports", perm: "reports:read", icon: "📈", title: "View P&L", desc: "Profit, margins, downloadable report." },
  { href: "/sales", perm: "sales:read", icon: "🧾", title: "Enter sales", desc: "Record today's takings by channel." },
  { href: "/price-comparison", perm: "vendors:read", icon: "⚖", title: "Compare prices", desc: "Find the cheapest supplier." },
  { href: "/recipes", perm: "recipes:read", icon: "🍲", title: "Dish margins", desc: "Cost per plate and profit." },
  { href: "/expenses", perm: "expenses:read", icon: "💸", title: "Log expenses", desc: "Track fixed & variable costs." },
];

const DONUT_COLORS = ["#f59e0b", "#f43f5e", "#0ea5e9", "#10b981"];

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-3 h-[30px]" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-32" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, hotel } = useAuth();
  const { format } = useCurrency();
  const role = user?.role;
  const seeFinance = can(role, "reports:read");
  const seeInventory = can(role, "inventory:read");

  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [low, setLow] = useState<LowStock[]>([]);
  const [week, setWeek] = useState<DayPoint[] | null>(null); // last 7 days, oldest first
  const [monthDays, setMonthDays] = useState<{ date: string; value: number }[]>([]); // ~5 weeks for the heatmap
  const [tonight, setTonight] = useState<string[]>([]); // who's on the rota today
  const [dueToday, setDueToday] = useState(0); // POs the vendor promised for today (or missed)
  const [checksDone, setChecksDone] = useState<number | null>(null); // today's safety checks
  const [curWeek, setCurWeek] = useState<PnL | null>(null);
  const [prevWeek, setPrevWeek] = useState<PnL | null>(null);
  const [setupDone, setSetupDone] = useState(true); // assume done → no flash; corrected in effect
  useEffect(() => {
    try { setSetupDone(localStorage.getItem("mise.setup.done") === "1"); } catch { /* ignore */ }
  }, []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const jobs: Promise<unknown>[] = [];
    const iso = localISODate;
    const ago = (n: number) => {
      const x = new Date();
      x.setDate(x.getDate() - n);
      return x;
    };
    if (seeFinance) {
      jobs.push(api.get<DashboardKpis>("/reports/dashboard").then(setKpis).catch(() => {}));
      jobs.push(
        api.get<PnL>(`/reports/pnl?date_from=${iso(ago(6))}&date_to=${iso(ago(0))}`)
          .then(setCurWeek)
          .catch(() => {}),
      );
      jobs.push(
        api.get<PnL>(`/reports/pnl?date_from=${iso(ago(13))}&date_to=${iso(ago(7))}`)
          .then(setPrevWeek)
          .catch(() => {}),
      );
      // One query covers BOTH the 7-day trend line and the 5-week heatmap
      // (used to be seven separate per-day P&L calls).
      jobs.push(
        api
          .get<{ days: { date: string; net: string }[] }>(
            `/reports/sales-trend?date_from=${iso(ago(34))}&date_to=${iso(ago(0))}`,
          )
          .then((r) => {
            const byDate = new Map(r.days.map((d) => [d.date, parseFloat(d.net) || 0]));
            setWeek(
              [6, 5, 4, 3, 2, 1, 0].map((n) => {
                const d = ago(n);
                return {
                  label: d.toLocaleDateString("en-GB", { weekday: "short" }),
                  net: byDate.get(iso(d)) ?? 0,
                };
              }),
            );
            setMonthDays(r.days.map((d) => ({ date: d.date, value: parseFloat(d.net) || 0 })));
          })
          .catch(() => {}),
      );
    }
    if (seeInventory)
      jobs.push(api.get<LowStock[]>("/inventory/alerts/low-stock").then(setLow).catch(() => {}));
    if (can(role, "indent:read"))
      jobs.push(
        api
          .get<POSummary[]>("/purchasing/purchase-orders")
          .then((pos) => {
            const t = new Date().toISOString().slice(0, 10);
            setDueToday(
              pos.filter((p) => p.status !== "RECEIVED" && p.expected_delivery && p.expected_delivery <= t).length,
            );
          })
          .catch(() => {}),
      );
    // safety pulse: how many of today's 7 daily checks are logged?
    {
      const t0 = iso(ago(0));
      jobs.push(
        api
          .get<{ kind: string; label: string; date: string }[]>(`/safety/logs?date_from=${t0}&date_to=${t0}`)
          .then((logs) => setChecksDone(new Set(logs.filter((l) => l.kind === "CHECK").map((l) => l.label)).size))
          .catch(() => {}),
      );
    }
    // who's cooking today — the rota says
    {
      const t = iso(ago(0));
      jobs.push(
        api
          .get<{ employee_name: string }[]>(`/rota/shifts?date_from=${t}&date_to=${t}`)
          .then((rows) => setTonight([...new Set(rows.map((r) => r.employee_name))]))
          .catch(() => {}),
      );
    }
    Promise.all(jobs).finally(() => setLoading(false));
  }, [seeFinance, seeInventory, role]);

  // Where this week's net sales went: costs, expenses, and what was kept.
  const donut = useMemo<DonutSegment[] | null>(() => {
    if (!curWeek) return null;
    const cos = Math.max(0, parseFloat(curWeek.cost_of_sales) || 0);
    const opex = Math.max(0, parseFloat(curWeek.operating_expenses) || 0);
    const comm = Math.max(0, parseFloat(curWeek.commission) || 0);
    const kept = Math.max(0, parseFloat(curWeek.net_profit) || 0);
    const segs = [
      { label: "Cost of sales", value: cos, color: DONUT_COLORS[0] },
      { label: "Expenses", value: opex, color: DONUT_COLORS[1] },
      { label: "Commission", value: comm, color: DONUT_COLORS[2] },
      { label: "Kept (profit)", value: kept, color: DONUT_COLORS[3] },
    ].filter((s) => s.value > 0);
    return segs.length ? segs : null;
  }, [curWeek]);

  const weekSpark = useMemo(() => week?.map((d) => d.net) ?? [], [week]);
  const actions = ACTIONS.filter((a) => can(role, a.perm));
  const firstName = user?.preferred_name?.split(/\s+/)[0];

  if (loading) {
    return (
      <div>
        <PageHeader title={hotel ? hotel.name : "Dashboard"} subtitle="Your restaurant at a glance" />
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={hotel ? hotel.name : "Dashboard"}
        subtitle={firstName ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${firstName} — your restaurant at a glance` : "Your restaurant at a glance"}
        live
        actions={
          <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new Event("mise:tour"))}>
            ✨ Take a tour
          </Button>
        }
      />

      <p className="-mt-2 mb-5 text-xs text-fg-faint">
        {checksDone != null && checksDone < 7 && new Date().getHours() >= 10 && (
          <Link href="/food-safety" className="mise-well mise-press mr-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-amber-300 hover:text-amber-200">
            🌡 {checksDone}/7 safety checks logged today →
          </Link>
        )}
        {dueToday > 0 && (
          <Link href="/purchasing" className="mise-well mise-press mr-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sky-300 hover:text-sky-200">
            🚚 {dueToday} deliver{dueToday === 1 ? "y" : "ies"} due today →
          </Link>
        )}
        {tonight.length > 0 && (
          <span className="mise-well mr-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-fg-soft">
            <span aria-hidden>🧑‍🍳</span>
            <b className="text-fg">{tonight.length}</b> on service today:{" "}
            {tonight.slice(0, 3).map((n) => n.split(" ")[0]).join(", ")}
            {tonight.length > 3 ? ` +${tonight.length - 3}` : ""}
            <Link href="/rota" className="ml-1 text-brand-400 hover:underline">rota →</Link>
          </span>
        )}
        Time windows: <b className="text-fg-soft">Today</b> = since midnight ·{" "}
        <b className="text-fg-soft">Month</b> = 1st → today · <b className="text-fg-soft">This week vs last</b> ={" "}
        rolling last 7 days vs the 7 before. For any custom period, open{" "}
        <Link href="/reports" className="text-brand-400 underline">Reports</Link>.
      </p>

      {!setupDone && kpis && kpis.recipe_count === 0 && Number(kpis.month_net_sales) === 0 && Number(kpis.month_expenses) === 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/10 px-4 py-3">
          <p className="text-sm text-fg">
            👋 Let&apos;s finish setting up — import your items, suppliers, menu &amp; team so your dashboard fills with real numbers.
          </p>
          <div className="flex items-center gap-2">
            <Link href="/onboarding" className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500">
              Finish setup →
            </Link>
            <button
              onClick={() => { try { localStorage.setItem("mise.setup.done", "1"); } catch { /* ignore */ } setSetupDone(true); }}
              className="mise-press rounded-lg px-2 py-2 text-sm text-fg-faint hover:text-fg"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {seeFinance && kpis && (
        <div className="mise-slide-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Today's net sales" value={format(kpis.today_net_sales)} spark={weekSpark} href="/sales" />
          <StatCard label="Month net sales" value={format(kpis.month_net_sales)} href="/reports" />
          <StatCard
            label="Month profit"
            value={format(kpis.month_net_profit)}
            accent={parseFloat(kpis.month_net_profit) >= 0 ? "brand" : "rose"}
            hint={`${kpis.month_net_margin_pct}% margin`}
            href="/reports"
          />
          <div className="group relative">
            <StatCard
              label="Low stock"
              value={<AnimatedNumber value={kpis.low_stock_count} />}
              accent={kpis.low_stock_count ? "rose" : "brand"}
              hint={kpis.low_stock_count ? "Tap to see & reorder" : "All good"}
              href="/inventory?filter=low"
            />
            {/* hover preview: the worst offenders as little how-empty rings */}
            {low.length > 0 && (
              <div className="mise-pop pointer-events-none invisible absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-glass/15 bg-shell/95 p-3 opacity-0 shadow-2xl shadow-black/50 backdrop-blur-xl transition-all duration-200 group-hover:visible group-hover:opacity-100 lg:block hidden">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                  Emptiest shelves first
                </p>
                <div className="space-y-2">
                  {low.slice(0, 5).map((l) => {
                    const cur = parseFloat(l.current_stock) || 0;
                    const min = parseFloat(l.min_stock_level) || 1;
                    const pct = Math.max(0, Math.min(100, (cur / min) * 100));
                    return (
                      <div key={l.item_id} className="flex items-center gap-2.5">
                        <svg viewBox="0 0 36 36" className="h-8 w-8 shrink-0 -rotate-90" aria-hidden>
                          <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="5" />
                          <circle
                            cx="18" cy="18" r="14" fill="none"
                            stroke={pct < 40 ? "#f43f5e" : "#f59e0b"}
                            strokeWidth="5" strokeLinecap="round"
                            strokeDasharray={`${(pct / 100) * 87.96} 87.96`}
                          />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-fg">{l.name}</p>
                          <p className="text-[10px] text-fg-faint">{l.current_stock} left · min {l.min_stock_level}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {low.length > 5 && <p className="mt-2 text-[10px] text-fg-faint">+{low.length - 5} more below minimum</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {seeFinance && (week || donut) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          {week && (
            <Card className="mise-feel">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold text-fg">Net sales · last 7 days</h3>
                <span className="font-mono text-xs text-copper-300">
                  {format(String(week.reduce((s, d) => s + d.net, 0)))} total
                </span>
              </div>
              <AreaChart
                data={week.map((d) => d.net)}
                labels={week.map((d) => d.label)}
                height={140}
                className="mt-3"
                formatValue={(v) => format(String(v))}
              />
            </Card>
          )}
          {curWeek && (
            <Card className="mise-feel">
              <h3 className="font-semibold text-fg">Where this week&apos;s money went</h3>
              {donut ? (
                <Donut
                  segments={donut}
                  centerValue={format(curWeek.net_sales)}
                  centerLabel="net sales · 7d"
                  className="mt-4"
                  formatValue={(v) => format(String(v))}
                />
              ) : (
                // No money recorded yet — never leave a hole in the grid
                <div className="mise-well mt-4 rounded-xl p-6 text-center">
                  <p className="text-2xl" aria-hidden>🍽️</p>
                  <p className="mt-2 text-sm text-fg-soft">Nothing recorded this week yet.</p>
                  <p className="mt-1 text-xs text-fg-faint">
                    Record takings and expenses and this fills with your week&apos;s money story.
                  </p>
                  <Link
                    href="/sales?new=1"
                    className="mise-press mt-4 inline-block rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    Record today&apos;s takings →
                  </Link>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {seeFinance && monthDays.length > 1 && (
        <Card className="mise-feel mt-6">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold text-fg">The month&apos;s rhythm</h3>
            <span className="text-xs text-fg-faint">last 5 weeks · darker = bigger day</span>
          </div>
          <div className="mise-well mt-4 overflow-x-auto rounded-xl p-4">
            <CalendarHeat days={monthDays} formatValue={(v) => format(String(v))} />
          </div>
        </Card>
      )}

      {seeFinance && curWeek && (
        <Card className="mise-feel mt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-fg">Targets · this week</h3>
            <Link href="/reports" className="text-sm font-medium text-brand-400 hover:underline">
              Full report
            </Link>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Meter label="Food cost" value={parseFloat(curWeek.food_cost_pct) || 0} target={30} goodBelow />
            <Meter label="Gross margin" value={parseFloat(curWeek.gross_margin_pct) || 0} target={65} goodBelow={false} />
          </div>
        </Card>
      )}

      {seeFinance && curWeek && prevWeek && (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-fg">This week vs last week</h3>
            <span className="text-xs text-fg-faint">rolling 7 days</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <WowStat label="Net sales" cur={curWeek.net_sales} prev={prevWeek.net_sales} fmt={format} />
            <WowStat label="Net profit" cur={curWeek.net_profit} prev={prevWeek.net_profit} fmt={format} />
            <WowStat
              label="Food cost"
              cur={curWeek.food_cost_pct}
              prev={prevWeek.food_cost_pct}
              fmt={format}
              pct
              higherBetter={false}
            />
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {seeInventory && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-fg">Low stock alerts</h3>
              <Link href="/inventory" className="text-sm font-medium text-brand-400 hover:underline">
                View all
              </Link>
            </div>
            {low.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-faint">
                Nothing low — stock levels are healthy.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {low.slice(0, 6).map((l) => (
                    <li key={l.item_id}>
                      <Link
                        href={`/purchasing?item=${l.item_id}`}
                        title="Order this item — opens Purchasing with it picked"
                        className="group flex items-center justify-between gap-2 py-2.5 text-sm transition hover:bg-glass/[0.03]"
                      >
                        <span className="font-medium text-fg-soft group-hover:text-fg">{l.name}</span>
                        <span className="flex items-center gap-2">
                          <Badge tone="red">
                            {l.current_stock} left (min {l.min_stock_level})
                          </Badge>
                          <span className="text-xs font-medium text-brand-300 opacity-0 transition group-hover:opacity-100">
                            🛒 order →
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  <Bars
                    items={low.slice(0, 6).map((l) => ({
                      label: l.name,
                      value: Math.max(1, Math.round(((parseFloat(l.current_stock) || 0) / (parseFloat(l.min_stock_level) || 1)) * 100)),
                      color: "#f59e0b",
                    }))}
                    formatValue={(v) => `${v}% of min`}
                  />
                </div>
              </>
            )}
          </Card>
        )}

        <Card>
          <h3 className="mb-4 font-semibold text-fg">Quick actions</h3>
          <div className="mise-stagger grid gap-3">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="mise-raised mise-press rounded-xl p-4"
              >
                <p className="font-medium text-fg">
                  {a.icon} {a.title}
                </p>
                <p className="mt-1 text-sm text-fg-faint">{a.desc}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
