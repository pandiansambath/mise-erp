"use client";

// 🍽️ THE TABLE. What a diner sees after scanning the card in front of them.
//
//   "customer comes to hotel and he needs to call the bearer to order food...
//    which means customer needs to call and wait for him to come and take the
//    orders. What if we automate this... customer comes and sits on the table
//    and he can scan the QR, here all items menu with detail, slogan for each
//    item, combos, literally the menu will be here. Customer can pick and order,
//    which will show real-time estimation to bring that food."
//
// Two things make this page different from the takeaway one, and both come from
// the fact that the person reading it is ALREADY HERE:
//
//   1. It asks for nothing. No name, no phone, no address — the table is the
//      address. Every field would be a reason to give up and wave at a waiter
//      instead, which is the exact behaviour this page exists to delete.
//   2. It stays open afterwards. The order becoming food is the interesting
//      part, so the page turns into a live ticket rather than a receipt.
import { use, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { THEMES, themeVars, useTheme } from "@/lib/theme";
import { dishPhoto } from "@/lib/dishPhoto";
import { TableTalk } from "@/components/order/TableTalk";
import { burstAway } from "@/components/order/burst";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: string;
  emoji: string | null;
  has_photo?: boolean;
  /** Can it be added right now? */
  orderable?: boolean;
  /** If not: why, and when it is back. */
  unavailable_reason?: string | null;
};
type TableInfo = { label: string; code: string; seats: number };
type HotelInfo = {
  id: string;
  name: string;
  city: string | null;
  currency: string;
  prep_minutes?: number;
  paused?: boolean;
};
type LiveOrder = {
  id: string;
  code: string;
  status: string;
  total: string;
  created_at: string;
  updated_at?: string | null;
  /** What the kitchen says THIS ticket takes. Null = the hotel default. */
  eta_minutes?: number | null;
  items: { name: string; quantity: number; line_total: string }[];
};

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", INR: "₹" };

/** What the diner is told is happening, in words a diner uses.
 *
 *  The kitchen's own words are for the kitchen — "CONFIRMED" tells somebody
 *  waiting for lunch nothing at all. */
const SAY: Record<string, { label: string; hint: string; tone: string }> = {
  NEW: { label: "Sent to the kitchen", hint: "They'll accept it in a moment", tone: "text-amber-300" },
  CONFIRMED: { label: "Accepted", hint: "You're in the queue", tone: "mise-tone-info" },
  PREPARING: { label: "Being cooked", hint: "On the stove now", tone: "mise-tone-info" },
  READY: { label: "Coming to your table", hint: "On its way over", tone: "mise-tone-good" },
  COMPLETED: { label: "Served", hint: "Enjoy", tone: "mise-tone-good" },
  REJECTED: { label: "Couldn't be made", hint: "Please ask a member of staff", tone: "text-rose-300" },
  CANCELLED: { label: "Cancelled", hint: "", tone: "text-fg-faint" },
};

