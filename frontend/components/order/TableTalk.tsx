"use client";

// 💬 THE TABLE TALKS BACK — a message to the kitchen, and an assistant to ask.
//
//   "customer sitting in table can also msg using that QR in that same menu
//    page itself... have some suggestions here so that customer no need to type."
//   "have our Sonnet AI also here, so that customer can ask any details abt this
//    hotel — what's so special, what famous, branches, origin, contact."
//   "touch me ai to see whats are all health benefits u will get if u eat this...
//    it need to say honestly. This itself is the master feature."
//
// Two jobs in one sheet because they are the same instinct — the diner wants
// something and the alternative is waving at a passing waiter.
//
// The chips matter more than the box. Most people will not type on a phone in a
// restaurant with a drink in their other hand, so the five things anybody
// actually asks for are one tap away, and the keyboard is the fallback.
import { useState, useMemo, useEffect, useRef } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { API_BASE } from "@/lib/api";

const ASKS = [
  "More water, please",
  "Some napkins",
  "Could we get the bill?",
  "A bit less spicy, please",
  "A highchair, please",
  "Cutlery, please",
];

const QUESTIONS = [
  "What is this place known for?",
  "Do you have other branches?",
  "What do you recommend today?",
  "How do I contact you?",
];

/** One exchange, and the dish it was about.
 *
 *  `topic` is the dish the sheet was opened from when the question was asked,
 *  or null for a general one. It is what stops the Chettinad sheet opening on
 *  an answer about dosa — see `TableMessage.topic` on the server, and the
 *  split into `scoped` / `earlier` in the component.
 */
type Turn = { me: string; ai: string; topic?: string | null };

/** What to offer next, given what has already been said.
 *
 *   "that suggestion is disappeared after I clicked 1 — why? Please show
 *    suggestions based on what user is clicking."
 *
 * They were rendered behind `chat.length === 0`, so the moment somebody used
 * one they all went, and the conversation dead-ended at a bare text box. A
 * diner who liked the first answer is exactly the person most likely to ask a
 * second question, and that is the moment we stopped helping.
 *
 * The follow-ups are drawn from the ANSWER rather than a fixed list, and the
 * trick is that the model already marks what matters: it bolds dish names.
 * `**Masala Dosa**` in the reply becomes "What's in the Masala Dosa?" as the
 * next chip — so the conversation follows the food it just recommended instead
 * of looping back to "How do I contact you?".
 *
 * Anything already asked is dropped, so the chips move forward rather than
 * offering the question just answered.
 */
