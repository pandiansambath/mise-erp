"use client";

// Mise Copilot — the floating, project-aware assistant. Lives on every app page
// (mounted inside AppShell so it inherits the theme). It knows what page you're
// on, answers in plain English, reads your live numbers, and hands back direct
// links to the right screen. Backend: POST /assistant/chat.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Action = { label: string; href: string };
type ChatResponse = {
  reply: string;
  actions: Action[];
  used_tools: string[];
  configured: boolean;
};
type Msg = { role: "user" | "assistant"; content: string; actions?: Action[] };

const STARTERS = [
  "What's low on stock?",
  "How's this month's profit?",
  "What is slow stock?",
  "Where do I reorder?",
];

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi — I'm your Mise Copilot. Ask me about your stock, sales or profit, what anything means, or where to do something. I'll point you straight to it.",
};

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check once whether the smart LLM is switched on (just for a gentle hint).
  useEffect(() => {
    if (!open || configured !== null) return;
    api.get<{ configured: boolean }>("/assistant/status")
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, [open, configured]);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [messages, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const payload = {
        messages: history
          .filter((m) => m !== GREETING)
          .map((m) => ({ role: m.role, content: m.content })),
        route: pathname,
      };
      const res = await api.post<ChatResponse>("/assistant/chat", payload);
      setConfigured(res.configured);
      setMessages([
        ...history,
        { role: "assistant", content: res.reply, actions: res.actions },
      ]);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 401
          ? "Please sign in again to use the Copilot."
          : "Sorry — I couldn't reach the assistant just now. Please try again.";
      setMessages([...history, { role: "assistant", content: msg }]);
    } finally {
      setLoading(false);
    }
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ask Mise Copilot"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-2xl text-white shadow-xl shadow-brand-600/30 transition hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
      >
        <span aria-hidden>{open ? "✕" : "✨"}</span>
      </button>

      {/* Panel */}
      {open && (
        <div
          className="mise-pop fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col overflow-hidden rounded-t-2xl border border-glass/10 bg-paper-2/95 shadow-2xl shadow-black/50 backdrop-blur-xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:rounded-2xl"
          role="dialog"
          aria-label="Mise Copilot"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-glass/10 bg-paper-3/60 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 text-lg text-white">
              ✨
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-fg">Mise Copilot</p>
              <p className="text-[11px] text-fg-faint">
                {configured === false ? "Quick help & navigation" : "Your kitchen & books, asked"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="ml-auto rounded-lg p-1.5 text-fg-faint hover:bg-glass/5 hover:text-fg"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className="max-w-[85%]">
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "rounded-br-md bg-brand-600 text-white"
                        : "rounded-bl-md bg-paper-3 text-fg-soft"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.actions.map((a, j) => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => go(a.href)}
                          className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-500/20"
                        >
                          {a.label} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex gap-1.5 rounded-2xl rounded-bl-md bg-paper-3 px-4 py-3.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-fg-faint" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-fg-faint [animation-delay:0.2s]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-fg-faint [animation-delay:0.4s]" />
                </div>
              </div>
            )}

            {/* Starter chips — only before the first question */}
            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2 pt-1">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-glass/15 bg-paper-3/60 px-3 py-1.5 text-xs text-fg-soft transition hover:bg-glass/5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-glass/10 bg-paper-3/40 p-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your restaurant…"
              className="min-w-0 flex-1 rounded-xl border border-glass/15 bg-paper px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-faint focus:border-brand-500/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-40"
            >
              ↑
            </button>
          </form>
        </div>
      )}
    </>
  );
}
