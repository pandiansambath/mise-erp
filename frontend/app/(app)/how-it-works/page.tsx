"use client";

// "How it works" — the in-app guide. Each topic: a plain explanation, the REAL
// formula, a worked example, an interactive "see it live" mini-simulation you can
// play with, and a per-topic "Ask Mise" that opens the Copilot pre-asked.
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { askMise } from "@/lib/copilot";
import ChefMascot from "@/components/auth/ChefMascot";

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
      <div className="mise-well mt-1 flex items-center rounded-lg">
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

function PaySim() {
  const [hours, setHours] = useState(38);
  const [rate, setRate] = useState(12);
  const [advance, setAdvance] = useState(50);
  const gross = hours * rate;
  const net = gross - advance;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Hours worked" value={hours} onChange={setHours} step={0.5} />
        <Field label="Hourly rate" value={rate} onChange={setRate} prefix="£" step={0.5} />
        <Field label="Advance due" value={advance} onChange={setAdvance} prefix="£" step={10} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Out label="Gross pay" value={money(gross)} />
        <Out label="Net pay" value={money(net)} accent />
      </div>
    </div>
  );
}

function HoursSim() {
  const [inH, setInH] = useState(11);
  const [outH, setOutH] = useState(23.5);
  const [brk, setBrk] = useState(0);
  let span = outH - inH;
  if (span <= 0) span += 24; // clocked out past midnight
  const mins = Math.max(0, Math.round(span * 60) - brk);
  const hhmm = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Clock in (24h)" value={inH} onChange={setInH} step={0.5} />
        <Field label="Clock out (24h)" value={outH} onChange={setOutH} step={0.5} />
        <Field label="Break (min)" value={brk} onChange={setBrk} step={15} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Out label="Hours worked" value={hhmm} accent />
        <Out label="Overnight?" value={outH <= inH ? "yes — rolls past midnight" : "no"} />
      </div>
      <p className="mt-2 text-xs text-fg-faint">
        Enter 23.5 for 23:30. Breaks are always subtracted — the Attendance page shows exactly this maths.
      </p>
    </div>
  );
}

function BreakEvenSim() {
  const [fixed, setFixed] = useState(9000);
  const [cm, setCm] = useState(70);
  const be = cm > 0 ? fixed / (cm / 100) : 0;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fixed costs (month)" value={fixed} onChange={setFixed} prefix="£" step={100} />
        <Field label="Contribution margin %" value={cm} onChange={setCm} step={1} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Out label="Break-even sales" value={money(be)} accent />
        <Out label="≈ per day (30d)" value={money(be / 30)} />
      </div>
    </div>
  );
}

