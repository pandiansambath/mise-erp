"use client";

/** The pieces the money page is built from.
 *
 *  Local to this page on purpose. `Bars` and `Segmented` are used by four other
 *  screens and neither can do what this one needs — `Bars` has no `$` and keys
 *  colour off position, `Segmented` takes `{value,label}` and has no room for a
 *  second line. Bending either would change pages nobody asked me to change.
 */

import { useEffect, useState, type ReactNode } from "react";

import { api, ApiError } from "@/lib/api";

import { describeLine, POOL_STYLE } from "./lines";

export function usd(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const neg = v < 0;
  return `${neg ? "−" : ""}$${Math.abs(v).toFixed(dp)}`;
}

/** ONE LINE OF THE BILL.
 *
 *  Plain English first, the AWS key under it, the money right-aligned, and the
 *  magnitude as a BACKGROUND on the row rather than a separate track. The old
 *  full-width grey track made every line look like progress toward a target;
 *  there is no target, there is just how big this line is next to the biggest.
 */
export function LineRow({
  service,
  usageType,
  amount,
  share,
  pool,
  onClick,
}: {
  service: string;
  usageType: string;
  amount: number;
  /** 0–1 of the largest line, for the fill width. */
  share: number;
  pool: string;
  onClick?: () => void;
}) {
  const info = describeLine(service, usageType);
  const style = POOL_STYLE[pool] ?? POOL_STYLE.unclassified;

  return (
    <button
      type="button"
      onClick={onClick}
      className="mise-press relative block w-full min-w-0 overflow-hidden rounded-xl px-3 py-2 text-left"
    >
      {/* The magnitude, behind the words. Low opacity so the text stays the
          thing you read and the size is something you feel. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-xl opacity-[0.18] transition-[width] duration-300"
        /* CAPPED AT 88%, NOT 100%. At full width the largest line's fill
           reaches both edges and stops reading as a bar at all — it reads as a
           SELECTED ROW, which is a different thing and an actively misleading
           one in a list you can click. Leaving a visible gutter on the right
           keeps it a measurement. */
        style={{
          width: `${Math.max(2, Math.min(88, share * 88))}%`,
          background: style.fill,
        }}
      />
      <span className="relative flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
          {info.label}
          {!info.known && (
            /* NOT a colour on a footnote — a tag in position. An unnamed line
               keeps its rank by AMOUNT, so a $12 one lands at the top at full
               size and a $0.00 one lands at the bottom. */
            <span className="ml-2 rounded px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-500">
              new
            </span>
          )}
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-fg">
          {usd(amount)}
        </span>
      </span>
      <span className="relative mt-0.5 flex min-w-0 items-center gap-2">
        {/* THE AWS KEY IS THE FIELD THAT TELLS TWO ROWS APART — three RDS lines
            differ only here — so it must shrink rather than push the row wide.
            Without `min-w-0` on the flex parents a long key sets a min-content
            width of 524px inside a 348px phone column, and `overflow-x: clip`
            on the body then swallows the overflow silently: every price on the
            card is off-screen and unreachable, and the responsive sweep reports
            the page as fine because nothing scrolls sideways. */}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-faint">
          {info.key}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${style.chip}`}>
          {style.label}
        </span>
      </span>
    </button>
  );
}

export type MonthTotal = {
  month: string;
  from: string | null;
  to: string | null;
  gross_usd: number;
  net_usd: number;
  is_partial: boolean;
};

const MONTH_NAME = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function labelFor(m: MonthTotal): string {
  const [y, mm] = m.month.split("-");
  const name = MONTH_NAME[Number(mm) - 1] ?? m.month;
  const thisYear = String(new Date().getUTCFullYear()) === y;
  return thisYear ? name : `${name} ${y.slice(2)}`;
}

/** One month chip.
 *
 *  DECLARED AT MODULE SCOPE, not inside `PeriodTabs`. A component defined
 *  during render is a NEW component type on every render, so React unmounts and
 *  remounts the whole strip each time — losing focus, restarting transitions,
 *  and throwing away any state it held. `tsc` and `next build` both accept it
 *  happily; only `npm run lint` catches it, which is the fourth time that has
 *  been true in this project.
 */
function MonthChip({
  id,
  top,
  bottom,
  hint,
  selected,
  onPick,
}: {
  id: string;
  top: string;
  bottom: ReactNode;
  hint?: string;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={selected}
      title={hint}
      className={`mise-press min-w-[5.5rem] shrink-0 rounded-xl px-3 py-1.5 text-left transition ${
        selected ? "bg-brand-600 text-white" : "mise-well text-fg-soft hover:text-fg"
      }`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {top}
      </span>
      <span className="block font-mono text-sm font-bold tabular-nums">{bottom}</span>
    </button>
  );
}

/** THE PERIOD CONTROL, WHICH IS ALSO THE HISTORY.
 *
 *      "when i click this 90 days window..the amount is not chaing..i thouhgt
 *       it wil show 60 dollars"
 *      "here please show histotical datas too"
 *
 *  Both are one problem. A window selector that does not move the number it
 *  sits under is broken whatever it is labelled, and history shown nowhere is
 *  the same data withheld. So the selector stops being an abstract window and
 *  becomes a row of MONTHS, each carrying its own total, acting as the label of
 *  the big number. A control that IS the label of a figure cannot be dead.
 *
 *  "A bill is a month" survives intact: every chip but the last is a calendar
 *  month. The last is "All N months" with the exact total — which is the ~$60
 *  he was looking for, and it is $68.26.
 */
export function PeriodTabs({
  months,
  value,
  onChange,
}: {
  months: MonthTotal[];
  /** A month string, or "all". */
  value: string;
  onChange: (next: string) => void;
}) {
  // Newest last reads like a timeline. Past five, keep the recent ones — the
  // rest stay reachable in the every-month popup rather than wrapping to a
  // second row and pushing the hero down the page.
  const shown = months.slice(-5);
  const allGross = months.reduce((a, m) => a + (m.gross_usd || 0), 0);

  return (
    <div className="mise-noscrollbar flex gap-1.5 overflow-x-auto">
      {shown.map((m) => (
        <MonthChip
          key={m.month}
          id={m.month}
          selected={value === m.month}
          onPick={onChange}
          top={m.is_partial ? `${labelFor(m)} · so far` : labelFor(m)}
          bottom={usd(m.gross_usd)}
          hint={m.is_partial ? "This month is not finished, so it is still rising." : undefined}
        />
      ))}
      {months.length > 1 && (
        <MonthChip
          id="all"
          selected={value === "all"}
          onPick={onChange}
          top={`All ${months.length} months`}
          bottom={usd(allGross)}
          hint="Everything AWS has told us about, from the first day we have a bill for."
        />
      )}
    </div>
  );
}

/** THE BILL, AS THE HANDFUL OF LINES IT ACTUALLY IS.
 *
 *  The measured shape of this account: 73 lines, of which SEVEN are 99.94% of
 *  the money and sixty are worth about a penny between them. The old chart drew
 *  the top ten by position-coloured bar, three of them labelled identically
 *  ("Amazon Relational ...", because the label was the SERVICE and truncated),
 *  and no `$` on any figure.
 *
 *  Bedrock is summed across its token lines rather than listed four times: they
 *  are one decision — which model — split into input, output, cache-read and
 *  cache-write by AWS's own accounting, and four small rows push a real line
 *  off the list.
 */
export function BillLines({
  rows,
  top = 7,
  onPick,
}: {
  rows: { service: string; usage_type: string; amount_usd: number; pool: string }[];
  top?: number;
  /** The WHOLE row, not just its identity. The detail sheet shows the amount
   *  and the pool, and re-deriving those from the id would mean two places
   *  computing the same figure — which is how they end up disagreeing. */
  onPick?: (r: {
    service: string;
    usage_type: string;
    amount_usd: number;
    pool: string;
  }) => void;
}) {
  const merged = new Map<
    string,
    { service: string; usage_type: string; amount_usd: number; pool: string }
  >();
  for (const r of rows) {
    const bedrock = r.service.toLowerCase().includes("bedrock");
    const key = bedrock ? "__bedrock__" : `${r.service}|${r.usage_type}`;
    const cur = merged.get(key);
    if (cur) {
      cur.amount_usd += r.amount_usd;
    } else {
      merged.set(key, {
        service: bedrock ? r.service : r.service,
        usage_type: bedrock ? "all token types" : r.usage_type,
        amount_usd: r.amount_usd,
        pool: r.pool,
      });
    }
  }

  const all = [...merged.values()].sort((a, b) => b.amount_usd - a.amount_usd);
  if (!all.length) return null;

  const head = all.slice(0, top);
  const tail = all.slice(top);
  const tailSum = tail.reduce((a, r) => a + r.amount_usd, 0);
  const biggest = Math.max(...head.map((r) => Math.abs(r.amount_usd)), 0.0001);

  return (
    <div className="mt-2 space-y-0.5">
      {head.map((r) => (
        <LineRow
          key={`${r.service}|${r.usage_type}`}
          service={r.service}
          usageType={r.usage_type}
          amount={r.amount_usd}
          share={Math.abs(r.amount_usd) / biggest}
          pool={r.pool}
          onClick={onPick ? () => onPick(r) : undefined}
        />
      ))}
      {tail.length > 0 && (
        /* Never hidden, never a scrollbar. One row that says exactly how much
           is not on screen, so "the rest" is a number rather than a mystery. */
        <p className="px-3 pt-1.5 text-[11px] text-fg-faint">
          The other {tail.length} line{tail.length === 1 ? "" : "s"} come to{" "}
          <b className="font-mono tabular-nums text-fg-soft">{usd(tailSum)}</b> between them.
        </p>
      )}
    </div>
  );
}

/** The two credit figures a person has to supply, and why each one is here.
 *
 *      "please have a manual enter field for remaining credits if u cant able
 *       to fetch the exact crdits in our aws"
 *
 *  BALANCE — normally read live from `freetier:GetAccountPlanState`, free and
 *  current. He asked for the manual field anyway and he is right to: an API
 *  that answers today can stop answering tomorrow, and this is the number the
 *  runway is computed from. When the live read works, the typed value is shown
 *  as the fallback it is and does not override it.
 *
 *  EXPIRY — there is NO API for this. AWS publishes what is left and not the
 *  day it dies. So it is hand-entered, always, and chipped as hand-entered so
 *  the live balance beside it cannot lend it credibility it has not got.
 *
 *  Closed by default: this is a settings control on a reading page, and it is
 *  touched about twice a year.
 */
export function CreditFields({
  credits,
  onSaved,
}: {
  credits: Record<string, unknown> | undefined;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const live = credits?.kind === "live";
  const storedExpiry = (credits?.expiry_on as string) || "";
  const storedBalance = credits?.balance_usd;

  useEffect(() => {
    if (!open) return;
    setExpiry(storedExpiry);
    setBalance(storedBalance == null ? "" : String(storedBalance));
  }, [open, storedExpiry, storedBalance]);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const body: Record<string, unknown> = {};
      if (balance.trim() !== "") body.balance_usd = Number(balance);
      if (expiry) body.expiry_on = expiry;
      if (!Object.keys(body).length) {
        setNote("Nothing to save.");
        return;
      }
      await api.patch("/platform/costs/credits", body);
      setNote("Saved.");
      onSaved();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-1">
      {/* NEVER BLANK. An expiry we do not have is a prompt to set one, not an
          empty space that reads as "no expiry". */}
      <p className="text-[11px] text-fg-faint">
        {storedExpiry ? (
          <>
            Credits expire <b className="text-fg-soft">{storedExpiry}</b>{" "}
            <span className="opacity-70">· entered by hand</span>
          </>
        ) : (
          <>Expiry date — not set yet</>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mise-press ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-400"
        >
          {open ? "Close" : storedExpiry ? "Change" : "Set it"}
        </button>
      </p>

      {open && (
        <div className="mise-well mt-2 space-y-2 rounded-xl p-2.5">
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              Credit remaining (USD)
            </span>
            <input
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              inputMode="decimal"
              placeholder={live ? "read live from AWS — this is the fallback" : "e.g. 91.40"}
              className="mise-card-inset mt-1 w-full rounded-lg bg-transparent px-2.5 py-1.5 text-sm text-fg outline-none placeholder:text-fg-faint"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              Credits expire on
            </span>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="mise-card-inset mt-1 w-full rounded-lg bg-transparent px-2.5 py-1.5 text-sm text-fg outline-none"
            />
            <span className="mt-0.5 block text-[10px] text-fg-faint">
              AWS has no API for this date — it can only be typed in.
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {note && <span className="text-[11px] text-fg-faint">{note}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