export default function TablePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { theme } = useTheme();
  // Palette variables live on :root, so a public screen has to pin them itself
  // or it inherits whatever the last app page left behind.
  const themed = useMemo(() => themeVars(theme), [theme]);

  const [table, setTable] = useState<TableInfo | null>(null);
  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [missing, setMissing] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [live, setLive] = useState<LiveOrder[]>([]);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [helped, setHelped] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  // The talk sheet: null = shut, {dish} = opened about a dish.
  const [talk, setTalk] = useState<{ dish?: { id: string; name: string } | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const money = (v: string | number) =>
    `${SYMBOL[hotel?.currency ?? "GBP"] ?? ""}${Number(v).toFixed(2)}`;

  useEffect(() => {
    fetch(`${API_BASE}/api/public/table/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        setTable(d.table);
        setHotel(d.hotel);
        setMenu(d.menu);
      })
      .catch(() => setMissing(true));
  }, [code]);

  // The live ticket. Polled rather than pushed because a diner's phone sleeps
  // in a pocket and a dropped socket is a page that quietly stops being true.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/public/table/${code}/orders`);
        if (r.ok && !stop) setLive((await r.json()).orders ?? []);
      } catch {
        /* a flaky dining-room wifi is not worth an error message */
      }
    };
    tick();
    const id = window.setInterval(tick, 6000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [code]);

  // Drives the countdown without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // NO AUTO-SELECTED COURSE. This used to jump to the first dish's category on
  // load, and after the course filter started matching on a NORMALISED key it
  // was setting `cat` to a raw label — "Mains" against a key of "main" — which
  // matches nothing. The menu rendered the pills and then NOT ONE DISH, on the
  // one page a customer ever sees. My own regression, shipped.
  //
  // It should not exist regardless: a diner arriving at a menu wants the menu.
  // "Everything" is the default and the whole list is there to scroll.

  // "MAIN" AND "MAINS" ARE THE SAME COURSE.
  //
  // The kitchen types the category by hand, so the same course arrives spelled
  // two ways — and this is the screen where that matters most, because a diner
  // reading two "Main" sections assumes they are different things and orders
  // from one of them. Matched on a normalised key, labelled with whichever
  // spelling the kitchen uses most.
  const courseKey = (name: string) => name.trim().toLowerCase().replace(/s$/, "");

  const cats = useMemo(() => {
    const seen = new Map<string, { n: number; names: Map<string, number> }>();
    for (const m of menu) {
      const k = courseKey(m.category);
      const e = seen.get(k) ?? { n: 0, names: new Map<string, number>() };
      e.n += 1;
      e.names.set(m.category, (e.names.get(m.category) ?? 0) + 1);
      seen.set(k, e);
    }
    return [...seen.entries()].map(([k, e]) => {
      const best = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return { key: k, label: best[0][0], n: e.n };
    });
  }, [menu]);

  const shown = useMemo(
    () => menu.filter((m) => !cat || courseKey(m.category) === cat),
    [menu, cat],
  );

  /** The visible dishes, in courses — a menu has a shape and a flat list throws
   *  it away. */
  const courses = useMemo(() => {
    const label = new Map(cats.map((c) => [c.key, c.label]));
    const by = new Map<string, MenuItem[]>();
    for (const m of shown) {
      const k = courseKey(m.category);
      const arr = by.get(k);
      if (arr) arr.push(m);
      else by.set(k, [m]);
    }
    return [...by.entries()].map(
      ([k, rows]) => [label.get(k) ?? rows[0].category, rows] as [string, MenuItem[]],
    );
  }, [shown, cats]);
  const lines = useMemo(
    () => Object.entries(cart).map(([id, q]) => ({ item: menu.find((m) => m.id === id)!, q })).filter((l) => l.item),
    [cart, menu],
  );
  const subtotal = lines.reduce((t, l) => t + Number(l.item.price) * l.q, 0);
  const count = lines.reduce((t, l) => t + l.q, 0);

  function bump(id: string, d: number) {
    setCart((c) => {
      const n = Math.max(0, (c[id] ?? 0) + d);
      const next = { ...c };
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  async function place() {
    if (!count) return;
    setPlacing(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/public/table/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || null,
          items: lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.q })),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Could not send that order");
      setCart({});
      setNote("");
      setBasketOpen(false);
      // "this is indirect marketing... we need a best top-notch animated page."
      // The celebration goes HERE and nowhere else: the order landing is the
      // one moment worth a party, and a page that sparkles while somebody is
      // reading a price is noise, not delight.
      burstAway(document.getElementById("mise-table-basket"));
      const rr = await fetch(`${API_BASE}/api/public/table/${code}/orders`);
      if (rr.ok) setLive((await rr.json()).orders ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send that order");
    } finally {
      setPlacing(false);
    }
  }

  async function callStaff() {
    setHelped(true);
    window.setTimeout(() => setHelped(false), 8000);
    await fetch(`${API_BASE}/api/public/table/${code}/help`, { method: "POST" }).catch(() => {});
  }

  if (missing) {
    return (
      <div
        data-mode={THEMES[theme].light ? "light" : "dark"}
        style={themed}
        className="mise-app grid min-h-dvh place-items-center bg-shell p-6 text-fg"
      >
        <div className="mise-well max-w-sm rounded-3xl p-8 text-center">
          <p className="text-4xl" aria-hidden>🍽️</p>
          <h1 className="mt-3 font-display text-xl">This table isn&apos;t taking orders</h1>
          <p className="mt-2 text-sm text-fg-faint">
            The card may be out of date — please ask a member of staff.
          </p>
        </div>
      </div>
    );
  }

  const active = live.filter((o) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(o.status));
  // Whether the second column earns its place — see the note on <main>.
  // Declared HERE, below `active`: a const cannot be read above its own
  // declaration, and `tsc` catches that where `next build` does not.
  const railHasContent = active.length > 0;

  // Reads the hour so the page is not identical at 9am and 9pm. Computed from
  // `now`, which already ticks for the countdown, so it costs nothing extra
  // and cannot go stale on a tab left open across the evening.
  const greeting = (() => {
    const h = new Date(now).getHours();
    if (h < 11) return "Good morning";
    if (h < 16) return "Good afternoon";
    if (h < 22) return "Good evening";
    return "Still open";
  })();
  const runningTotal = live.reduce((t, o) => t + Number(o.total), 0);

  return (
    <div
      data-mode={THEMES[theme].light ? "light" : "dark"}
      style={themed}
      className="mise-app min-h-dvh bg-shell pb-32 text-fg"
    >
      {/* ── Where you are. The first thing to settle, because a QR could have
             been anything and a diner needs to know they scanned the right one. */}
      <header className="sticky top-0 z-40 border-b border-glass/10 bg-shell/85 backdrop-blur-xl">
        {/* WRAPS INSTEAD OF CRAMPING. At 390 the name, the table line and two
            buttons were fighting for one row, so "You're at Table 1 · food in
            about 20 min" broke across three lines and squeezed the buttons to
            the edge. The buttons drop to their own row on a narrow screen —
            they are the two things a diner reaches for without looking, and
            they should be a comfortable size. */}
        <div className="mx-auto flex w-full max-w-[110rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 lg:px-8 2xl:px-12">
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-400 text-sm font-bold text-white"
          >
            {(hotel?.name ?? "·").slice(0, 1).toUpperCase()}
          </span>
          {/* WRAPPING BY AMPUTATION IS NOT WRAPPING.
              I set the row to `flex-wrap` and gave the buttons `flex-1`, and the
              row never wrapped: the name block is `flex-1 min-w-0`, so it
              collapsed first and the table line truncated to "You're at T…".
              The one sentence whose whole job is telling a diner they scanned
              the RIGHT code was the thing that got cut.
              The buttons take half the width each below `sm`, which forces them
              onto their own line and gives the name back its own. */}
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <h1 className="truncate font-display text-xl font-bold leading-tight">
              {hotel?.name ?? "…"}
            </h1>
            <p className="truncate text-xs text-fg-soft">
              You&apos;re at <b className="text-brand-300">{table?.label ?? "…"}</b>
              {hotel?.prep_minutes ? ` · food in about ${hotel.prep_minutes} min` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTalk({})}
            className="mise-press mise-well min-h-[44px] flex-1 basis-[calc(50%-0.375rem)] rounded-xl px-4 text-sm font-semibold text-fg-soft sm:flex-none sm:basis-auto"
          >
            💬 Ask
          </button>
          <button
            type="button"
            onClick={callStaff}
            className={`mise-press min-h-[44px] flex-1 basis-[calc(50%-0.375rem)] whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition sm:flex-none sm:basis-auto ${
              helped ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
            }`}
          >
            {helped ? "On their way" : "🔔 Need someone"}
          </button>
        </div>
      </header>

      {/* ── ONE PAGE, TWO SHAPES ─────────────────────────────────────────
          "for mobile and desktop we need to build UI based on size of screen
           nah — here too right and left so many space is empty."

          He is right, and it was not a small miss: the whole page was
          `max-w-2xl`, a 672px column. On a phone that is the page. On a laptop
          it is a phone held up in the middle of the screen with a third of the
          window empty on either side, which reads as unfinished however good
          the cards are.

          A menu and a live order want different room, so they get different
          room. Below `lg` it is one column and the order sits on top, because
          when you are waiting that is the only thing you care about. From `lg`
          it becomes two: the menu takes the width it deserves and grows to
          three dishes a row, while the order moves to a sticky rail on the
          right where it stays in view as you scroll the food.

          The DOM order is the MOBILE order — order first, then menu — and the
          rail is placed with `order` at `lg` only. A screen reader and a phone
          both get the sequence that makes sense; the desktop rearrangement is
          presentational, which is the only kind of reordering that is safe. */}
      {/* ── USE THE WHOLE SCREEN ──────────────────────────────────────────
          "we have so much space wasted in right and left side, only center
           place we using — please REBUILD this entire page which will utilise
           the full entire areas."

          It was `max-w-6xl` — 1152px — so on a 1920px monitor there were two
          384px bands of nothing down the sides. Capping a MENU at reading width
          is the wrong instinct borrowed from prose: a wall of text needs a
          narrow measure, a wall of photographs wants the room.

          So the shell goes to 110rem with the padding growing at each step, and
          the dish grid keeps adding columns as the width allows — two on a
          tablet, three on a laptop, four on a wide monitor, five past that.
          The order rail widens slightly too, because a 21rem card beside a
          1600px menu looks like an afterthought. */}
      {/* ── ARRIVING SOMEWHERE ────────────────────────────────────────────
          "I literally said 1 story and all — like this is customer site, so we
           need to impress them."

          The page opened straight onto a filter row. Functionally fine, and it
          gave a person scanning a QR code at a table no sense of having arrived
          anywhere: no welcome, no name at any size, nothing that belongs to
          THIS restaurant rather than to a piece of ordering software.

          Deliberately a BAND and not a screen. He has said more than once that
          he hates scrolling, and a full-height hero on a menu is the most
          common way to make somebody scroll past the thing they came for. This
          is about 150px, it scrolls away, and the food starts immediately under
          it.

          The greeting reads the hour so the page is not the same all day —
          which is the cheapest possible way for a screen to feel like it knows
          you are there, and it costs nothing to be right about. */}
      <section className="mx-auto w-full max-w-[110rem] px-4 pt-5 lg:px-8 2xl:px-12">
        <div className="mise-card-inset relative overflow-hidden rounded-3xl px-5 py-6 sm:px-8 sm:py-8">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-copper-500/10 blur-3xl"
          />
          {/* TWO HALVES, because one was leaving two thirds of a 1760px band
              empty. A hero whose text stops a third of the way across is not
              generous, it is unfinished — the same fault as the empty rail,
              one element further up.
              The right half is the facts a diner actually wants on arrival:
              which table they are at, how long food takes, and what the table
              has run up so far. That last one also rescues "Ordered so far at
              this table: £10.95", which was floating alone at the far right of
              the filter row looking like something that had come loose. */}
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
                {greeting}
              </p>
              <h2 className="mt-1.5 font-display text-3xl font-bold leading-tight tracking-tight text-fg sm:text-4xl lg:text-5xl">
                {hotel?.name ?? "\u00a0"}
              </h2>
              {/* SAID ONCE. On a phone this band sat under a header already
                  reading "You're at Table 13 · food in about 20 min", and then
                  said the table again in the sentence AND again in a chip —
                  the same fact three times before any food appeared, on the
                  page whose whole job is showing food. The header is sticky and
                  keeps that reminder; the hero can get on with the welcome. */}
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-soft">
                Everything below is on tonight&apos;s menu. Tap a photo to ask about a
                dish, or press <b className="text-fg">Need someone</b> and one of us will
                come over.
              </p>
            </div>

            <dl className="flex flex-wrap gap-2 lg:justify-end">
              {[
                // No "Your table" chip: the sticky header carries it at all
                // times, so repeating it here spends a phone's first screen on
                // something already answered.
                ["Food in about", hotel?.prep_minutes ? `${hotel.prep_minutes} min` : "—"],
                ...(runningTotal > 0
                  ? ([["Ordered so far", money(runningTotal)]] as [string, string][])
                  : []),
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="mise-well min-w-[7.5rem] rounded-2xl px-3.5 py-2.5"
                >
                  <dt className="text-[10px] uppercase tracking-wide text-fg-faint">{k}</dt>
                  <dd className="mt-0.5 font-display text-lg font-bold leading-none text-fg">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* THE RAIL ONLY EXISTS WHEN IT HAS SOMETHING TO SAY.
          I split the page in two and then looked at it on a 1920px screen with
          no live order: a menu on the left and, beside it, six hundred pixels
          of nothing holding one grey sentence. A two-column layout with an
          empty second column does not read as spacious, it reads as broken —
          worse than the centred column it replaced.
          So the split is conditional. Nothing to track and nothing in the
          basket, and the menu simply takes the whole width. */}
      <main
        className={`mx-auto w-full max-w-[110rem] px-4 lg:px-8 2xl:px-12 ${
          railHasContent
            ? "lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-8 2xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:gap-12"
            : ""
        }`}
      >
        {/* ── The live ticket. "which will show real-time estimation to bring
               that food" — the reason this page stays open after ordering. */}
        {active.length > 0 && (
          <section className="mise-pop mt-4 space-y-2 lg:order-2 lg:sticky lg:top-24">
            {active.map((o) => {
              const say = SAY[o.status] ?? SAY.NEW;
              // The clock starts when the KITCHEN accepted it, not when it was
              // placed — a slammed kitchen that has not looked at the ticket is
              // not five minutes from serving it, and a countdown that lies is
              // worse than none.
              const from = o.status === "NEW" ? null : new Date(o.updated_at ?? o.created_at).getTime();
              // Narrowest wins: this ticket's own estimate, then the hotel's.
              const mins = o.eta_minutes ?? hotel?.prep_minutes ?? 20;
              const left = from ? Math.max(0, Math.ceil((from + mins * 60000 - now) / 60000)) : null;
              return (
                <div
                  key={o.id}
                  className={`mise-card-inset relative overflow-hidden rounded-2xl p-4 ${
                    o.status === "PREPARING" ? "mise-cooking" : ""
                  }`}
                >
                  {/* ── WAITING IS THE FEELING THIS PAGE HAS TO HANDLE ────────
                      "what about that updater area — like whenever we customer
                       ask or order, the notification is there nah, that area
                       still has old worst UI."

                      He is right, and it is the most important card on the page.
                      Everything else is browsing; this is the bit a person keeps
                      looking at while their food is somewhere they cannot see.

                      It was a raised slab with a label, a hint, and "0" over the
                      word "about" — which reads as nothing at all, and answers
                      the wrong question. A diner does not want a STATUS, they
                      want to know how far along their food is and roughly when
                      it lands. So: a journey with the current stop lit, a bar
                      that fills as the minutes go, and a countdown that says
                      what it is counting.

                      The stages are the diner's four, not the kitchen's seven —
                      REJECTED and CANCELLED are not steps on a journey, they are
                      the journey ending, and they get the plain message below
                      instead of a broken-looking track. */}
                  {(() => {
                    const STOPS = [
                      { key: "NEW", label: "Sent" },
                      { key: "CONFIRMED", label: "Accepted" },
                      { key: "PREPARING", label: "Cooking" },
                      { key: "READY", label: "On its way" },
                    ];
                    const at = STOPS.findIndex((s) => s.key === o.status);
                    const ended = o.status === "REJECTED" || o.status === "CANCELLED";
                    // How far through the promised wait we are. Only once the
                    // kitchen has accepted: before that there is nothing to
                    // measure against and a bar creeping along would be a
                    // promise nobody made.
                    // HOW LATE, NOT JUST HOW FAR.
                    //
                    // The bar clamped at 100% and the countdown clamped at 0,
                    // so an order five hours late rendered as a full bar over
                    // the word "any moment" — while the journey still showed
                    // "Cooking" unlit. A full bar above an unlit stop is
                    // self-contradictory, and it is the first thing the eye
                    // lands on. Telling a waiting diner "any moment" for the
                    // fifth hour is the fastest way to teach them to stop
                    // believing the screen.
                    const overdueBy =
                      from && mins > 0 ? Math.floor((now - (from + mins * 60000)) / 60000) : 0;
                    const late = overdueBy > 0;
                    const pct =
                      from && left !== null && mins > 0
                        ? Math.min(100, Math.max(0, ((mins - left) / mins) * 100))
                        : 0;
                    return (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`font-display text-lg font-bold leading-tight ${say.tone}`}>
                              {say.label}
                            </p>
                            <p className="mt-0.5 text-xs text-fg-soft">{say.hint}</p>
                          </div>
                          {o.status === "READY" ? (
                            <span aria-hidden className="shrink-0 text-3xl">🛎️</span>
                          ) : late ? (
                            /* Owned rather than hidden. A kitchen that is
                               behind is a fact the table already knows; saying
                               it plainly, and pointing at the button that
                               fetches a human, is the only version of this that
                               keeps their trust. */
                            <div className="shrink-0 text-right">
                              <p className="font-display text-lg font-bold leading-tight text-amber-500">
                                Running late
                              </p>
                              <p className="mt-0.5 text-[11px] text-fg-soft">
                                {overdueBy < 60
                                  ? `about ${overdueBy} min over`
                                  : "sorry — do ask us"}
                              </p>
                            </div>
                          ) : left !== null ? (
                            <div className="shrink-0 text-right">
                              {/* The unit and the hedge belong in one sentence
                                  under the number, not stacked into a column. */}
                              <p className="font-display text-3xl font-bold leading-none tabular-nums text-fg">
                                {left}
                              </p>
                              <p className="mt-0.5 text-[11px] text-fg-faint">
                                {left === 1 ? "min away" : "mins away"}
                              </p>
                            </div>
                          ) : (
                            /* JUST SENT. `from` is null until the kitchen
                               accepts, so this used to show no time at all —
                               the exact moment a diner most wants a number was
                               the one moment the card had none. The hotel's own
                               estimate is not a promise the kitchen has made
                               yet, so it is offered as the guide it is. */
                            <div className="shrink-0 text-right">
                              <p className="font-display text-3xl font-bold leading-none tabular-nums text-fg-soft">
                                ~{mins}
                              </p>
                              <p className="mt-0.5 text-[11px] text-fg-faint">mins, usually</p>
                            </div>
                          )}
                        </div>

                        {!ended && (
                          <>
                            <div
                              className="mt-3 h-1.5 overflow-hidden rounded-full bg-glass/10"
                              role="progressbar"
                              aria-valuenow={Math.round(pct)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label="How far along your order is"
                            >
                              <span
                                className={`block h-full rounded-full transition-[width] duration-1000 ${
                                  late
                                    ? "bg-amber-500"
                                    : "bg-gradient-to-r from-brand-500 to-brand-300"
                                }`}
                                style={{ width: `${o.status === "READY" || late ? 100 : pct}%` }}
                              />
                            </div>

                            <ol className="mt-2.5 flex items-center gap-1">
                              {STOPS.map((s, i) => {
                                const done = at >= 0 && i <= at;
                                const here = i === at;
                                return (
                                  <li key={s.key} className="flex flex-1 flex-col items-center gap-1">
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
                                      className={`text-[10px] leading-none ${
                                        here ? "font-bold text-fg" : "text-fg-faint"
                                      }`}
                                    >
                                      {s.label}
                                    </span>
                                  </li>
                                );
                              })}
                            </ol>
                          </>
                        )}

                        {o.items.length > 0 && (
                          <ul className="mt-3 space-y-1 border-t border-line/60 pt-2.5">
                            {o.items.map((i) => (
                              <li
                                key={`${o.id}-${i.name}`}
                                className="flex items-baseline gap-2 text-xs text-fg-soft"
                              >
                                <span className="font-bold tabular-nums text-brand-300">
                                  {i.quantity}×
                                </span>
                                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })}
          </section>
        )}

        {/* ── The menu. */}
        <div className="lg:order-1 lg:min-w-0">
        {cats.length > 0 && (
          <div className="mise-noscrollbar sticky top-[4.25rem] z-30 -mx-4 flex gap-2 overflow-x-auto bg-shell/85 px-4 py-3 backdrop-blur-xl lg:mx-0 lg:rounded-xl lg:px-3">
            {/* "All" first, because a diner arriving at a menu wants to SEE the
                menu — sending them to pick a course before anything appears is
                a decision demanded before they have the information to make
                it. */}
            <button
              type="button"
              onClick={() => setCat(null)}
              className={`mise-press shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                cat === null ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
              }`}
            >
              Everything
            </button>
            {cats.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCat((k) => (k === c.key ? null : c.key))}
                className={`mise-press shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  cat === c.key ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
                }`}
              >
                {c.label}
                <span className="ml-1 opacity-60">{c.n}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── THE MENU, AS A MENU ──────────────────────────────────────────
            "I personally don't like this UI bro, UI UX is very bad. This is a
             very very important page — this only will be first impression of
             the customer of that hotel... see raw UI bro, definitely we need to
             change, else customer will be disappointed."

            He is right about the stakes, and the diagnosis is the same one that
            fixed the admin menu: a printed menu has a SHAPE — starters, then
            mains, then desserts — and a flat alphabetical list throws it away.
            Every card then had to repeat its own course to make up for the
            ordering that discarded it.

            Three other things were costing this page its first impression:

            · the cards were raised slabs (`mise-card3d`) on a site that is
              inset everywhere else, so the one screen a customer sees was the
              one screen drawn in the old style;
            · "✨ What's in it, and what it does for you" was a full blue
              sentence on EVERY card — thirteen identical invitations shouting
              over the food. It is the dish's own row now, tapped from the name;
            · the photo was 64px. On a menu the photograph IS the selling, and a
              thumbnail the size of a favicon sells nothing.
        */}
        <div className="mt-1 space-y-6">
          {courses.map(([course, dishes]) => (
            <section key={course}>
              <div className="mb-2.5 flex items-baseline gap-2">
                <h2 className="font-display text-xl font-bold tracking-tight text-fg lg:text-2xl">
                  {course}
                </h2>
                <span aria-hidden className="h-px flex-1 bg-line" />
                <span className="text-[11px] tabular-nums text-fg-faint">{dishes.length}</span>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1800px]:grid-cols-5">
                {dishes.map((m) => {
                  const q = cart[m.id] ?? 0;
                  const off = m.orderable === false;
                  const src = m.has_photo
                    ? `${API_BASE}/api/public/order/menu-photo/${m.id}`
                    : dishPhoto(m.name);
                  return (
                    <li key={m.id}>
                      <article
                        className={`mise-card-inset flex h-full flex-col overflow-hidden rounded-2xl ${
                          off ? "opacity-70" : ""
                        }`}
                      >
                        {/* A WIDE PHOTO, not a thumbnail. This is the only
                            picture of the food a diner will ever see, and the
                            hotel's photo comes first, then the bundled library,
                            then the emoji — most kitchens will never get round
                            to uploading their own. */}
                        {src ? (
                          <button
                            type="button"
                            onClick={() => setTalk({ dish: { id: m.id, name: m.name } })}
                            aria-label={`More about ${m.name}`}
                            className="mise-press relative block aspect-[4/3] w-full overflow-hidden bg-glass/5"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                            <span
                              aria-hidden
                              className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
                            >
                              ✨ about this
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTalk({ dish: { id: m.id, name: m.name } })}
                            aria-label={`More about ${m.name}`}
                            className="mise-press grid aspect-[4/3] w-full place-items-center bg-glass/5 text-5xl"
                          >
                            {m.emoji ?? "🍽️"}
                          </button>
                        )}

                        <div className="flex min-w-0 flex-1 flex-col p-3">
                          <p className="font-display text-[15px] font-bold leading-tight text-fg">
                            {m.name}
                          </p>
                          {/* The line that sells the dish. */}
                          {m.description && (
                            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-soft">
                              {m.description}
                            </p>
                          )}

                          <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
                            <span className="font-display text-lg font-bold tabular-nums text-fg">
                              {money(m.price)}
                            </span>
                            {/* OFF THE MENU RIGHT NOW — said, not hidden. A dish
                                that silently disappears reads as "they don't do
                                that"; one that says "served 07:00–11:00" brings
                                them back tomorrow. */}
                            {off ? (
                              <span className="mise-tone-warn rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-medium">
                                {m.unavailable_reason ?? "Not available"}
                              </span>
                            ) : q === 0 ? (
                              <button
                                type="button"
                                onClick={() => bump(m.id, 1)}
                                className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white"
                              >
                                Add
                              </button>
                            ) : (
                              <span className="mise-well flex items-center gap-1 rounded-xl p-0.5">
                                <button
                                  type="button"
                                  onClick={() => bump(m.id, -1)}
                                  aria-label={`One less ${m.name}`}
                                  className="mise-press grid h-8 w-8 place-items-center rounded-lg text-fg-soft"
                                >
                                  −
                                </button>
                                <span className="w-6 text-center text-sm font-bold tabular-nums">
                                  {q}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => bump(m.id, 1)}
                                  aria-label={`One more ${m.name}`}
                                  className="mise-press grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"
                                >
                                  +
                                </button>
                              </span>
                            )}
                          </div>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        </div>

        {/* The running total moved into the hero, where it sits beside the
            other two facts about this table instead of hanging off the end of
            the filter row. */}
      </main>

      {talk && (
        <TableTalk code={code} dish={talk.dish} onClose={() => setTalk(null)} />
      )}

      {/* ── The basket, pinned. Never a page you have to go to.
             Pinned to the bottom on a phone, where thumbs are; and on a wide
             screen it stops being a bar across the foot of a 1900px window —
             which is a long way from the dish you just added — and sits in the
             rail beside the menu instead. Same component, placed where the eye
             already is. */}
      {count > 0 && (
        <div
          id="mise-table-basket"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-glass/10 bg-shell/90 p-3 backdrop-blur-xl"
        >
          <div className="mx-auto w-full max-w-[110rem] px-0 lg:px-8 2xl:px-12">
            {basketOpen && (
              <div className="mise-pop mb-2 max-h-[45vh] overflow-y-auto rounded-2xl">
                {lines.map((l) => (
                  <div
                    key={l.item.id}
                    className="flex items-center justify-between gap-3 border-b border-line/50 py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 truncate">
                      <b className="tabular-nums">{l.q}×</b> {l.item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-fg-soft">
                      {money(Number(l.item.price) * l.q)}
                    </span>
                  </div>
                ))}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything the kitchen should know? (no chilli, extra rice…)"
                  className="mise-well mt-2 w-full rounded-xl px-3 py-2 text-sm outline-none"
                />
              </div>
            )}
            {err && <p className="mb-2 text-center text-xs text-rose-300">{err}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBasketOpen((o) => !o)}
                className="mise-well mise-press shrink-0 rounded-2xl px-3.5 py-3 text-sm font-semibold"
              >
                {count} · {money(subtotal)}
              </button>
              <button
                type="button"
                onClick={place}
                disabled={placing || !!hotel?.paused}
                className="mise-press flex-1 rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {hotel?.paused
                  ? "The kitchen has paused orders"
                  : placing
                    ? "Sending to the kitchen…"
                    : "Send to the kitchen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