function StockTakeSim() {
  const [system, setSystem] = useState(24);
  const [counted, setCounted] = useState(22);
  const [cost, setCost] = useState(2.5);
  const diff = counted - system;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="System says (kg)" value={system} onChange={setSystem} step={0.5} />
        <Field label="You counted (kg)" value={counted} onChange={setCounted} step={0.5} />
        <Field label="Avg cost" value={cost} onChange={setCost} prefix="£" step={0.1} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Out label="Variance" value={`${f2(diff)} kg`} />
        <Out label="Money impact" value={money(diff * cost)} accent={diff >= 0} />
      </div>
      <p className="mt-2 text-xs text-fg-faint">
        Negative = stock missing vs the books (waste, over-portioning, un-logged use). Applying the count corrects the system.
      </p>
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
function Topic({ icon, title, tag, ask, sim, q = "", keywords = "", children }: {
  icon: string; title: string; tag: string; ask: string;
  sim?: React.ReactNode; children: React.ReactNode;
  /** live search text from the hub header */
  q?: string;
  /** extra words the search should match ("wages salary pay") */
  keywords?: string;
}) {
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  if (needle && !`${title} ${tag} ${keywords}`.toLowerCase().includes(needle)) return null;
  return (
    <Card className="mise-feel transition hover:border-brand-500/30">
      <div className="flex items-center gap-3">
        <span className="mise-well flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl">{icon}</span>
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
            className="mise-press rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-300 transition hover:bg-brand-500/20"
          >
            {open ? "▾ Hide live example" : "▸ See it live"}
          </button>
        )}
        <button
          onClick={() => askMise(ask)}
          className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft"
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
  const [q, setQ] = useState("");
  return (
    <div>
      <PageHeader
        title="How it works"
        subtitle="Every number in Mise, in plain English — the real formula, a worked example, and a live demo you can play with. Stuck on anything? tap “Ask Mise”."
      />

      <div className="mt-5 flex items-center gap-4">
        <div className="w-20 shrink-0 sm:w-24">
          <ChefMascot mood="books" />
        </div>
        <div className="mise-well flex max-w-md flex-1 items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <span aria-hidden className="text-fg-faint">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a topic… (payroll, margin, break-even, waste…)"
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
      </div>

      <div className="mise-slide-stagger mt-5 space-y-4">
        <Topic
          q={q} keywords="stock average price blend cost"
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
          q={q} keywords="supplier vendor price today shelf"
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
          q={q} keywords="dish gp gross profit plate selling"
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
          q={q} keywords="staffing shifts wages schedule"
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
          q={q} keywords="pnl net gross revenue bottom line"
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
          q={q} keywords="difference sections takings spend"
          icon="🧭" title="Sales &amp; Cash vs Expenses vs Money" tag="Where things live"
          ask="What's the difference between the Sales & Cash, Expenses, and Money sections in Mise?"
        >
          <p><b>Sales &amp; Cash</b> — money coming <b>in</b>: daily takings by channel (dine-in, delivery apps…), card vs cash, and the end-of-day cash count.</p>
          <p><b>Expenses</b> — money going <b>out</b>: bills and purchases by category (rent, gas, packaging…), fixed vs variable, plus petty cash.</p>
          <p><b>Money</b> — the <b>big picture</b>: it pulls sales and expenses together into your cash/profit story so you see the whole flow at a glance. Sales &amp; Expenses are where you <i>enter</i> detail; Money is where you <i>read</i> the result.</p>
        </Topic>

        <Topic
          q={q} keywords="order po receive supplier delivery"
          icon="🛒" title="Purchasing — indents &amp; deliveries" tag="Purchasing"
          ask="How does purchasing work in Mise — indents, ordering and receiving stock?"
        >
          <p>
            Raise an <b>indent</b> (a shopping list) for a supplier, send/record the order, and when it arrives
            mark it <b>received</b>. Receiving adds the stock <b>in</b> at the price paid — which is what updates the
            item&apos;s weighted-average cost and its purchase history.
          </p>
        </Topic>

        <Topic
          q={q} keywords="wages salary pay run weekly monthly advance payslip"
          icon="💷" title="Payroll — monthly &amp; weekly runs" tag="Payroll"
          ask="How does payroll work in Mise — monthly vs weekly runs, hourly vs salaried, and advances?"
          sim={<PaySim />}
        >
          <p>
            <b>Hourly staff:</b> pay = attendance hours × their rate. <b>Salaried staff:</b> daily rate = monthly
            salary ÷ your <i>working days</i>, × days present. Any <b>advance</b> you gave is recovered from the run&apos;s Net.
          </p>
          <p>
            <b>Weekly-paid people?</b> Switch the cadence to <b>Weekly</b>, pick the Monday–Sunday week and run — it
            pays hourly staff for that week&apos;s attendance only, and picks up advances scheduled for the month the
            week ends in. Salaried colleagues stay on the monthly run.
          </p>
          <Formula>net pay = gross − advances due − other deductions</Formula>
        </Topic>

        <Topic
          q={q} keywords="clock in out break overnight hours punch 12h 30m"
          icon="⏱️" title="Attendance — how hours are counted" tag="Attendance"
          ask="How does Mise calculate attendance hours, including breaks and overnight shifts?"
          sim={<HoursSim />}
        >
          <p>
            Hours = <b>clock-out − clock-in − breaks</b>. Breaks are <i>always</i> subtracted and always shown in the
            Break column. If someone clocks out <b>after midnight</b> (18:00 → 01:30), the maths rolls into the next
            day — a night shift is never counted as zero.
          </p>
          <Formula>hours = (out − in, rolling past midnight) − break minutes</Formula>
          <p><b>Example:</b> in 11:00, out 23:30, 120m break → 12h 30m − 2h = <b>10h 30m</b>. The Edit dialog shows this exact line as you type.</p>
        </Topic>

        <Topic
          q={q} keywords="cover costs fixed contribution minimum sales"
          icon="⚖️" title="Break-even — the sales you must hit" tag="Money"
          ask="What is break-even and how does Mise calculate my break-even sales?"
          sim={<BreakEvenSim />}
        >
          <p>
            Your fixed bills (rent, salaries, internet…) arrive whether you sell or not. Every pound of sales keeps
            its <b>contribution margin</b> (what&apos;s left after food cost). Break-even = the sales where contributions
            exactly cover the fixed bills — after that, you&apos;re into profit.
          </p>
          <Formula>break-even sales = fixed costs ÷ contribution margin %</Formula>
          <p><b>Example:</b> £9,000 fixed ÷ 70% = <b>£12,857</b> — about £429/day in a 30-day month.</p>
        </Topic>

        <Topic
          q={q} keywords="bin spoiled leak spillage over-prep double count"
          icon="🗑️" title="Waste — a leak, not a second cost" tag="Money"
          ask="How does waste logging work in Mise and why isn't it subtracted from profit twice?"
        >
          <p>
            Logging waste removes the stock and shows the <b>£ value you binned</b>. It is <i>not</i> subtracted from
            profit again — the money already left when you <b>bought</b> the stock, so counting it twice would
            understate your profit. It&apos;s shown so you can see and cut the leak.
          </p>
          <p className="text-fg-faint">The Waste page&apos;s charts show <b>why</b> it&apos;s binned and <b>which items</b> leak most — attack the biggest slice first.</p>
        </Topic>

        <Topic
          q={q} keywords="stars dogs plowhorse puzzle popularity menu promote cut"
          icon="⭐" title="Menu engineering — stars &amp; dogs" tag="Money"
          ask="Explain menu engineering in Mise — stars, plowhorses, puzzles and dogs."
        >
          <p>
            Record <b>dishes sold</b> and Mise crosses each dish&apos;s <b>popularity</b> with its <b>margin</b>:
            ⭐ <b>Stars</b> (popular + high margin — promote them), 🐎 <b>Plowhorses</b> (popular, thin margin — re-price
            or re-cost), 🧩 <b>Puzzles</b> (great margin, few sales — reposition on the menu), 🐕 <b>Dogs</b> (neither — cut).
          </p>
        </Topic>

        <Topic
          q={q} keywords="count variance missing shrinkage correct system"
          icon="📋" title="Stock-take — counted vs system" tag="Inventory"
          ask="How does a stock-take work in Mise and what does the variance mean?"
          sim={<StockTakeSim />}
        >
          <p>
            The system tracks what <i>should</i> be on the shelf (purchases in, recipes/waste out). A <b>stock-take</b> is
            you counting what&apos;s <i>actually</i> there. The gap × avg cost = the <b>money impact</b> — missing stock is
            usually un-logged waste, over-portioning or theft. Applying the count corrects the system.
          </p>
          <Formula>variance = counted − system · money impact = variance × avg cost</Formula>
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
