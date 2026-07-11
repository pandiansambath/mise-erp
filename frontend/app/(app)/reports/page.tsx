"use client";

import { useCallback, useEffect, useState } from "react";
import { api, downloadFile, type PnL } from "@/lib/api";
import { Button, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { Bars, Donut, Meter } from "@/components/charts";
import { AnimatedNumber } from "@/components/fx";
import { RangeControls, rangeCaption } from "@/components/RangeControls";
import { localISODate } from "@/lib/date";
import { CURRENCIES, useCurrency } from "@/lib/currency";

const monthStart = () => localISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const today = () => localISODate();

function PnlLine({
  label,
  value,
  sign,
  bold,
  tone,
}: {
  label: string;
  value: string;
  sign?: "minus";
  bold?: boolean;
  tone?: "profit";
}) {
  const { format } = useCurrency();
  const profit =
    tone === "profit" ? (parseFloat(value) >= 0 ? "text-brand-400" : "text-rose-400") : "";
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${bold ? "border-t border-line" : ""}`}
    >
      <span className={bold ? "font-semibold text-fg" : "text-fg-soft"}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${profit}`}>
        {sign === "minus" ? "−" : ""}
        {format(value)}
      </span>
    </div>
  );
}

export default function ReportsPage() {
  const { format, currency } = useCurrency();
  const rate = CURRENCIES[currency].rate;
  const symbol = CURRENCIES[currency].symbol;
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [pnl, setPnl] = useState<PnL | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    try {
      setError(null);
      setPnl(await api.get<PnL>(`/reports/pnl?date_from=${f}&date_to=${t}`));
    } catch {
      setError("Couldn't load the report. Please try again.");
    }
  }, []);

  useEffect(() => {
    load(from, to).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyRange(f: string, t: string) {
    setFrom(f);
    setTo(t);
    setLoading(true);
    load(f, t).finally(() => setLoading(false));
  }

  const num = (v: string) => Math.max(0, parseFloat(v) || 0);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Profit & Loss — did the restaurant make money in a chosen period?" />

      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <RangeControls range={{ from, to }} onChange={(r) => applyRange(r.from, r.to)} />
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => downloadFile(`/reports/pnl.xlsx?date_from=${from}&date_to=${to}`, `mise-pnl-${from}-to-${to}.xlsx`)}
          >
            ⬇ Excel
          </Button>
          <Button
            variant="soft"
            onClick={() => downloadFile(`/reports/pnl.csv?date_from=${from}&date_to=${to}`, `mise-pnl-${from}-to-${to}.csv`)}
          >
            ⬇ CSV
          </Button>
          <Button variant="ghost" onClick={() => window.print()} title="Print this report">
            🖨 Print
          </Button>
        </div>
      </div>
      <p className="mb-6 text-sm text-fg-faint">
        Showing <b className="text-fg-soft">{rangeCaption({ from, to })}</b> — every figure below is the
        total for this period. Pick a quick preset or set exact From/To dates.
      </p>

      {loading ? (
        <Spinner />
      ) : error || !pnl ? (
        <Card>
          <p className="py-6 text-center text-sm text-rose-400">
            {error || "No data for this range."}
          </p>
        </Card>
      ) : (
        <>
          <div className="mise-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Net sales" value={format(pnl.net_sales)} />
            <StatCard label="Net profit" value={format(pnl.net_profit)} accent={parseFloat(pnl.net_profit) >= 0 ? "brand" : "rose"} />
            <StatCard label="Net margin" value={`${pnl.net_margin_pct}%`} accent="brand" />
            <StatCard label="Food cost" value={`${pnl.food_cost_pct}%`} hint="target 25-35%" accent="amber" />
          </div>

          {/* The period as one picture: where every pound went + health gauges */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="mise-feel">
              <h3 className="font-semibold text-fg">Where the money went</h3>
              <p className="text-xs text-fg-faint">of {format(pnl.net_sales)} taken in</p>
              <div className="mt-4">
                <Donut
                  centerLabel="kept"
                  centerValue={format(pnl.net_profit)}
                  formatValue={(v) => format(String(v))}
                  segments={[
                    { label: "Food", value: num(pnl.cost_of_sales), color: "#f43f5e" },
                    { label: "Running costs", value: num(pnl.operating_expenses), color: "#f59e0b" },
                    { label: "Profit kept", value: num(pnl.net_profit), color: "#10b981" },
                  ]}
                />
              </div>
            </Card>

            <Card className="mise-feel lg:col-span-2">
              <h3 className="font-semibold text-fg">Health checks</h3>
              <p className="text-xs text-fg-faint">the two numbers a kitchen lives or dies by</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="mise-well mise-feel rounded-xl p-4">
                  <Meter label="Food cost" value={parseFloat(pnl.food_cost_pct) || 0} target={30} goodBelow />
                  <p className="mt-2 text-[11px] text-fg-faint">Under 30% of sales is healthy for most kitchens.</p>
                </div>
                <div className="mise-well mise-feel rounded-xl p-4">
                  <Meter label="Gross margin" value={parseFloat(pnl.gross_margin_pct) || 0} target={65} goodBelow={false} />
                  <p className="mt-2 text-[11px] text-fg-faint">What&apos;s left after food costs — aim for 65%+.</p>
                </div>
              </div>
              <div className="mise-well mt-4 flex items-center justify-between rounded-xl px-4 py-3">
                <span className="text-sm font-medium text-fg">Net profit this period</span>
                <span className={`text-xl font-bold ${parseFloat(pnl.net_profit) >= 0 ? "text-brand-400" : "text-rose-400"}`}>
                  <AnimatedNumber value={parseFloat(pnl.net_profit) * rate} prefix={symbol} decimals={2} />
                </span>
              </div>
            </Card>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="mise-feel lg:col-span-2">
              <h3 className="mb-2 font-semibold text-fg">Profit &amp; Loss</h3>
              <div className="text-sm">
                <PnlLine label="Gross sales" value={pnl.gross_sales} />
                <PnlLine label="Delivery commission" value={pnl.commission} sign="minus" />
                <PnlLine label="Net sales" value={pnl.net_sales} bold />
                <PnlLine label="Cost of sales (food)" value={pnl.cost_of_sales} sign="minus" />
                <PnlLine label="Gross profit" value={pnl.gross_profit} bold />
                <PnlLine label="Operating expenses" value={pnl.operating_expenses} sign="minus" />
                <PnlLine label="Net profit" value={pnl.net_profit} bold tone="profit" />
              </div>
            </Card>

            <Card className="mise-feel">
              <h3 className="font-semibold text-fg">Expense breakdown</h3>
              {pnl.expense_breakdown.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-faint">No expenses in range.</p>
              ) : (
                <div className="mt-3 space-y-5">
                  {([
                    { key: "VARIABLE", title: "Cost of sales (variable)", total: pnl.cost_of_sales, color: "#f43f5e" },
                    { key: "FIXED", title: "Operating (fixed)", total: pnl.operating_expenses, color: "#f59e0b" },
                  ] as const).map((grp) => {
                    const rows = pnl.expense_breakdown.filter((c) => c.kind === grp.key);
                    if (rows.length === 0) return null;
                    return (
                      <div key={grp.key}>
                        <div className="flex items-center justify-between border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                          <span>{grp.title}</span>
                          <span>{format(grp.total)}</span>
                        </div>
                        <Bars
                          className="mt-3"
                          formatValue={(v) => format(String(v))}
                          items={rows.map((c) => ({
                            label: c.category_name,
                            value: num(c.total),
                            color: grp.color,
                          }))}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
