"use client";

// The operator's assistant — the one AI in DineAI that sees across hotels.
//
// Kept visually distinct from the hotel Copilot on purpose. Two assistants that
// look identical but have different blast radii is how someone eventually asks
// the wrong one a question they shouldn't.

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

const OPENERS = [
  "Which hotels need attention?",
  "Who's spending most on AI?",
  "Any trials ending soon?",
  "How is the platform doing overall?",
];

type Turn = { who: "me" | "ai"; text: string };

export function OperatorAI() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { who: "me", text }]);
    try {
      const r = await api.post<{ reply: string }>("/platform/ai/ask", { question: text });
      setTurns((t) => [...t, { who: "ai", text: r.reply }]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          who: "ai",
          text: e instanceof ApiError ? e.message : "Couldn't reach the assistant.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-500/[0.06] to-transparent">
      <div className="flex items-center gap-2.5 border-b border-amber-400/15 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-xs text-black">
          ✦
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Operator assistant</h2>
          <p className="text-[11px] text-white/40">
            Sees every hotel&apos;s plan, billing and AI spend — never their recipes or books
          </p>
        </div>
      </div>

      <div className="px-4 py-3">
        {turns.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {OPENERS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => ask(o)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:border-amber-400/40 hover:text-amber-200"
              >
                {o}
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i} className={t.who === "me" ? "text-right" : ""}>
                <span
                  className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                    t.who === "me"
                      ? "bg-amber-500/20 text-amber-100"
                      : "border border-white/10 bg-white/[0.04] text-white/85"
                  }`}
                >
                  {t.text}
                </span>
              </div>
            ))}
            {busy && <p className="text-xs text-white/40">Thinking…</p>}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about the platform…"
            className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/40"
          />
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-40"
          >
            Ask
          </button>
        </form>
      </div>
    </section>
  );
}
