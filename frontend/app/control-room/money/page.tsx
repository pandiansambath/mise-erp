"use client";

// /control-room/money — what the AWS bill will be, and who caused it.
//
//     "litrelly when i eneter i need ot know 'oh ths is the amount' fine...
//      ALSO SHOW HOTEL WISE TOO..WHO COST HOW MUHC N WHY WITH PROOFs"
//
// THE HERO IS NOT A `TotalsStrip`. Four equal cells is precisely what makes
// $2.25 read like 859ms on the AI page — the number he wants is the same size
// as a latency figure. This band is asymmetric on purpose: one 60px figure and
// nothing else competing with it.
//
// AND THE $60 THAT STARTED THIS WAS A FORECAST, NOT A BILL. AWS predicted
// $61.79 against a ~$30 run rate. That sentence sits behind the forecast
// figure, because the whole reason this page exists is that a forecast arrived
// by email looking like a bill.

import { useEffect, useMemo, useState } from "react";

import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { api, ApiError } from "@/lib/api";
import { n, usd } from "@/components/controlroom/format";
import { Source, type SourceKind } from "@/components/controlroom/Source";
import { Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { BillLines, CreditFields, PeriodTabs, usd as money2, type MonthTotal } from "./parts";

type Env<T> = { value: T; kind: SourceKind; source?: string; stale_seconds?: number } & Record<
  string,
  unknown
>;

type Summary = {
  window: { from: string; to: string; days: number };
  month: { from: string; to: string };
  billed: {
    available: boolean;
    reason?: string;
    gross_usd: number | null;
    credits_usd: number | null;
    net_usd: number | null;
    by_service: { service: string; usage_type: string; amount_usd: number; pool: string }[];
    pools: Record<string, number>;
    unclassified?: { service: string; usage_type: string; amount_usd: number }[];
    as_of: string | null;
  };
  measured: {
    totals: Record<string, number>;
    counters_flushed_seconds_ago: number | null;
    caveat: string;
  };
  unit_economics: Record<string, { value: number | null; definition: string } | number>;
  credits: Record<string, unknown>;
  collectors: Record<string, { ok: boolean; api_cost_usd: number; error?: string } | null>;
  months?: MonthTotal[];
  measured_first_day?: string | null;
  refresh?: {
    calls_this_month: number;
    ceiling: number;
    spent_usd: number;
    cooling_down: boolean;
    next_allowed: string | null;
    at_ceiling: boolean;
  };
};

type HotelRow = {
  hotel_id: string;
  name: string;
  requests: number;
  db_selects: number;
  db_writes: number;
  ai_calls: number;
  ai_usd: Env<number | null>;
  shared_usd: Env<number | null>;
};

type Hotels = {
  rows: HotelRow[];
  model: Record<string, unknown>;
  reconciliation: { aws_bedrock_usd: number | null; our_ledger_usd: number; k: number | null; note: string };
  billed_available: boolean;
};

/** The sentinel used for traffic belonging to no restaurant. */
const ANON_ID = "00000000-0000-0000-0000-000000000000";

const WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/** A figure we do not have renders as an em dash at full size, never $0.00.
 *  Zero is a lie that reads as good news, and on a page about money that is
 *  the single most dangerous thing it could do. */
function money(v: number | null | undefined): string {
  return v == null ? "—" : usd(v);
}

export default function MoneyPage() {
  const [days, setDays] = useState("30");
  /** Which month the WHOLE page is about. "all" spans everything we hold.
   *  Empty until the first payload names a month — picking a default before we
   *  know what exists would request a period that may not exist. */
  const [period, setPeriod] = useState<string>("");

  /** The month list, HELD IN STATE rather than read straight off the response.
   *
   *  It has to be, and the reason is worth stating: the months come FROM the
   *  payload, but they also decide which payload to ask for. Reading them off
   *  `s.data` would mean the strip vanished on every reload — each fetch would
   *  blank the list that chose the fetch, and the selected month with it.
   *  Keeping the last known list means the strip stays put and stays pressable
   *  while the numbers behind it refresh. */
  const [periodMonths, setPeriodMonths] = useState<MonthTotal[]>([]);

  // Already fetched by the Control Room layout for the rail's hotel count, so
  // this costs nothing and carries `admin_email` for every restaurant.
  const fleet = useFleet();
  // Frozen at mount, then ticked. Reading the clock DURING render is impure —
  // lint catches it, and the reason it matters is that two renders in the same
  // second would disagree about how stale a figure is.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // ONE PERIOD DRIVES BOTH HALVES. They used to disagree: `measured` followed
  // `?days=` while `billed` was pinned to the calendar month, so the two halves
  // of this page described different spans of time and nothing said so.
  const range = useMemo(() => {
    const ms = periodMonths;
    if (!period || !ms.length) return null;
    if (period === "all") {
      const first = ms[0], last = ms[ms.length - 1];
      return first?.from && last?.to ? { from: first.from, to: last.to } : null;
    }
    const m = ms.find((x) => x.month === period);
    return m?.from && m?.to ? { from: m.from, to: m.to } : null;
  }, [period, periodMonths]);

  const qs = range ? `from=${range.from}&to=${range.to}` : `days=${days}`;
  const s = useOperatorQuery<Summary>(`/platform/costs/summary?${qs}`);
  const h = useOperatorQuery<Hotels>(`/platform/costs/hotels?${qs}`);

  const d = s.data;
  const billed = d?.billed;

  // Adopt the month list, and land on the newest month the first time we learn
  // what months exist. Not in render: setting state during render is the bug
  // lint catches here, and two renders in one second would disagree.
  useEffect(() => {
    const ms = d?.months;
    if (!ms?.length) return;
    setPeriodMonths(ms);
    setPeriod((cur) => cur || ms[ms.length - 1].month);
  }, [d?.months]);
  const services = useMemo(
    () =>
      (billed?.by_service ?? []).slice(0, 10).map((r) => ({
        label: r.service.replace(/ \(Amazon Bedrock Edition\)/, " (Bedrock)"),
        value: r.amount_usd,
      })),
    [billed],
  );

  const flushed = d?.measured?.counters_flushed_seconds_ago ?? null;

  /** The lines we have no rule for — ranked by MONEY, not by count.
   *
   *  "whats that ec2other ec2 other" — thirteen rows, all reading the identical
   *  words, all painted amber. Every one of them is inbound data transfer from
   *  a different AWS region, and every one is worth $0.0000. The page was
   *  spending its only alarm colour on nothing, thirteen times over, which is
   *  how an alarm stops meaning anything.
   *
   *  So the sentence tells the truth about the MONEY, and it only turns amber
   *  when unnamed lines are actually worth something — past a dollar, or 5% of
   *  the period. A permanent warning is not a warning. */
  /** EVERY RESTAURANT THAT EXISTS, not every restaurant that made a request.
   *
   *      "why only 1 hotel 'nirai' is shwowing? what abt other hotels?
   *       plsea list all the hotel wiht thier email id too"
   *
   *  The table was built by iterating `usage_daily`, so a restaurant with no
   *  traffic had no row and vanished from a page whose whole job is "who cost
   *  how much and why". An ABSENT row and a ZERO row mean different things, and
   *  only one of them is an answer: NIRAI Madras Kitchen and NIRAI.Reading cost
   *  nothing this month, and that is a fact worth showing, not an omission.
   *
   *  Left-joined onto the fleet, which the Control Room layout already has
   *  mounted and which already carries `admin_email` — so the email he asked
   *  for needed no backend work at all.
   *
   *  Silent restaurants render `—`, never `0`: we did not measure zero requests,
   *  we measured nothing. And the anonymous sentinel is kept and named, because
   *  it is 72% of all traffic and dropping it would make the column stop adding
   *  up. */
  const tableRows = useMemo(() => {
    const costRows = h.data?.rows ?? [];
    const byId = new Map(costRows.map((r) => [r.hotel_id, r]));
    const out: {
      hotel_id: string;
      name: string;
      email: string | null;
      requests: number;
      ai_calls: number;
      ai_usd: number | null;
      shared_usd: number | null;
      silent: boolean;
    }[] = [];

    for (const ht of fleet.hotels) {
      const r = byId.get(ht.id);
      byId.delete(ht.id);
      out.push({
        hotel_id: ht.id,
        name: ht.name,
        email: ht.admin_email,
        requests: r?.requests ?? 0,
        ai_calls: r?.ai_calls ?? 0,
        ai_usd: r ? r.ai_usd.value : null,
        shared_usd: r ? r.shared_usd.value : null,
        silent: !r || (r.requests ?? 0) === 0,
      });
    }

    // Anything left is not a restaurant we know — the anonymous sentinel, or a
    // hotel deleted since the usage was recorded. Both must stay visible.
    for (const r of byId.values()) {
      out.push({
        hotel_id: r.hotel_id,
        name: r.name,
        email: null,
        requests: r.requests,
        ai_calls: r.ai_calls,
        ai_usd: r.ai_usd.value,
        shared_usd: r.shared_usd.value,
        silent: false,
      });
    }

    // Biggest spender first; the silent ones settle at the bottom on their own.
    return out.sort((a, b) => (b.requests ?? 0) - (a.requests ?? 0));
  }, [h.data, fleet.hotels]);

  /** Was anything even WATCHING during the period on screen?
   *
   *  Our counters start long after AWS's billing does — `measured_first_day` is
   *  currently TODAY, while the bill goes back to July. So selecting July shows
   *  a real AWS figure beside a measured figure of zero, and "0 requests in
   *  July" is not something we know: it is an invention, and it is the exact
   *  failure this page's own docstring was written to prevent.
   *
   *  Where the period predates the counters, every measured figure becomes a
   *  dash with the reason attached. A dash is not worse than a number here —
   *  it is the only honest one available. */
  const measuredGap = useMemo(() => {
    const first = d?.measured_first_day;
    if (!first || !range) return null;
    if (range.to >= first) return null;
    return first;
  }, [d?.measured_first_day, range]);

  /** What the big number is OF, in words, keyed off the same state as the
   *  number itself so the two cannot drift apart again. */
  const periodLabel = useMemo(() => {
    if (!period || !periodMonths.length) return "This month so far";
    if (period === "all") return `All ${periodMonths.length} months`;
    const m = periodMonths.find((x) => x.month === period);
    if (!m) return "Selected period";
    const name = new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return m.is_partial ? `${name} so far` : name;
  }, [period, periodMonths]);

  const unnamed = useMemo(() => {
    const rows = billed?.unclassified ?? [];
    const total = rows.reduce((a, r) => a + Math.abs(r.amount_usd || 0), 0);
    const gross = Math.abs(billed?.gross_usd ?? 0);
    const biggest = [...rows].sort(
      (a, b) => Math.abs(b.amount_usd) - Math.abs(a.amount_usd),
    )[0];
    return {
      n: rows.length,
      usd: total,
      allFree: rows.length > 0 && total < 0.005,
      loud: total >= 1 || (gross > 0 && total / gross >= 0.05),
      top: biggest ? `${biggest.usage_type || biggest.service}` : "",
    };
  }, [billed]);

  /** How long the credit lasts at the rate we are actually burning it.
   *
   *  Projected from THIS MONTH'S consumption rather than from a 7- or 30-day
   *  window, because the window selector above does not move the bill and this
   *  figure must not appear to change when he presses "7 days".
   *
   *  Gross, not net. Net is $0.00 every month — the credits cancel the usage
   *  exactly — and dividing a balance by a net of zero is both an infinity and
   *  a lie. What eats the credit is the GROSS usage.
   *
   *  Projected to a whole month from the days elapsed: a balance divided by 16
   *  days of a 30-day month would read almost twice the true runway, and this
   *  is a number he would plan around.
   */
  const runway = useMemo(() => {
    const balance = Number(d?.credits?.remaining_usd ?? d?.credits?.balance_usd);
    const gross = Number(billed?.gross_usd);
    if (!Number.isFinite(balance) || balance <= 0) return null;
    if (!Number.isFinite(gross) || gross <= 0) return null;

    // DIVIDE BY THE DAYS THE PERIOD ACTUALLY COVERS.
    //
    // This divided by TODAY'S DAY OF MONTH whatever was selected, which was
    // right only while the hero was pinned to the current month. The month
    // strip moved the hero and this was never re-pinned, so a three-month
    // total ($68.63) was treated as 16 days of spend: $128.69/month, and
    // "Runs out around 9 October" in ALARM RED. The true date is 11 December.
    //
    // A wrong number is bad; a wrong number in the colour that means "act now"
    // is worse, and this is the one figure on the page meant to make him act.
    const from = new Date(`${range?.from ?? ""}T00:00:00Z`);
    const to = new Date(`${range?.to ?? ""}T00:00:00Z`);
    const today = new Date();
    let days: number;
    if (range && !Number.isNaN(from.valueOf()) && !Number.isNaN(to.valueOf())) {
      // An unfinished period only ran until today, so count to today — not to
      // the 30th of a month we are 16 days into, which would halve the rate.
      const last = to.valueOf() > today.valueOf() ? today : to;
      days = Math.floor((last.valueOf() - from.valueOf()) / 86_400_000) + 1;
    } else {
      days = today.getUTCDate();
    }
    const perMonth = (gross / Math.max(1, days)) * 30.44;
    if (perMonth <= 0) return null;
    const months = balance / perMonth;
    const out = new Date();
    out.setUTCDate(out.getUTCDate() + Math.round(months * 30.44));
    return {
      perMonth,
      months,
      on: out.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
  }, [d?.credits, billed?.gross_usd]);

  /** The one button in this application that spends money: two Cost Explorer
   *  calls at a cent each. The server holds the brakes (a shared 6-hour
   *  cooldown and a monthly ceiling), so this only has to report what it was
   *  told — including a refusal, which arrives as a normal 200 because "you
   *  refreshed 20 minutes ago" is a correct answer, not an error. */
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const refresh = async () => {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const r = await api.post<{
        ok: boolean;
        skipped?: boolean;
        reason?: string;
        rows_written?: number;
      }>("/platform/costs/refresh", {});
      if (r.ok) {
        setRefreshNote(`Fetched — ${r.rows_written ?? 0} lines updated.`);
        s.reload();
      } else {
        setRefreshNote(r.reason ?? "AWS would not answer.");
      }
    } catch (e) {
      setRefreshNote(e instanceof ApiError ? errorCopy(e) : "Something went wrong.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col space-y-5">
      <PageHeader
        title="AWS bill"
        subtitle="What it will cost, what we measured, and which restaurant caused it."
      />

      {s.loading && !d && <Spinner />}
      {s.error && (
        <Card className="p-4">
          <p className="text-sm text-danger">{errorCopy(s.error)}</p>
          <button
            type="button"
            onClick={s.reload}
            className="mise-press mise-well mt-2 rounded-xl px-3 py-1.5 text-xs"
          >
            Retry
          </button>
        </Card>
      )}

      {d && (
        <>
          {/* ── THE AMOUNT ─────────────────────────────────────────────── */}
          <Card className="p-0">
            {/* THREE POPULATED COLUMNS, which is what the design called for
                and what did not ship. Two columns left a ~725x240px void
                beside the hero at 1920 — the wider the monitor, the bigger the
                hole — and that emptiness is the exact fault that triggered this
                rebuild. Asymmetry has to come from TYPE SIZE (a 60px figure
                against 20px everywhere else), never from leaving a cell blank.
                Moving the measured figures out of the credit well also takes
                ~150px off the page height, which is the other complaint. */}
            <div className="grid gap-px lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="p-5">
                {/* THE LABEL HAS TO FOLLOW THE CHIP. It read "THIS MONTH SO
                    FAR" above $9.22 with July selected and above $68.63 with
                    three months selected — the number moved and the sentence
                    over it did not, which is worse than a dead selector
                    because it states something false rather than nothing. */}
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                  {periodLabel} · USD
                </p>
                <p className="mt-1 font-display text-5xl font-bold tabular-nums text-fg sm:text-6xl">
                  {money(billed?.gross_usd)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Source
                    kind="billed"
                    staleSeconds={
                      billed?.as_of
                        ? Math.round((now - new Date(billed.as_of).getTime()) / 1000)
                        : null
                    }
                  />
                  {!billed?.available && (
                    <span className="text-xs text-fg-faint">{billed?.reason}</span>
                  )}
                </div>
                {billed?.available && (billed.credits_usd ?? 0) !== 0 && (
                  <p className="mise-tone-good mt-2 text-[13px] font-medium">
                    Credits covered {money(Math.abs(billed.credits_usd ?? 0))} of it — you have
                    not been charged.
                  </p>
                )}
              </div>

              <div className="mise-well m-3 space-y-2 rounded-xl p-4">
                {/* THE RUNWAY.
                    ------------------------------------------------------------
                    The balance is read from AWS (`freetier:GetAccountPlanState`,
                    free), so it is chipped with whatever provenance the server
                    actually had rather than a hardcoded "entered_by_hand" — I
                    twice said this number had no API, and hardcoding the chip is
                    how that mistake stayed invisible.

                    It is the most consequential figure on the page. The account
                    plan is already PAID: when this reaches zero nothing switches
                    off, the charges simply start arriving. So it carries the
                    months-left estimate beside it — a balance with no burn rate
                    beside it is a number nobody can act on. */}
                <Row
                  label="Credit left"
                  value={money(
                    Number(d.credits?.remaining_usd ?? d.credits?.balance_usd) || null,
                  )}
                  chip={<Source kind={(d.credits?.kind as never) ?? "entered_by_hand"} />}
                />
                {runway && (
                  <div className="px-1">
                    {/* THE DATE, not just "2.8 months". This is the sentence the
                        whole page exists for and it was not on it — and nobody
                        can put "2.8 months" in a calendar. */}
                    <p className="text-[13px] font-semibold text-fg">
                      Runs out around{" "}
                      <span className={runway.months < 2 ? "mise-tone-bad" : ""}>
                        {runway.on}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
                      {money(runway.perMonth)}/month at this period&rsquo;s rate
                      {d.credits?.plan_type === "PAID" &&
                        " · the plan is already PAID, so nothing switches off — the charges just begin."}
                    </p>
                  </div>
                )}
                {/* HIS ASK: "please have a manual enter field for remaining
                    credits if u cant able to fetch the exact crdits". It fetches
                    live today, so this is the fallback AND the only home for the
                    expiry date, which has no API at all. */}
                <CreditFields
                  credits={d.credits}
                  onSaved={() => s.reload()}
                />
              </div>

              {/* ── WHAT WE MEASURED, same period ───────────────────────────
                  Its own column now. Sharing the credit well made that card
                  long and this side of the band empty, and it mixed two
                  different provenances — a balance read from AWS sitting in the
                  same box as counters we keep ourselves. */}
              <div className="mise-well m-3 space-y-2 rounded-xl p-4">
                <p className="px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  What we measured
                </p>
                {measuredGap && (
                  <p className="px-1 text-[11px] leading-relaxed text-fg-faint">
                    Nothing was measured in this period — our counters start{" "}
                    {measuredGap}. The AWS figures beside this are real; these
                    are dashes rather than zeros, because &ldquo;nothing
                    happened&rdquo; is not something we know.
                  </p>
                )}
                <Row
                  label="Measured requests"
                  value={measuredGap ? "—" : n(d.measured.totals.requests)}
                  chip={
                    <Source
                      kind="live"
                      note={
                        flushed == null
                          ? "counters have not been written yet"
                          : `counters written ${flushed}s ago`
                      }
                    />
                  }
                />
                <Row
                  label="DB reads / writes"
                  value={
                    measuredGap
                      ? "—"
                      : `${n(d.measured.totals.db_selects)} / ${n(d.measured.totals.db_writes)}`
                  }
                  chip={<Source kind="live" note="capacity, not cost — RDS here has no per-IO charge" />}
                />
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            {/* MONTHS, NOT AN ABSTRACT WINDOW. "when i click this 90 days
                window..the amount is not chaing" — it did not, because the
                headline was pinned to the calendar month while this sat under
                it. Now each chip carries its own total and IS the label of the
                big number, so it cannot be dead, and the last chip is the
                ~$60 he was looking for, exact. */}
            {periodMonths.length > 0 ? (
              <PeriodTabs months={periodMonths} value={period} onChange={setPeriod} />
            ) : (
              <Segmented value={days} onChange={setDays} options={WINDOWS} />
            )}
            {/* THE ONLY BUTTON HERE THAT SPENDS MONEY — two Cost Explorer calls
                at a cent each. It says so, because a refresh button that looks
                free gets pressed like one. The server refuses politely inside a
                6-hour window and the refusal lands in the note below rather than
                as a red error, since "you already refreshed" is a correct answer
                to a reasonable request. */}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="mise-press mise-well rounded-xl px-3 py-1.5 text-xs font-semibold text-fg-soft disabled:opacity-50"
              title="Two Cost Explorer calls, $0.01 each"
            >
              {refreshing ? "Asking AWS…" : "↻ Refresh AWS figures"}
            </button>
            <p className="text-xs text-fg-faint">
              A bill is a month, so every choice here is one — except the last,
              which is every month we hold, added up.
            </p>
          </div>
          {refreshNote && (
            <p className="text-xs text-fg-faint" role="status">
              {refreshNote}
            </p>
          )}

          {/* ── WHERE IT GOES ──────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-fg">By service</h3>
                <Source kind="billed" />
              </div>
              {services.length === 0 ? (
                <p className="mt-3 text-sm text-fg-faint">
                  Nothing fetched yet. The bill is read twice a day — press Refresh
                  above to fetch it now.
                </p>
              ) : (
                <div className="mt-3">
                  <BillLines rows={billed?.by_service ?? []} />
                </div>
              )}
              {!!billed?.unclassified?.length && (
                <p className={`mt-3 text-xs ${unnamed.loud ? "mise-tone-warn" : "text-fg-faint"}`}>
                  {unnamed.n} line{unnamed.n === 1 ? "" : "s"} we cannot name —{" "}
                  <b>{money2(unnamed.usd)}</b> between them
                  {unnamed.allFree
                    ? ", all inbound data transfer, which AWS does not charge for. Nothing unexplained is costing money."
                    : `. Largest: ${unnamed.top}.`}
                </p>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-fg">Cost per request</h3>
              <p className="text-xs text-fg-faint">
                Three numbers, because one would mislead.
              </p>
              <ul className="mt-3 space-y-2">
                {(["fully_loaded_per_1k", "marginal_per_1k", "ai_per_call"] as const).map((k) => {
                  const e = d.unit_economics[k] as { value: number | null; definition: string };
                  if (!e) return null;
                  return (
                    <li key={k} className="mise-well rounded-xl p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-fg-soft">
                          {k === "ai_per_call" ? "Per AI call" : k === "marginal_per_1k" ? "Marginal / 1k" : "Fully loaded / 1k"}
                        </span>
                        <span className="shrink-0 whitespace-nowrap font-mono text-sm text-fg">
                          {e.value == null ? "—" : usd(e.value)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">{e.definition}</p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          {/* ── PER HOTEL ──────────────────────────────────────────────── */}
          <Card className="flex min-h-0 flex-1 flex-col p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-fg">Per restaurant</h3>
              <p className="text-xs text-fg-faint">
                Two money columns, never added together — see why below.
              </p>
            </div>

            {h.loading && !h.data && <Spinner />}
            {h.data && (
              <>
                {/* `mise-stack` BELONGS ON THE <table>, not on a wrapping div.
                    The rule in globals.css names `.mise-stack, .mise-stack
                    tbody, .mise-stack tr, .mise-stack td` — it never names
                    `table`. On the div the table stayed `display: table` and
                    kept its natural 454px width inside a 306px column, so on a
                    phone every restaurant card printed five labels
                    ("Requests", "AI calls"…) with NOTHING beside them and the
                    names clipped mid-word. The other ten `mise-stack` tables in
                    this app all put it on the element it is written for; this
                    was the only one that did not. */}
                <div className="mt-3 overflow-x-auto">
                  <table className="mise-stack w-full text-sm">
                    <thead>
                      <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                        <th className="px-3 py-2 font-medium">Restaurant</th>
                        <th className="px-3 py-2 text-right font-medium">Requests</th>
                        <th className="px-3 py-2 text-right font-medium">AI calls</th>
                        <th className="px-3 py-2 text-right font-medium">AI cost</th>
                        <th className="px-3 py-2 text-right font-medium">Share of the box</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r) => (
                        <tr key={r.hotel_id} className="border-b border-line">
                          <td className="px-3 py-2 font-medium text-fg" data-label="Restaurant">
                            {r.name}
                            {/* THE EMAIL, which he asked for and which was on
                                the fleet payload all along. */}
                            {r.email && (
                              <span className="mt-0.5 block font-mono text-[10px] font-normal text-fg-faint">
                                {r.email}
                              </span>
                            )}
                            {r.hotel_id === ANON_ID && (
                              /* §45.1 — "whats the anonymous public traffic
                                 means?" was his question verbatim, and the row
                                 answered it nowhere. It is the biggest row in
                                 the table and it is not a customer. */
                              <span className="mt-0.5 block text-[10px] font-normal leading-relaxed text-fg-faint">
                                Not a restaurant — public pages, sign-in, diner
                                QR menus and health checks.
                              </span>
                            )}
                            {r.silent && (
                              <span className="mt-0.5 block text-[10px] font-normal text-fg-faint">
                                no requests in this period
                              </span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2 text-right tabular-nums text-fg-soft"
                            data-label="Requests"
                          >
                            {r.silent ? "—" : n(r.requests)}
                          </td>
                          <td
                            className="px-3 py-2 text-right tabular-nums text-fg-soft"
                            data-label="AI calls"
                          >
                            {r.silent ? "—" : n(r.ai_calls)}
                          </td>
                          <td
                            className="px-3 py-2 text-right tabular-nums text-fg"
                            data-label="AI cost"
                          >
                            {r.silent ? "—" : money(r.ai_usd)}
                          </td>
                          {/* A DASHED UNDERLINE is the tell for "modelled".
                              It survives greyscale and all 23 themes; colour
                              alone would not. */}
                          <td
                            className="px-3 py-2 text-right tabular-nums text-fg"
                            data-label="Share of the box"
                          >
                            {r.silent ? (
                              <span title="Nothing measured, so nothing to apportion.">—</span>
                            ) : (
                              <span className="underline decoration-dashed underline-offset-4">
                                {money(r.shared_usd)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {tableRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-sm text-fg-faint">
                            No measured usage yet. The counters begin from the first request
                            after this shipped — nothing before it was recorded, and a zero
                            here would be an invention.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mise-well mt-4 rounded-xl p-3 text-[11px] leading-relaxed text-fg-faint">
                  <p>
                    <b className="text-fg-soft">AI cost is measured</b> — logged per call.{" "}
                    <b className="text-fg-soft">Share of the box is a model</b>, shown with a
                    dashed underline: AWS has never heard of a restaurant, so this splits one
                    shared machine by measured usage.
                  </p>
                  <p className="mt-1.5">
                    And the part that matters:{" "}
                    <b className="text-fg-soft">
                      the box costs the same with one restaurant or fifty.
                    </b>{" "}
                    A share of it is a fair split of rent, not a claim about who caused spend.
                  </p>
                  {h.data.reconciliation.k != null && (
                    <p className="mt-1.5">
                      AWS billed {money(h.data.reconciliation.aws_bedrock_usd)} for Bedrock; our
                      own ledger recorded {money(h.data.reconciliation.our_ledger_usd)} —{" "}
                      <b className="text-fg-soft">×{h.data.reconciliation.k.toFixed(2)}</b> apart,
                      so the per-restaurant figures above are scaled to AWS&apos;s total rather
                      than to ours.
                    </p>
                  )}
                  <p className="mt-1.5">{d.measured.caveat}.</p>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, value, chip }: { label: string; value: string; chip?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-xs text-fg-soft">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span className="font-mono text-sm text-fg">{value}</span>
        {chip}
      </span>
    </div>
  );
}
