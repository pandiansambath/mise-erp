"use client";

// Mise Copilot — the floating, project-aware assistant. Lives on every app page
// (mounted inside AppShell so it inherits the theme). It knows what page you're
// on, answers in plain English, reads your live numbers, hands back direct links
// to the right screen, AND onboards you from documents: attach a PDF/photo of
// your items or suppliers and it extracts them for you to confirm into the DB.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, postForm } from "@/lib/api";

type Action = { label: string; href: string };
type Row = Record<string, unknown>;
type Ingest = { kind: string; rows: Row[]; committed?: boolean; result?: string };
type ChatResponse = { reply: string; actions: Action[]; used_tools: string[]; configured: boolean };
type Msg = { role: "user" | "assistant"; content: string; actions?: Action[]; ingest?: Ingest };

const STARTERS = [
  "What's low on stock?",
  "How's this month's profit?",
  "What is slow stock?",
  "Where do I reorder?",
];

const KINDS: { key: string; label: string; icon: string }[] = [
  { key: "items", label: "Items / stock list", icon: "📦" },
  { key: "vendors", label: "Suppliers / vendors", icon: "🤝" },
];

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi — I'm your Mise Copilot. Ask me about your stock, sales or profit, what anything means, or where to do something. New here? Tap 📎 to upload a PDF or photo of your items or suppliers and I'll set them up for you.",
};

const kindLabel = (k: string) => (k === "vendors" ? "suppliers" : "items");

function rowSummary(kind: string, r: Row): string {
  if (kind === "vendors") {
    return [r.category, r.mobile, r.email].filter(Boolean).join(" · ") || "supplier";
  }
  const bits = [r.unit && `${r.current_stock ?? ""} ${r.unit}`.trim(), r.category, r.cost_price && `£${r.cost_price}`];
  return bits.filter(Boolean).join(" · ") || "item";
}

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<string>("items");

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

  function push(m: Msg) {
    setMessages((prev) => [...prev, m]);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const payload = {
        messages: history.filter((m) => m !== GREETING).map((m) => ({ role: m.role, content: m.content })),
        route: pathname,
      };
      const res = await api.post<ChatResponse>("/assistant/chat", payload);
      setConfigured(res.configured);
      push({ role: "assistant", content: res.reply, actions: res.actions });
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 401
          ? "Please sign in again to use the Copilot."
          : "Sorry — I couldn't reach the assistant just now. Please try again.";
      push({ role: "assistant", content: msg });
    } finally {
      setLoading(false);
    }
  }

  function chooseKind(kind: string) {
    kindRef.current = kind;
    setAttachOpen(false);
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file || loading) return;
    const kind = kindRef.current;
    push({ role: "user", content: `📎 ${file.name}` });
    setLoading(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await postForm<{ kind: string; rows: Row[] }>("/assistant/ingest", form);
      if (!res.rows.length) {
        push({ role: "assistant", content: `I couldn't find any ${kindLabel(kind)} in that file. Try a clearer PDF, a photo, or a CSV.` });
      } else {
        push({
          role: "assistant",
          content: `I read ${res.rows.length} ${kindLabel(kind)} from “${file.name}”. Review and confirm — nothing is saved until you do.`,
          ingest: { kind, rows: res.rows },
        });
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 503
          ? "Document reading needs the AI switched on (a Gemini key)."
          : err instanceof ApiError && err.status === 403
            ? "You don't have permission to add those records."
            : "Sorry — I couldn't read that file. Please try again.";
      push({ role: "assistant", content: msg });
    } finally {
      setLoading(false);
    }
  }

  async function commitIngest(index: number) {
    const msg = messages[index];
    if (!msg.ingest || loading) return;
    const { kind, rows } = msg.ingest;
    setLoading(true);
    try {
      const res = await api.post<{ created: string[]; skipped: string[] }>("/assistant/ingest/commit", { kind, rows });
      const created = res.created.length;
      const skipped = res.skipped.length;
      const summary =
        `Added ${created} ${kindLabel(kind)}` +
        (skipped ? ` · skipped ${skipped} (already existed)` : "") + ".";
      setMessages((prev) =>
        prev.map((m, i) => (i === index ? { ...m, ingest: { ...m.ingest!, committed: true, result: summary } } : m)),
      );
      push({
        role: "assistant",
        content: summary,
        actions: [{ label: kind === "vendors" ? "Open Vendors" : "Open Inventory", href: kind === "vendors" ? "/vendors" : "/inventory" }],
      });
    } catch {
      push({ role: "assistant", content: "Sorry — I couldn't save those just now. Please try again." });
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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ask Mise Copilot"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-2xl text-white shadow-xl shadow-brand-600/30 transition hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
      >
        <span aria-hidden>{open ? "✕" : "✨"}</span>
      </button>

      {open && (
        <div
          className="mise-pop fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col overflow-hidden rounded-t-2xl border border-glass/10 bg-paper-2/95 shadow-2xl shadow-black/50 backdrop-blur-xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:rounded-2xl"
          role="dialog"
          aria-label="Mise Copilot"
        >
          <div className="flex items-center gap-2.5 border-b border-glass/10 bg-paper-3/60 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 text-lg text-white">✨</span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-fg">Mise Copilot</p>
              <p className="text-[11px] text-fg-faint">{configured === false ? "Quick help & navigation" : "Your kitchen & books, asked"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto rounded-lg p-1.5 text-fg-faint hover:bg-glass/5 hover:text-fg">✕</button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className="max-w-[85%]">
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-paper-3 text-fg-soft"
                    }`}
                  >
                    {m.content}
                  </div>

                  {/* Onboarding preview card */}
                  {m.ingest && (
                    <div className="mt-2 rounded-xl border border-glass/15 bg-paper-3/70 p-2.5">
                      <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                        {m.ingest.rows.map((r, j) => (
                          <div key={j} className="rounded-lg bg-paper/60 px-2.5 py-1.5 text-xs">
                            <span className="font-medium text-fg">{String(r.name ?? "—")}</span>
                            <span className="text-fg-faint"> — {rowSummary(m.ingest!.kind, r)}</span>
                          </div>
                        ))}
                      </div>
                      {m.ingest.committed ? (
                        <p className="mt-2 px-1 text-xs font-medium text-brand-300">✓ {m.ingest.result}</p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => commitIngest(i)}
                          disabled={loading}
                          className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-40"
                        >
                          Add {m.ingest.rows.length} {kindLabel(m.ingest.kind)}
                        </button>
                      )}
                    </div>
                  )}

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

            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2 pt-1">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-glass/15 bg-paper-3/60 px-3 py-1.5 text-xs text-fg-soft transition hover:bg-glass/5">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="relative flex items-center gap-2 border-t border-glass/10 bg-paper-3/40 p-3"
          >
            {/* Attach / onboarding */}
            <input ref={fileRef} type="file" accept="application/pdf,image/*,.csv" onChange={onFile} className="hidden" />
            {attachOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} aria-hidden />
                <div className="mise-pop absolute bottom-14 left-3 z-20 w-56 rounded-xl border border-glass/10 bg-paper-2/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
                  <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-fg-faint">What&apos;s in this file?</p>
                  {KINDS.map((k) => (
                    <button key={k.key} type="button" onClick={() => chooseKind(k.key)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-fg-soft hover:bg-glass/5">
                      <span aria-hidden>{k.icon}</span> {k.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setAttachOpen((o) => !o)}
              aria-label="Attach a document"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-glass/15 text-lg text-fg-soft transition hover:bg-glass/5"
            >
              📎
            </button>
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
