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
import { useState } from "react";
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

export function TableTalk({
  code,
  dish,
  onClose,
}: {
  code: string;
  /** When opened from a dish, the assistant is grounded in that dish. */
  dish?: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"ask" | "ai">(dish ? "ai" : "ask");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [chat, setChat] = useState<{ me: string; ai: string }[]>([]);

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
      setChat((c) => [...c, { me: question.trim(), ai: d.answer ?? "…" }]);
    } catch {
      setChat((c) => [
        ...c,
        { me: question.trim(), ai: "I could not reach the assistant just then." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="mise-pop w-full max-w-lg overflow-hidden rounded-t-3xl bg-shell sm:rounded-3xl">
        <div className="flex items-center gap-2 border-b border-line/60 px-4 py-3">
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
                {k === "ask" ? "💬 Ask for something" : "✨ Ask about the food"}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-8 w-8 place-items-center rounded-full text-fg-faint"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70dvh] overflow-y-auto p-4">
          {tab === "ask" ? (
            sent ? (
              <p className="py-8 text-center text-sm font-medium text-brand-300">
                Sent — someone is on their way.
              </p>
            ) : (
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
                      className="mise-press mise-well rounded-full px-3 py-2 text-xs text-fg-soft disabled:opacity-50"
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
            )
          ) : (
            <>
              {dish && (
                <p className="mise-tone-info mb-2 text-xs font-medium">About {dish.name}</p>
              )}
              {chat.length === 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(dish
                    ? [
                        `What's in the ${dish.name}?`,
                        `Is the ${dish.name} light or rich?`,
                        `What goes well with the ${dish.name}?`,
                      ]
                    : QUESTIONS
                  ).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => ask(s)}
                      className="mise-press mise-well rounded-full px-3 py-2 text-xs text-fg-soft disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                {chat.map((c, i) => (
                  <div key={i}>
                    <p className="text-right text-xs text-fg-faint">{c.me}</p>
                    <p className="mise-card3d mt-1 p-3 text-sm leading-relaxed text-fg">{c.ai}</p>
                  </div>
                ))}
                {busy && <p className="text-center text-xs text-fg-faint">thinking…</p>}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ask(q)}
                  placeholder="Ask about the food or the place…"
                  className="mise-well min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                />
                <button
                  type="button"
                  disabled={busy || !q.trim()}
                  onClick={() => ask(q)}
                  className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Ask
                </button>
              </div>
              {/* Said plainly, because a guest deserves to know what they are
                  talking to and what it is allowed to know. */}
              <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                Answers come from this restaurant&apos;s own menu and information. For anything
                about allergies, please ask a member of staff.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
