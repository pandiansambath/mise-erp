"use client";

// "How it works" — the in-app guide. Each topic: a plain explanation, the REAL
// formula, a worked example, an interactive "see it live" mini-simulation you can
// play with, and a per-topic "Ask Mise" that opens the Copilot pre-asked.
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { askMise } from "@/lib/copilot";

const f2 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const pct = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(1);
const money = (n: number) => `£${f2(n)}`;

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-brand-200">
      {children}
    </div>
  );
}

function Field({ label, value, onChange, step = 1, prefix }: {
  label: string; value: number; onChange: (n: number) => void; step?: number; prefix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-line-2 bg-transparent focus-within:border-brand-500">
        {prefix && <span className="pl-2.5 text-sm text-fg-faint">{prefix}</span>}
        <input
          type="number" value={value} step={step} inputMode="decimal"
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent px-2.5 py-2 text-sm text-fg outline-none"
        />
      </div>
    </label>
  );
}

function Out({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${accent ? "bg-brand-500/15" : "bg-paper-3/70"}`}>
      <p className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${accent ? "text-brand-300" : "text-fg"}`}>{value}</p>
    </div>
  );
}

// ── Interactive simulations ───────────────────────────────────────────────────
function WeightedAvgSim() {
  const [oldQty, setOldQty] = useState(10);
  const [oldAvg, setOldAvg] = useState(2);
  const [buyQty, setBuyQty] = useState(10);
  const [buyPrice, setBuyPrice] = useState(3);
  const totalQty = oldQty + buyQty;
  const newAvg = totalQty > 0 ? (oldQty * oldAvg + buyQty * buyPrice) / totalQty : 0;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Have (qty)" value={oldQty} onChange={setOldQty} />
        <Field label="At avg cost" value={oldAvg} onChange={setOldAvg} prefix="£" step={0.1} />
        <Field label="Buy (qty)" value={buyQty} onChange={setBuyQty} />
        <Field label="At price" value={buyPrice} onChange={setBuyPrice} prefix="£" step={0.1} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Out label="New stock" value={`${f2(totalQty)} units`} />
        <Out label="New avg cost" value={money(newAvg)} accent />
      </div>
      <p className="mt-2 text-xs text-fg-faint">
        ({f2(oldQty)}×{money(oldAvg)} + {f2(buyQty)}×{money(buyPrice)}) ÷ {f2(totalQty)} = <b className="text-fg-soft">{money(newAvg)}</b>
      </p>
    </div>
  );
}

function MarginSim() {
  const [cost, setCost] = useState(3);
  const [price, setPrice] = useState(9);
  const profit = price - cost;
  const margin = price > 0 ? (profit / price) * 100 : 0;
  const foodCost = price > 0 ? (cost / price) * 100 : 0;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dish cost" value={cost} onChange={setCost} prefix="£" step={0.1} />
        <Field label="Selling price" value={price} onChange={setPrice} prefix="£" step={0.1} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Out label="Profit / plate" value={money(profit)} accent />
        <Out label="Margin" value={`${pct(margin)}%`} />
        <Out label="Food cost" value={`${pct(foodCost)}%`} />
      </div>
    </div>
  );
}

function LabourSim() {
  const [labour, setLabour] = useState(900);
  const [sales, setSales] = useState(4000);
  const p = sales > 0 ? (labour / sales) * 100 : 0;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Labour cost (week)" value={labour} onChange={setLabour} prefix="£" step={10} />
        <Field label="Net sales (week)" value={sales} onChange={setSales} prefix="£" step={50} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Out label="Labour %" value={`${pct(p)}%`} accent />
        <Out label="Rule of thumb" value={p <= 30 ? "healthy ≤30%" : "watch >30%"} />
      </div>
    </div>
  );
}

