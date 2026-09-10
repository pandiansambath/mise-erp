"use client";

/** The table's meal, as it happens.
 *
 *  "you added that progress bar in right side, but again right side bottom
 *   area are empty... add as much as feature in that progress bar that customer
 *   should know enough details — like what he ordered before, whether it
 *   served, after that what he ordered, with time too (don't hardcode timestamp
 *   as raw, use a different kinda style to show time of the ordered item, when
 *   he ordered, when it arrived)."
 *
 *  What was there tracked ONE order and forgot it the moment it arrived — the
 *  diner's endpoint filtered out COMPLETED, so a served round disappeared off
 *  the only screen following the meal. A table does not order once. It orders,
 *  eats, orders again, and the question that decides the second round is "how
 *  long did the first one take?" — which nothing on the page could answer.
 *
 *  So this is a timeline, not a status: every round of the sitting in the order
 *  it happened, when each was asked for, and how long the served ones took.
 *
 *  ── ON THE SHAPE ─────────────────────────────────────────────────────────
 *  This replaces a 23rem right-hand rail, which was his complaint: a card at
 *  the top and six hundred pixels of nothing under it. My first attempt at the
 *  replacement made the same mistake rotated ninety degrees — a two-column
 *  band tall enough for the status block, with one round of food in the other
 *  column and white space under it.
 *
 *  A table with one order genuinely has little to say, and no layout can
 *  honestly fill 1760px with it. So the strip is WIDE AND SHORT, and its
 *  height follows its content: status, journey and rounds sit on ONE line,
 *  with the progress bar running the full width underneath. Order twice and it
 *  grows a line. Nothing is ever padded out to look busy.
 */

export type TimelineOrder = {
  id: string;
  status: string;
  total: string;
  created_at: string;
  accepted_at?: string | null;
  ready_at?: string | null;
  served_at?: string | null;
  updated_at?: string | null;
  eta_minutes?: number | null;
  items: { name: string; quantity: number; line_total: string }[];
};

const DEAD = ["COMPLETED", "REJECTED", "CANCELLED"];

/** The diner's four stops. Not the kitchen's seven: REJECTED and CANCELLED are
 *  not steps on a journey, they are the journey ending. */
const STOPS = [
  { key: "NEW", label: "Sent" },
  { key: "CONFIRMED", label: "Accepted" },
  { key: "PREPARING", label: "Cooking" },
  { key: "READY", label: "On its way" },
];

const SAY: Record<string, { label: string; hint: string; tone: string }> = {
  NEW: { label: "Sent to the kitchen", hint: "They'll accept it in a moment", tone: "text-amber-300" },
  CONFIRMED: { label: "Accepted", hint: "You're in the queue", tone: "mise-tone-info" },
  PREPARING: { label: "Cooking now", hint: "It's on the stove", tone: "mise-tone-info" },
  READY: { label: "On its way over", hint: "Someone is bringing it", tone: "text-emerald-400" },
  COMPLETED: { label: "Served", hint: "Hope it was good", tone: "text-fg-soft" },
};

/** How long ago, said the way a person says it.
 *
 *  "don't hardcode timestamp as raw... use a different kinda style to show
 *   time of the ordered item, when he ordered, when it arrived."
 *
 *  A diner reading "2026-09-10T22:13:08Z" — or even "10:13 PM" — has to do
 *  arithmetic to learn the only thing they wanted, which is how long it has
 *  been. An earlier version of this switched to clock time past an hour and
 *  the first screenshot of a late order duly read "ordered 10:13 PM", which is
 *  the exact thing he asked not to see. It stays relative all the way up.
 */
function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return "just now";
  if (m === 1) return "a minute ago";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} hr ${r} min ago` : `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** How long something took, in words. Empty when we cannot honestly say:
 *  orders placed before these columns existed have no `served_at`, and an
 *  invented "took 14 min" is worse than a gap. */
