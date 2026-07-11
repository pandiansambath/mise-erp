"use client";

// The dashboard — the owner's first 10 seconds every morning. Numbers count,
// the week draws itself, money composition is a donut, targets are meters,
// and everything presses like a real surface. Data is 100% live (no fakes):
// KPIs + P&L ranges + a 7-day series assembled from per-day P&L calls.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type DashboardKpis, type PnL } from "@/lib/api";
import { AreaChart, Bars, Donut, Meter, type DonutSegment } from "@/components/charts";
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
      // The 7-day series: one tiny P&L per day → the chart draws the real week.
      jobs.push(
        Promise.all(
          [6, 5, 4, 3, 2, 1, 0].map((n) => {
            const d = ago(n);
            return api
              .get<PnL>(`/reports/pnl?date_from=${iso(d)}&date_to=${iso(d)}`)
              .then((p) => ({
                label: d.toLocaleDateString("en-GB", { weekday: "short" }),
                net: parseFloat(p.net_sales) || 0,
              }));
          }),
        )
          .then(setWeek)
          .catch(() => {}),
      );
    }
    if (seeInventory)
      jobs.push(api.get<LowStock[]>("/inventory/alerts/low-stock").then(setLow).catch(() => {}));
    Promise.all(jobs).finally(() => setLoading(false));
  }, [seeFinance, seeInventory]);

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
          <StatCard
            label="Low stock"
            value={<AnimatedNumber value={kpis.low_stock_count} />}
            accent={kpis.low_stock_count ? "rose" : "brand"}
            hint={kpis.low_stock_count ? "Tap to see & reorder" : "All good"}
            href="/inventory?filter=low"
          />
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
          {donut && curWeek && (
            <Card className="mise-feel">
              <h3 className="font-semibold text-fg">Where this week&apos;s money went</h3>
              <Donut
                segments={donut}
                centerValue={format(curWeek.net_sales)}
                centerLabel="net sales · 7d"
                className="mt-4"
                formatValue={(v) => format(String(v))}
              />
            </Card>
          )}
        </div>
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