function PnlSim() {
  const [sales, setSales] = useState(20000);
  const [cogs, setCogs] = useState(6000);
  const [opex, setOpex] = useState(9000);
  const gross = sales - cogs;
  const net = gross - opex;
  const gm = sales > 0 ? (gross / sales) * 100 : 0;
  const nm = sales > 0 ? (net / sales) * 100 : 0;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Net sales" value={sales} onChange={setSales} prefix="£" step={100} />
        <Field label="Cost of sales" value={cogs} onChange={setCogs} prefix="£" step={100} />
        <Field label="Operating exp." value={opex} onChange={setOpex} prefix="£" step={100} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Out label="Gross profit" value={money(gross)} />
        <Out label="Gross margin" value={`${pct(gm)}%`} />
        <Out label="Net profit" value={money(net)} accent={net >= 0} />
        <Out label="Net margin" value={`${pct(nm)}%`} />
      </div>
    </div>
  );
}

// ── Topic card ────────────────────────────────────────────────────────────────
function Topic({ icon, title, tag, ask, sim, children }: {
  icon: string; title: string; tag: string; ask: string;
  sim?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="transition hover:border-brand-500/30">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-xl">{icon}</span>
        <div>
          <h3 className="font-semibold text-fg">{title}</h3>
          <span className="text-[11px] uppercase tracking-wide text-fg-faint">{tag}</span>
        </div>
      </div>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-fg-soft">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {sim && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-300 transition hover:bg-brand-500/20"
          >
            {open ? "▾ Hide live example" : "▸ See it live"}
          </button>
        )}
        <button
          onClick={() => askMise(ask)}
          className="rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-fg-soft transition hover:bg-paper-2"
        >
          ✨ Still unsure? Ask Mise
        </button>
      </div>
      {sim && open && (
        <div className="mise-card-slide mt-3 rounded-xl border border-line bg-paper-2/40 p-4">{sim}</div>
      )}
    </Card>
  );
}