function took(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return "";
  const m = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  if (!Number.isFinite(m) || m < 0) return "";
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

function itemLine(o: TimelineOrder): string {
  const parts = o.items.map((i) => `${i.quantity}× ${i.name}`);
  if (parts.length === 0) return "Your order";
  if (parts.length <= 2) return parts.join(", ");
  return `${parts.slice(0, 2).join(", ")} + ${parts.length - 2} more`;
}

export function MealTimeline({
  orders,
  now,
  prepMinutes,
  money,
}: {
  /** Everything this sitting has ordered, newest first (as the API returns). */
  orders: TimelineOrder[];
  now: number;
  prepMinutes: number;
  money: (v: string | number) => string;
}) {
  if (orders.length === 0) return null;

  // Oldest first: a timeline reads forwards.
  const rounds = [...orders].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const live = rounds.filter((o) => !DEAD.includes(o.status));
  // The one being waited on. If several are open it is the oldest — that is
  // the one that has been waited on longest, and the one a countdown owes an
  // answer about.
  const focus = live[0] ?? null;
  const spent = rounds.reduce((t, o) => t + Number(o.total), 0);

  // ── the focused round's clock ────────────────────────────────────────────
  // From ACCEPTANCE. `updated_at` is `onupdate=func.now()`, so it moves
  // whenever anything on the row is written — pressing "Need someone" once
  // sent a two-day-old order back to "9 minutes away".
  const from =
    focus && focus.status !== "NEW"
      ? new Date(focus.accepted_at ?? focus.created_at).getTime()
      : null;
  const mins = focus?.eta_minutes ?? prepMinutes;
  const left = from ? Math.max(0, Math.ceil((from + mins * 60000 - now) / 60000)) : null;
  const overdueBy = from && mins > 0 ? Math.floor((now - (from + mins * 60000)) / 60000) : 0;
  const late = overdueBy > 0;
  const pct =
    from && left !== null && mins > 0
      ? Math.min(100, Math.max(0, ((mins - left) / mins) * 100))
      : 0;
  const at = focus ? STOPS.findIndex((s) => s.key === focus.status) : -1;
  const say = focus ? (SAY[focus.status] ?? SAY.NEW) : SAY.COMPLETED;

  // ── ONE NUMBER, ALWAYS IN THE SAME PLACE ─────────────────────────────────
  // The first cut swapped the countdown for an emoji when an order ran late,
  // so the biggest element on the band became a lonely hourglass with a hole
  // where the figure had been. Late is not "no information" — it is a
  // different number, and "31 min over" is exactly as useful to a waiting
  // person as "12 mins away".
  const big: { n: string; unit: string; tone: string } = !focus
    ? { n: money(spent), unit: "at this table", tone: "text-fg" }
    : focus.status === "READY"
      ? { n: "🛎️", unit: "any moment", tone: "text-emerald-400" }
      : late
        ? // Minutes stop being readable long before they stop being countable.
          // The first screenshot of this said "253", which nobody parses as
          // four hours — the figure has to switch to hours while it is still
          // small enough to take in at a glance.
          {
            n:
              overdueBy < 90
                ? String(overdueBy)
                : String(Math.floor(overdueBy / 60)),
            unit:
              overdueBy < 90
                ? "min over"
                : Math.floor(overdueBy / 60) === 1
                  ? "hr over"
                  : "hrs over",
            tone: "text-amber-500",
          }
        : left !== null
          ? { n: String(left), unit: left === 1 ? "min away" : "mins away", tone: "text-fg" }
          : { n: `~${mins}`, unit: "mins, usually", tone: "text-fg-soft" };

  return (
    <section
      className={`mise-card-inset relative overflow-hidden rounded-3xl ${
        focus?.status === "PREPARING" ? "mise-cooking" : ""
      }`}
      aria-label="Your meal so far"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-stretch lg:gap-6">
        {/* ── 1. THE ONE NUMBER A WAITING PERSON WANTS ────────────────────
            Everything else on this page is browsing. This is the bit somebody
            keeps looking at while their food is somewhere they cannot see. */}
        <div className="flex items-center gap-3.5 lg:w-56 lg:shrink-0">
          <span
            className={`font-display text-4xl font-bold leading-none tabular-nums sm:text-5xl ${big.tone}`}
          >
            {big.n}
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-bold leading-tight ${late ? "text-amber-500" : say.tone}`}>
              {focus ? (late ? "Running late" : say.label) : "All served"}
            </p>
            {/* THE UNIT ALWAYS GOES WITH THE NUMBER.
                This slot showed "sorry — do ask us" instead of the unit when
                an order ran late, so the band rendered a large amber "4" with
                nothing anywhere saying "hours" — a figure with no unit is not
                a smaller piece of information, it is a different and wrong
                one. The apology rides alongside it. */}
            <p className="mt-0.5 text-[11px] leading-tight text-fg-soft">
              {big.unit}
              {late && (
                /* Owned rather than hidden. A kitchen that is behind is a fact
                   the table already knows; saying it plainly, and pointing at
                   the button that fetches a human, is the only version of this
                   that keeps their trust. */
                <span className="text-fg-faint"> · sorry, do ask us</span>
              )}
            </p>
          </div>
        </div>

        {/* ── 2. THE JOURNEY ──────────────────────────────────────────────── */}
        {focus && (
          <ol className="flex items-start gap-1 lg:w-72 lg:shrink-0 lg:self-center">
            {STOPS.map((s, i) => {
              const done = at >= 0 && i <= at;
              const here = i === at;
              return (
                <li key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`h-2 w-2 rounded-full transition ${
                      here
                        ? "bg-brand-500 ring-4 ring-brand-500/20"
                        : done
                          ? "bg-brand-400"
                          : "bg-fg-faint/30"
                    }`}
                  />
                  <span
                    className={`text-center text-[10px] leading-none ${
                      here ? "font-bold text-fg" : "text-fg-faint"
                    }`}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {/* ── 3. THE MEAL ITSELF, IN THE ORDER IT HAPPENED ─────────────────
            What the rail never had. Each round says what it was, when it was
            asked for, and — once it lands — how long it took. Those three
            facts are what a diner has and a screen usually does not. */}
        <div className="min-w-0 flex-1 lg:border-l lg:border-line/60 lg:pl-6">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
              Your meal so far
            </h2>
            {/* Only once there is something to summarise. With a single
                round this printed "1 round · £10.95" directly above a row
                already showing £10.95. */}
            {rounds.length > 1 && (
              <p className="text-[11px] tabular-nums text-fg-faint">
                {rounds.length} rounds ·{" "}
                <b className="font-semibold text-fg-soft">{money(spent)}</b>
              </p>
            )}
          </div>

          <ol className="space-y-1">
            {rounds.map((o) => {
              const done = o.status === "COMPLETED";
              const isFocus = focus?.id === o.id;
              const s = SAY[o.status] ?? SAY.NEW;
              // How long that round took, end to end. Only said when both
              // marks are real.
              const duration = took(o.created_at, o.served_at ?? o.ready_at);
              return (
                /* TWO LINES, not one long one. On a single row the dish
                   name took `flex-1` and shoved its own status and timing to
                   the far side of a 1000px column — the two facts that belong
                   together ended up furthest apart — while on a phone the same
                   row truncated to "1× Butter…". What it is and what it cost
                   on top, what is happening to it underneath. */
                <li
                  key={o.id}
                  className={`rounded-lg px-2 py-1.5 ${isFocus ? "bg-glass/[0.06]" : ""}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      aria-hidden
                      className={`h-2 w-2 shrink-0 self-center rounded-full ${
                        done ? "bg-emerald-500" : isFocus ? "bg-brand-500" : "bg-fg-faint/40"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                      {itemLine(o)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">
                      {money(o.total)}
                    </span>
                  </div>
                  <p className="ml-4 mt-0.5 text-[11px] leading-tight text-fg-faint">
                    <span
                      className={`font-medium ${done ? "text-emerald-500" : s.tone}`}
                    >
                      {done ? "Served" : s.label}
                    </span>
                    {" · ordered "}
                    {ago(o.created_at, now)}
                    {done && duration && (
                      <>
                        {" · on the table in "}
                        <b className="font-semibold text-fg-soft">{duration}</b>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* ── THE BAR, ACROSS THE WHOLE THING ────────────────────────────────
          Full-bleed along the bottom edge rather than tucked into a column.
          It is the one element on the band that genuinely wants the width:
          a 200px bar reads as a widget, a 1700px one reads as the evening. */}
      {focus && (
        <div
          className="h-1.5 w-full bg-glass/10"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="How far along your order is"
        >
          <span
            className={`block h-full transition-[width] duration-1000 ${
              late ? "bg-amber-500" : "bg-gradient-to-r from-brand-500 to-brand-300"
            }`}
            // Never quite full until it really is: a 100% bar above an unlit
            // "Cooking" reads as finished whatever colour it is, so a late
            // order stops short and lets the words carry the news.
            style={{
              width: `${focus.status === "READY" ? 100 : late ? 92 : Math.min(90, pct)}%`,
            }}
          />
        </div>
      )}
    </section>
  );
}