function nextSuggestions(
  chat: Turn[],
  dish?: { id: string; name: string } | null,
): string[] {
  const asked = new Set(chat.map((c) => c.me.trim().toLowerCase()));
  const out: string[] = [];

  // 1. Dishes the last answer actually named — the model bolds them.
  //
  //    ONLY WHEN THAT ANSWER BELONGS HERE.
  //
  //      "I clicked Chettinad but the suggestions are showing for Masala Dosa
  //       ... user should not feel this confusing."
  //
  //    `chat` is the whole table's history now that it persists, so the last
  //    answer in it is frequently about a completely different dish — and its
  //    bolded names became this sheet's follow-ups. Opening the Chettinad card
  //    offered "Is the Masala Dosa spicy?" as the first chip, which is not a
  //    follow-up to anything the diner just did.
  //
  //    A dish-scoped sheet only mines answers about ITS dish. The rest of the
  //    history is still there to read; it just does not get to write the
  //    questions.
  const inScope = dish
    ? chat.filter((c) => (c.topic ?? "") === dish.name)
    : chat;
  const last = inScope[inScope.length - 1]?.ai ?? "";
  const named = [...last.matchAll(/\*\*([^*\n]{2,40}?)\*\*/g)]
    .map((m) => m[1].trim().replace(/[.,:;!?]$/, ""))
    // A price or a number in bold is not a dish.
    .filter((n) => /[a-z]/i.test(n) && !/^[£$€₹]/.test(n))
    .slice(0, 2);
  for (const n of named) {
    out.push(`What's in the ${n}?`, `Is the ${n} spicy?`);
  }

  // 2. The dish this was opened from, if any.
  if (dish) {
    out.push(
      `What's in the ${dish.name}?`,
      `Is the ${dish.name} light or rich?`,
      `What goes well with the ${dish.name}?`,
    );
  }

  // 3. The standing ones, so there is always something to press — but NOT on
  //    a dish sheet that already has three of its own. "What is this place
  //    known for?" as the fourth chip under "About Chicken Chettinad" reads as
  //    the assistant losing the thread, and the text box and the other tab are
  //    both right there for anything else.
  if (!dish) {
    out.push(...QUESTIONS, "Anything vegetarian?", "What's your spiciest dish?");
  }

  const seen = new Set<string>();
  return out
    .filter((q) => {
      const k = q.trim().toLowerCase();
      if (asked.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);
}

/** The dishes an answer actually named, matched against the real menu.
 *
 *  The model bolds dish names, which is the same signal the follow-up chips
 *  use. Matched case-insensitively against the menu rather than trusted: the
 *  assistant occasionally bolds a phrase that is not a dish, and offering an
 *  Add button for something that does not exist would be worse than offering
 *  nothing. Unorderable dishes are dropped too — "sold out" is not a thing to
 *  put a buy button on.
 */
function namedDishes(
  answer: string,
  menu: { id: string; name: string; price: string; orderable?: boolean }[],
): { id: string; name: string; price: string }[] {
  const bolded = [...answer.matchAll(/\*\*([^*\n]{2,60}?)\*\*/g)].map((m) =>
    m[1].trim().replace(/[.,:;!?]$/, "").toLowerCase(),
  );
  const out: { id: string; name: string; price: string }[] = [];
  const seen = new Set<string>();
  for (const b of bolded) {
    const hit = menu.find((x) => x.name.toLowerCase() === b);
    if (hit && hit.orderable !== false && !seen.has(hit.id)) {
      seen.add(hit.id);
      out.push({ id: hit.id, name: hit.name, price: hit.price });
    }
  }
  return out.slice(0, 3);
}

/** One question and its answer.
 *
 *  Pulled out of the tab because it is now rendered in two places: the
 *  conversation about the dish you opened, and the table's earlier questions
 *  folded above it. Two copies of a bubble is exactly how the ✨ marker and the
 *  currency note went missing before — fixed in one place, still wrong in the
 *  other.
 *
 *  THE ANSWER IS THE PRODUCT HERE.
 *
 *    "this chat UI also not nice — this single page will fetch so many clients
 *     for us indirectly, so build like a premium one."
 *
 *  The reply used to be a grey raised slab with a tail: a speech bubble from a
 *  support widget. But this is the restaurant talking about its own food, and
 *  it is the most impressive thing on the page — a stranger asking "what do you
 *  recommend?" and getting a considered answer about the actual menu. It reads
 *  as a served plate now: the house mark beside it, generous line height, and
 *  the dish names the model bolds carrying real weight.
 */
function Exchange({
  turn,
  menu,
  onAdd,
  added,
  setAdded,
}: {
  turn: Turn;
  menu: { id: string; name: string; price: string; orderable?: boolean }[];
  onAdd?: (id: string) => void;
  added: Set<string>;
  setAdded: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const named = onAdd ? namedDishes(turn.ai, menu) : [];
  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm">
        {turn.me}
      </p>
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-400 text-xs text-white"
        >
          ✦
        </span>
        <div className="mise-card-inset mr-auto w-fit max-w-[92%] rounded-2xl rounded-tl-md px-3.5 py-3 text-[15px] leading-relaxed text-fg [&_strong]:font-bold [&_strong]:text-brand-300">
          {/* It replies in markdown. This used to print the raw text, so a
              diner read literal ** around every bolded word — on the one
              screen a stranger ever sees. */}
          <ChatMarkdown text={turn.ai} />
          {/* Act on it here — see `namedDishes`. Without this the assistant
              could recommend the Mutton Biryani and the only way to accept was
              to close the sheet, scroll the menu and find it again. */}
          {named.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line/60 pt-2.5">
              {named.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    onAdd?.(d.id);
                    setAdded((s) => new Set(s).add(d.id));
                  }}
                  data-testid="ai-add"
                  className="mise-press rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {added.has(d.id) ? `✓ Added ${d.name}` : `Add ${d.name}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TableTalk({
  code,
  dish,
  menu = [],
  onAdd,
  onClose,
}: {
  code: string;
  /** When opened from a dish, the assistant is grounded in that dish.
   *  `photo` is whatever the card was showing — the hotel's own picture or
   *  the bundled stand-in — so the sheet opens on the plate that was
   *  tapped rather than on its name in bold. */
  dish?: { id: string; name: string; photo?: string | null } | null;
  /** The orderable menu, so a dish the assistant names can be added here.
   *
   *  THE BIGGEST MISS ON A PAGE WHOSE JOB IS TAKING AN ORDER. The assistant
   *  would answer "the Mutton Biryani at £14.95 is a solid choice" and there
   *  was no way to act on it: you closed the sheet, scrolled the menu, found
   *  the dish again and pressed Add. Every one of those steps is a chance to
   *  not bother. A recommendation you cannot accept is a conversation, not a
   *  waiter. */
  menu?: { id: string; name: string; price: string; orderable?: boolean }[];
  onAdd?: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"ask" | "ai">(dish ? "ai" : "ask");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  // THE CONVERSATION, BOTH WAYS.
  //
  //   "if customer send msg I can't able to see the reply or the persistent
  //    history of that time. Please show previous msg too until this table
  //    is cleared — it should be interactive between both."
  //
  // "Sent — someone is on their way" was the whole of the diner's side: a
  // receipt for a message they could no longer see, with no way to know it
  // had been read and nothing to show they had already asked twice. Now the
  // tab IS the thread.
  const [thread, setThread] = useState<{ id: string; body: string; from_staff: boolean }[]>([]);
  useEffect(() => {
    if (tab !== "ask") return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/public/table/${code}/messages`);
        if (!r.ok) return;
        const d = await r.json();
        if (!stop) setThread(d.messages ?? []);
      } catch {
        /* a dropped poll is not worth telling a diner about */
      }
    };
    void load();
    // Slow enough to be free, quick enough that a reply feels answered. The
    // page is open on a phone at a table, not a dashboard on a wall.
    const id = window.setInterval(load, 6000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [tab, code]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  // Each turn remembers WHICH DISH it was about, so a dish-scoped sheet can
  // open on its own conversation. See `scoped`/`earlier` below.
  const [chat, setChat] = useState<Turn[]>([]);
  // THE ASSISTANT'S CONVERSATION SURVIVES THE POPUP.
  //
  //   "if I close and open, it's not showing the previous history... make
  //    the history persistent until owner clear that table."
  //
  // It lived only in `chat` state, so it died the moment the sheet closed —
  // and closing the sheet is exactly what a diner does when the answer names
  // a dish they want to go and look at. Loaded from the table's AI thread on
  // open; the server keeps it until the table is released.
  const [loadedAi, setLoadedAi] = useState(false);
  // Which of the assistant's suggestions have been taken, so the button
  // confirms rather than looking unpressed.
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (tab !== "ai" || loadedAi) return;
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/public/table/${code}/messages?channel=ai`);
        if (!r.ok) return;
        const d = await r.json();
        const rows: { body: string; from_staff: boolean; topic?: string | null }[] =
          d.messages ?? [];
        // Stored as alternating question/answer rows; the UI pairs them. The
        // topic rides on the question — the answer's copy is the same value.
        const pairs: Turn[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].from_staff) continue;
          const reply = rows[i + 1]?.from_staff ? rows[i + 1].body : "";
          pairs.push({ me: rows[i].body, ai: reply, topic: rows[i].topic ?? null });
        }
        if (!stop && pairs.length) setChat(pairs);
      } catch {
        /* an unreachable history is not worth an error on a menu */
      } finally {
        if (!stop) setLoadedAi(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, [tab, code, loadedAi]);
  // Recomputed after every answer, so the chips move with the
  // conversation instead of vanishing after the first press.
  const suggestions = useMemo(() => nextSuggestions(chat, dish), [chat, dish]);

  // ── HISTORY WITHOUT THE CONFUSION ────────────────────────────────────────
  //
  //   "I clicked Chettinad but the suggestions are showing for Masala Dosa...
  //    user should not feel this confusing — but still we need to show history,
  //    don't compromise history for this. We need history without that
  //    confusion."
  //
  // Persistence landed flat: one thread per table, replayed identically
  // whichever dish you opened it from. So the Chettinad sheet's last line was
  // an answer about dosa, sitting exactly where a reply to the tap you just
  // made would sit — the page appeared to have misheard.
  //
  // The two requirements are not opposed. A dish sheet opens on ITS dish; the
  // rest of the table's conversation is one tap above it, labelled, and
  // nothing is thrown away. A sheet opened from the header has no dish, so
  // there is nothing to separate and the whole thread reads straight through.
  const scoped = useMemo(
    () => (dish ? chat.filter((c) => (c.topic ?? "") === dish.name) : chat),
    [chat, dish],
  );
  const earlier = useMemo(
    () => (dish ? chat.filter((c) => (c.topic ?? "") !== dish.name) : []),
    [chat, dish],
  );
  const [showEarlier, setShowEarlier] = useState(false);
  // So the send control can hand focus to the box rather than sit greyed.
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(message: string) {
    if (!message.trim()) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/public/table/${code}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.trim() }),
      });
      setSent(true);
      setText("");
      setText("");
      window.setTimeout(onClose, 1400);
    } finally {
      setBusy(false);
    }
  }

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setQ("");
    try {
      const r = await fetch(`${API_BASE}/api/public/table/${code}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), dish_id: dish?.id ?? null }),
      });
      const d = await r.json();
      // Filed under this sheet's dish, matching what the server stored,
      // so it stays in scope without a reload.
      setChat((c) => [
        ...c,
        { me: question.trim(), ai: d.answer ?? "…", topic: dish?.name ?? null },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          me: question.trim(),
          ai: "I could not reach the assistant just then.",
          topic: dish?.name ?? null,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="mise-pop flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-shell shadow-2xl sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-3xl">
        {/* A header that says where you are. The old sheet opened straight onto
            two tabs and a wall of chips, which reads as a settings panel rather
            than a conversation. */}
        <div className="flex items-start gap-3 px-4 pt-4">
          {/* The dish you tapped, at the top of the conversation about it.
              A 44px well with a sparkle in it is the avatar of a support
              widget; the actual plate is the difference between a dialog and
              a waiter leaning in. */}
          {tab === "ai" && dish?.photo ? (
            /* 56px, not 44. It is the dish the whole sheet is about; at
               icon size on a 672px panel it read as a favicon. */
            <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-glass/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dish.photo} alt="" className="h-full w-full object-cover" />
            </span>
          ) : (
            <span
              aria-hidden
              className="mise-well grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg"
            >
              {tab === "ai" ? "✨" : "💬"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold leading-tight text-fg">
              {tab === "ai" ? (dish ? dish.name : "Ask about the food") : "Ask for something"}
            </p>
            <p className="text-[11px] text-fg-faint">
              {tab === "ai"
                ? dish
                  ? "What's in it, and what it does for you"
                  : "The place, the menu, the hours"
                : "It goes straight to the counter"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg-faint hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3">
          <div className="mise-well flex rounded-xl p-0.5">
            {(["ask", "ai"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`mise-press rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  tab === k ? "bg-brand-600 text-white" : "text-fg-faint"
                }`}
              >
                {k === "ask" ? "Ask for something" : "About the food"}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {tab === "ask" ? (
            <>
              {thread.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {thread.map((mm) => (
                    <li key={mm.id} className="flex">
                      {mm.from_staff ? (
                        <span className="mise-card-inset mr-auto w-fit max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2 text-sm text-fg">
                          {mm.body}
                        </span>
                      ) : (
                        <span className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white">
                          {mm.body}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {/* The receipt is a line in the thread now, not a screen that
                  replaces it — so you can see what you asked while you wait. */}
              {sent && thread.length === 0 && (
                <p className="mb-3 text-center text-sm font-medium text-brand-300">
                  Sent — someone is on their way.
                </p>
              )}
              {(
              <>
                <p className="mb-2 text-[11px] text-fg-faint">
                  Tap one, or write your own. It goes straight to the counter.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ASKS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={busy}
                      onClick={() => send(a)}
                      className="mise-press mise-card-inset rounded-full px-3.5 py-2 text-xs font-medium text-fg-soft transition hover:text-fg disabled:opacity-50"
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send(text)}
                    placeholder="Something else…"
                    className="mise-well min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !text.trim()}
                    onClick={() => send(text)}
                    className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </>
            )}
            </>
          ) : (
            <>
              {/* ── WHAT WAS SAID BEFORE, WITHOUT IT ANSWERING FOR YOU ──────
                  See the note on `scoped`/`earlier`. The table's other
                  conversations are kept and labelled, one tap up, instead of
                  being replayed underneath a dish they were not about. */}
              {earlier.length > 0 && (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => setShowEarlier((v) => !v)}
                    aria-expanded={showEarlier}
                    className="mise-press mise-well flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left"
                  >
                    <span aria-hidden className="text-sm">🕘</span>
                    <span className="min-w-0 flex-1 text-xs font-medium text-fg-soft">
                      {showEarlier ? "Hide earlier questions" : "Earlier at this table"}
                      <span className="ml-1.5 rounded-full bg-glass/15 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-faint">
                        {earlier.length}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={`text-[10px] text-fg-faint transition-transform ${
                        showEarlier ? "rotate-180" : ""
                      }`}
                    >
                      ▾
                    </span>
                  </button>
                  {showEarlier && (
                    <div className="mt-2 space-y-3 border-l-2 border-line pl-3">
                      {earlier.map((c, i) => (
                        <Exchange
                          key={`e${i}`}
                          turn={c}
                          menu={menu}
                          onAdd={onAdd}
                          added={added}
                          setAdded={setAdded}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Only when it is actually SEPARATING something. The header
                  three lines up already says "Chicken Chettinad", so on a
                  sheet with nothing folded above it this divider printed the
                  dish name a second time and divided one thing from nothing. */}
              {dish && earlier.length > 0 && showEarlier && (
                <div className="mb-2 flex items-center gap-2">
                  <span aria-hidden className="h-px flex-1 bg-line" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                    Now — {dish.name}
                  </p>
                  <span aria-hidden className="h-px flex-1 bg-line" />
                </div>
              )}

              {/* An empty scope needs an opening line, or a dish nobody has
                  asked about yet opens on a bare row of chips under a divider,
                  which reads as a form rather than a conversation. */}
              {scoped.length === 0 && !busy && (
                <p className="mb-3 text-sm leading-relaxed text-fg-soft">
                  {dish
                    ? `Ask me anything about the ${dish.name} — what's in it, how hot it is, what it goes with.`
                    : "Ask me about the food, the place, or what to have."}
                </p>
              )}

              <div className="space-y-3">
                {scoped.map((c, i) => (
                  <Exchange
                    key={i}
                    turn={c}
                    menu={menu}
                    onAdd={onAdd}
                    added={added}
                    setAdded={setAdded}
                  />
                ))}
                {busy && (
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-400 text-xs text-white"
                    >
                      ✦
                    </span>
                    <div className="mise-card-inset mr-auto flex w-fit items-center gap-1.5 rounded-2xl rounded-tl-md px-3.5 py-3">
                      {[0, 1, 2].map((d) => (
                        <span
                          key={d}
                          aria-hidden
                          className="mise-typing h-1.5 w-1.5 rounded-full bg-fg-faint"
                          style={{ animationDelay: `${d * 160}ms` }}
                        />
                      ))}
                      <span className="sr-only">thinking</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── BELOW THE ANSWER, WHICH IS WHERE "WHAT NEXT" LIVES ──────
                  These sat ABOVE the conversation, so chips generated FROM an
                  answer appeared above the question that produced it and the
                  eye had to travel backwards to find them. A follow-up reads
                  as a follow-up only when it follows. */}
              {suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => ask(s)}
                      className="mise-press mise-well rounded-full px-3 py-2 text-xs text-fg-soft transition hover:text-fg disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Pinned, not scrolled away with the conversation. A composer
                  that leaves the screen as the answers grow is the reason
                  people give up on a chat after two questions. */}
              <div className="sticky bottom-0 -mx-4 mt-3 border-t border-line/60 bg-shell px-4 pb-1 pt-3">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && ask(q)}
                    placeholder={
                      dish ? `Ask about the ${dish.name}…` : "Ask about the food or the place…"
                    }
                    className="mise-well min-w-0 flex-1 rounded-full px-4 py-3 text-sm outline-none"
                  />
                  {/* A round send, not a word.
                      The old "Ask" button spent its whole life greyed out —
                      the box starts empty, so the FIRST thing a diner saw was
                      a disabled button, which reads as a broken screen rather
                      than as "type something". An arrow is visibly waiting for
                      input in a way a dimmed verb is not. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // NOT DISABLED WHEN EMPTY — it puts the cursor in the
                      // box instead. Replacing a permanently-greyed "Ask" word
                      // with a permanently-greyed arrow changed the shape and
                      // kept the fault: the first thing a diner sees on this
                      // sheet should not look broken. Pressing it when there
                      // is nothing to send now does the only useful thing.
                      if (!q.trim()) return inputRef.current?.focus();
                      ask(q);
                    }}
                    aria-label="Ask"
                    className="mise-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition disabled:opacity-60"
                  >
                    <span aria-hidden className="text-lg leading-none">↑</span>
                  </button>
                </div>
                {/* Said plainly, because a guest deserves to know what they are
                    talking to and what it is allowed to know. */}
                <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                  Answers come from this restaurant&apos;s own menu. For anything about
                  allergies, please ask a member of staff.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