export default function HowItWorksPage() {
  return (
    <div>
      <PageHeader
        title="How it works"
        subtitle="Every number in Mise, in plain English — the real formula, a worked example, and a live demo you can play with. Stuck on anything? tap “Ask Mise”."
      />

      <div className="mise-slide-stagger mt-5 space-y-4">
        <Topic
          icon="📦" title="Inventory — weighted-average cost" tag="Inventory"
          ask="In simple words, how is weighted-average cost calculated in Mise? Give a quick example."
          sim={<WeightedAvgSim />}
        >
          <p>
            When you buy the same item at different prices over time, your stock is a <b>mix</b> — you can&apos;t
            tell which physical unit is from which delivery. So Mise blends them into <b>one average cost,
            weighted by quantity</b>. Every recipe using that item re-prices automatically as new stock arrives.
          </p>
          <Formula>new avg = (old qty × old avg + bought qty × buy price) ÷ (old qty + bought qty)</Formula>
          <p>
            <b>Example:</b> you hold 10 kg at £2.00 and buy 10 kg at £3.00 → (10×2 + 10×3) ÷ 20 = <b>£2.50/kg</b>.
          </p>
        </Topic>

        <Topic
          icon="🏷️" title="Avg cost vs Current buy price" tag="Inventory"
          ask="What's the difference between average cost and current buy price in Mise?"
        >
          <p>
            <b>Avg cost</b> = what your stock <i>on hand</i> cost you (the blend above) — it values what&apos;s on the
            shelf right now. <b>Current buy price</b> = what your chosen supplier charges <i>today</i> — what it costs
            to buy <i>more</i>. They differ when prices move; both are shown on the inventory export.
          </p>
          <p className="text-fg-faint">
            Want the exact price you paid on a specific delivery? Open an item&apos;s <b>purchase history</b> — every
            buy is listed with its date, vendor, quantity and price.
          </p>
        </Topic>

        <Topic
          icon="🍲" title="Recipes — cost, margin & food cost %" tag="Recipes"
          ask="How does Mise work out a dish's cost, margin and food-cost %? Give an example."
          sim={<MarginSim />}
        >
          <p>
            A dish&apos;s cost is the sum of each ingredient&apos;s <b>quantity × price</b> (using your chosen
            supplier&apos;s price, else the average cost). Set a selling price and Mise shows your profit and margins.
          </p>
          <Formula>
            dish cost = Σ(ingredient qty × price) · profit = price − cost<br />
            margin % = profit ÷ price × 100 · food cost % = cost ÷ price × 100
          </Formula>
          <p><b>Example:</b> cost £3.00, price £9.00 → profit £6.00, margin 66.7%, food cost 33.3%.</p>
        </Topic>

        <Topic
          icon="🗓️" title="Rota — labour cost & labour %" tag="Rota"
          ask="How is labour cost and labour % of sales calculated in the rota?"
          sim={<LabourSim />}
        >
          <p>
            Each shift&apos;s cost = <b>hours × hourly rate</b> (a monthly salary is converted to an hourly rate).
            Add them up for the week, then compare to sales to get your <b>labour %</b> — the key staffing number.
          </p>
          <Formula>labour % = total labour cost ÷ net sales × 100</Formula>
          <p><b>Example:</b> £900 labour on £4,000 sales = <b>22.5%</b> (≤30% is generally healthy).</p>
        </Topic>

        <Topic
          icon="📈" title="Reports — Profit &amp; Loss" tag="Reports (P&L)"
          ask="Explain the P&L in Mise — net sales, cost of sales, gross and net profit — with an example."
          sim={<PnlSim />}
        >
          <p>
            The P&amp;L stacks up for any date range: start with <b>net sales</b>, subtract <b>cost of sales</b>
            (food/stock used) to get <b>gross profit</b>, then subtract <b>operating expenses</b> (rent, wages,
            utilities…) to get <b>net profit</b> — what&apos;s actually left.
          </p>
          <Formula>
            gross profit = net sales − cost of sales<br />
            net profit = gross profit − operating expenses
          </Formula>
          <p><b>Example:</b> £20,000 sales − £6,000 cost = £14,000 gross; − £9,000 expenses = <b>£5,000 net</b> (25%).</p>
        </Topic>

        <Topic
          icon="🧭" title="Sales &amp; Cash vs Expenses vs Money" tag="Where things live"
          ask="What's the difference between the Sales & Cash, Expenses, and Money sections in Mise?"
        >
          <p><b>Sales &amp; Cash</b> — money coming <b>in</b>: daily takings by channel (dine-in, delivery apps…), card vs cash, and the end-of-day cash count.</p>
          <p><b>Expenses</b> — money going <b>out</b>: bills and purchases by category (rent, gas, packaging…), fixed vs variable, plus petty cash.</p>
          <p><b>Money</b> — the <b>big picture</b>: it pulls sales and expenses together into your cash/profit story so you see the whole flow at a glance. Sales &amp; Expenses are where you <i>enter</i> detail; Money is where you <i>read</i> the result.</p>
        </Topic>

        <Topic
          icon="🛒" title="Purchasing — indents &amp; deliveries" tag="Purchasing"
          ask="How does purchasing work in Mise — indents, ordering and receiving stock?"
        >
          <p>
            Raise an <b>indent</b> (a shopping list) for a supplier, send/record the order, and when it arrives
            mark it <b>received</b>. Receiving adds the stock <b>in</b> at the price paid — which is what updates the
            item&apos;s weighted-average cost and its purchase history.
          </p>
        </Topic>
      </div>

      <Card className="mt-5 border-brand-500/20 bg-brand-500/5">
        <p className="text-sm text-fg-soft">
          Still can&apos;t find what you need? Open <b className="text-brand-300">Ask Mise</b> (bottom-right on any
          page) and ask in your own words — it knows your live numbers and this whole guide.
        </p>
      </Card>
    </div>
  );
}
