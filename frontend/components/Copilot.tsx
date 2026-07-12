"use client";

// Mise Copilot — the project-aware AI, on every page (mounted in AppShell so it
// inherits the theme). It explains things, reads your live numbers, links you
// straight to the right screen, ONBOARDS you from documents, reads bills/photos,
// and can DO things (add an expense/sale/item/supplier) — always behind a
// "here's what I'll do" confirmation, with one-tap Undo.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, postForm } from "@/lib/api";
import { speak, speechOutputSupported, stopSpeaking, useVoiceInput } from "@/lib/useVoice";
import ChefMascot from "@/components/auth/ChefMascot";

type Action = { label: string; href: string };
type Row = Record<string, unknown>;
type Pending = {
  kind: string; label: string; summary: string; fields: Row;
  done?: boolean; result?: string; undo?: { type: string; id: string }; undone?: boolean; busy?: boolean;
};
type Ingest = { kind: string; rows: Row[]; committed?: boolean; result?: string };
type ChatResponse = {
  reply: string; actions: Action[]; pending_actions: Pending[]; used_tools: string[]; configured: boolean;
};
type Msg = {
  role: "user" | "assistant"; content: string;
  actions?: Action[]; pending?: Pending[]; ingest?: Ingest; image?: string;
};

const STARTERS = ["What's low on stock?", "How's this month's profit?", "Add a £40 gas expense", "What is slow stock?"];

// The name the user gave at onboarding — so the Copilot addresses them by it.
const userName = (): string | undefined => {
  try {
    return localStorage.getItem("mise.user.name") || undefined;
  } catch {
    return undefined;
  }
};

const ATTACH = [
  { mode: "ingest:items", icon: "📦", label: "Items / stock list" },
  { mode: "ingest:vendors", icon: "🤝", label: "Suppliers list" },
  { mode: "chat:receipt", icon: "🧾", label: "Bill / receipt" },
  { mode: "chat:photo", icon: "🖼️", label: "Photo / other" },
];

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi — I'm your Mise Copilot. Ask about your stock, sales or profit, tell me to add something (“log a £40 gas bill”), or tap 📎 to upload an items list, a supplier list, or a bill/receipt and I'll handle it.",
};

const kindLabel = (k: string) => (k === "vendors" ? "suppliers" : "items");

function rowSummary(kind: string, r: Row): string {
  if (kind === "vendors") return [r.category, r.mobile, r.email].filter(Boolean).join(" · ") || "supplier";
  const bits = [r.unit && `${r.current_stock ?? ""} ${r.unit}`.trim(), r.category, r.cost_price && `£${r.cost_price}`];
  return bits.filter(Boolean).join(" · ") || "item";
}

const readAsBase64 = (file: File) =>
  new Promise<{ dataUrl: string; base64: string; mime: string }>((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const dataUrl = String(fr.result);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] ?? "", mime: file.type || "application/octet-stream" });
    };
    fr.readAsDataURL(file);
  });

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const speechBase = useRef("");
  const voice = useVoiceInput((t) =>
    setInput((speechBase.current ? speechBase.current + " " : "") + t)
  );
  const ttsSupported = speechOutputSupported();
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<string>("ingest:items");
  const sendRef = useRef<(t: string) => void>(() => {});

  useEffect(() => {
    if (!open || configured !== null) return;
    api.get<{ configured: boolean }>("/assistant/status").then((r) => setConfigured(r.configured)).catch(() => setConfigured(false));
  }, [open, configured]);

  // Let any page open the Copilot and ask a question (e.g. the How-it-works hub).
  useEffect(() => {
    function onAsk(e: Event) {
      setOpen(true);
      setClosing(false);
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (prompt) setTimeout(() => sendRef.current(prompt), 0);
    }
    window.addEventListener("mise:ask", onAsk);
    return () => window.removeEventListener("mise:ask", onAsk);
  }, []);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [messages, open]);

  const push = (m: Msg) => setMessages((prev) => [...prev, m]);
  const patchPending = (mi: number, pi: number, patch: Partial<Pending>) =>
    setMessages((prev) => prev.map((m, i) =>
      i === mi && m.pending ? { ...m, pending: m.pending.map((p, k) => (k === pi ? { ...p, ...patch } : p)) } : m));

  function payloadFrom(history: Msg[]) {
    return history.filter((m) => m !== GREETING).map((m) => ({ role: m.role, content: m.content }));
  }

  function toggleMic() {
    if (!voice.listening) speechBase.current = input;
    voice.toggle();
  }
  function toggleSpeak() {
    setSpeakOn((on) => {
      if (on) stopSpeaking();
      return !on;
    });
  }
  // Read a reply aloud when the user has turned on "speak answers".
  function maybeSpeak(text: string) {
    if (speakOn) speak(text);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const res = await api.post<ChatResponse>("/assistant/chat", { messages: payloadFrom(history), route: pathname, user_name: userName() });
      setConfigured(res.configured);
      push({ role: "assistant", content: res.reply, actions: res.actions, pending: res.pending_actions });
      maybeSpeak(res.reply);
    } catch (e) {
      push({ role: "assistant", content: e instanceof ApiError && e.status === 401 ? "Please sign in again." : "Sorry — I couldn't reach the assistant. Please try again." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    sendRef.current = send;
  });

  function chooseAttach(mode: string) {
    modeRef.current = mode;
    setAttachOpen(false);
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || loading) return;
    const [channel, kind] = modeRef.current.split(":");
    if (channel === "ingest") return ingestFile(file, kind);
    return chatWithImage(file, kind);
  }

  // Bulk onboarding: items/suppliers list → preview rows → confirm
  async function ingestFile(file: File, kind: string) {
    push({ role: "user", content: `📎 ${file.name}` });
    setLoading(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await postForm<{ kind: string; rows: Row[] }>("/assistant/ingest", form);
      if (!res.rows.length) push({ role: "assistant", content: `I couldn't find any ${kindLabel(kind)} in that file. Try a clearer PDF, photo or CSV.` });
      else push({ role: "assistant", content: `I read ${res.rows.length} ${kindLabel(kind)} from “${file.name}”. Review and confirm — nothing's saved until you do.`, ingest: { kind, rows: res.rows } });
    } catch (err) {
      push({ role: "assistant", content: ingestError(err) });
    } finally {
      setLoading(false);
    }
  }

  // Bill/receipt/photo → multimodal chat → the AI reads it and proposes an action
  async function chatWithImage(file: File, kind: string) {
    setLoading(true);
    try {
      const { dataUrl, base64, mime } = await readAsBase64(file);
      const ask = input.trim() || (kind === "receipt" ? "Please read this bill/receipt and record it." : "Please read this and do what's needed.");
      const userMsg: Msg = { role: "user", content: ask, image: dataUrl };
      const history = [...messages, userMsg];
      setMessages(history);
      setInput("");
      const res = await api.post<ChatResponse>("/assistant/chat", { messages: payloadFrom(history), route: pathname, attachment: { mime, data: base64 }, user_name: userName() });
      setConfigured(res.configured);
      push({ role: "assistant", content: res.reply, actions: res.actions, pending: res.pending_actions });
      maybeSpeak(res.reply);
    } catch (err) {
      push({ role: "assistant", content: ingestError(err) });
    } finally {
      setLoading(false);
    }
  }

  const ingestError = (err: unknown) =>
    err instanceof ApiError && err.status === 503 ? "Document reading needs the AI switched on (a Gemini key)."
      : err instanceof ApiError && err.status === 429 ? "The AI is busy right now (rate limit) — please try that again in a moment."
        : err instanceof ApiError && err.status === 403 ? "You don't have permission to add those records."
          : "Sorry — I couldn't read that file. Please try again.";

  async function commitIngest(index: number) {
    const msg = messages[index];
    if (!msg.ingest || loading) return;
    const { kind, rows } = msg.ingest;
    setLoading(true);
    try {
      const res = await api.post<{ created: string[]; skipped: string[] }>("/assistant/ingest/commit", { kind, rows });
      const summary = `Added ${res.created.length} ${kindLabel(kind)}` + (res.skipped.length ? ` · skipped ${res.skipped.length} (already existed)` : "") + ".";
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, ingest: { ...m.ingest!, committed: true, result: summary } } : m)));
      push({ role: "assistant", content: summary, actions: [{ label: kind === "vendors" ? "Open Vendors" : "Open Inventory", href: kind === "vendors" ? "/vendors" : "/inventory" }] });
    } catch {
      push({ role: "assistant", content: "Sorry — I couldn't save those. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction(mi: number, pi: number) {
    const p = messages[mi]?.pending?.[pi];
    if (!p || p.busy || p.done) return;
    patchPending(mi, pi, { busy: true });
    try {
      const res = await api.post<{ ok: boolean; summary: string; undo?: { type: string; id: string } }>("/assistant/act", { kind: p.kind, fields: p.fields });
      patchPending(mi, pi, { busy: false, done: true, result: res.summary, undo: res.undo });
    } catch (e) {
      patchPending(mi, pi, { busy: false });
      push({ role: "assistant", content: e instanceof ApiError ? e.message : "Sorry — that didn't save." });
    }
  }

  async function undoAction(mi: number, pi: number) {
    const p = messages[mi]?.pending?.[pi];
    if (!p?.undo || p.busy) return;
    patchPending(mi, pi, { busy: true });
    try {
      await api.post("/assistant/undo", { type: p.undo.type, id: p.undo.id });
      patchPending(mi, pi, { busy: false, undone: true });
    } catch {
      patchPending(mi, pi, { busy: false });
    }
  }

  // Animate the panel out, then unmount.
  function closePanel() {
    voice.stop();
    stopSpeaking();
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, 200);
  }
  function go(href: string) { voice.stop(); stopSpeaking(); setOpen(false); setClosing(false); router.push(href); }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Mise Copilot"
          className="mise-launcher-in group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-2xl border border-glass/10 bg-brand-600 px-3.5 py-3 text-white shadow-lg shadow-black/20 ring-1 ring-white/10 transition hover:bg-brand-500 hover:shadow-xl active:scale-95 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] lg:bottom-6 lg:right-6"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M12 2.5l1.7 5.3a3 3 0 0 0 1.9 1.9L21 11.4l-5.3 1.7a3 3 0 0 0-1.9 1.9L12 20.3l-1.7-5.3a3 3 0 0 0-1.9-1.9L3 11.4l5.3-1.7a3 3 0 0 0 1.9-1.9z" />
            <circle cx="18.5" cy="5" r="1.4" />
          </svg>
          <span className="hidden text-sm font-semibold sm:inline">Ask Mise</span>
        </button>
      )}

      {open && (
        <div
          className={`${closing ? "mise-copilot-out" : "mise-copilot-in"} mise-glass-panel fixed inset-x-2 bottom-2 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-2xl [padding-bottom:env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[600px] sm:max-h-[calc(100dvh_-_3rem)] sm:w-[400px] sm:max-w-[calc(100vw-3rem)]`}
          role="dialog"
          aria-label="Mise Copilot"
        >
          {/* Header */}
          <div className="relative flex items-center gap-2.5 overflow-hidden border-b border-glass/10 px-4 py-3">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-600/25 via-brand-500/10 to-transparent" aria-hidden />
            <ChefMascot mood={loading ? "think" : "happy"} className="relative w-10 shrink-0" />
            <div className="relative leading-tight">
              <p className="text-sm font-semibold text-fg">Mise Copilot</p>
              <p className="text-[11px] text-fg-faint">{configured === false ? "Quick help & navigation" : "One place for every plate & penny"}</p>
            </div>
            <button type="button" onClick={closePanel} aria-label="Close" className="relative ml-auto rounded-lg p-1.5 text-fg-faint hover:bg-glass/5 hover:text-fg">✕</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`mise-msg-in flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-[13px] text-white shadow-sm" aria-hidden>✨</span>
                )}
                <div className="max-w-[80%]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data-URL thumbnail, nothing for next/image to optimise */}
                  {m.image && <img src={m.image} alt="attachment" className="mb-1.5 max-h-40 rounded-xl border border-glass/15 object-cover" />}
                  <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "rounded-br-md bg-brand-600 text-white shadow-sm" : "rounded-bl-md border border-glass/10 bg-paper-3 text-fg"}`}>
                    {m.content}
                  </div>

                  {/* Confirm cards (proposed write actions) */}
                  {m.pending?.map((p, k) => (
                    <div key={k} className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">Confirm · {p.label}</p>
                      <p className="mt-1 text-sm text-fg">{p.summary}</p>
                      {!p.done && Array.isArray(p.fields?.lines) && (
                        <div className="mt-2 space-y-1.5">
                          {(p.fields.lines as Row[]).map((l, li) => (
                            <div key={li} className="flex items-center gap-1.5">
                              <input
                                value={String(l.item ?? "")}
                                onChange={(e) => {
                                  const lines = [...(p.fields.lines as Row[])];
                                  lines[li] = { ...lines[li], item: e.target.value };
                                  patchPending(i, k, { fields: { ...p.fields, lines } });
                                }}
                                className="min-w-0 flex-1 rounded-md border border-line-2 bg-transparent px-2 py-1 text-xs text-fg outline-none focus:border-brand-500"
                              />
                              <input
                                value={String(l.quantity ?? "")}
                                inputMode="decimal"
                                onChange={(e) => {
                                  const lines = [...(p.fields.lines as Row[])];
                                  lines[li] = { ...lines[li], quantity: e.target.value };
                                  patchPending(i, k, { fields: { ...p.fields, lines } });
                                }}
                                className="w-14 rounded-md border border-line-2 bg-transparent px-2 py-1 text-right text-xs text-fg outline-none focus:border-brand-500"
                              />
                              <input
                                value={String(l.unit ?? "")}
                                placeholder="unit"
                                onChange={(e) => {
                                  const lines = [...(p.fields.lines as Row[])];
                                  lines[li] = { ...lines[li], unit: e.target.value };
                                  patchPending(i, k, { fields: { ...p.fields, lines } });
                                }}
                                className="w-12 rounded-md border border-line-2 bg-transparent px-2 py-1 text-xs text-fg outline-none focus:border-brand-500"
                              />
                              <button
                                type="button"
                                aria-label="Remove line"
                                onClick={() => {
                                  const lines = (p.fields.lines as Row[]).filter((_, x) => x !== li);
                                  patchPending(i, k, { fields: { ...p.fields, lines } });
                                }}
                                className="shrink-0 px-1 text-fg-faint hover:text-rose-300"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {!p.done && p.fields?.amount != null && (
                        <label className="mt-2 flex items-center gap-2 text-xs text-fg-soft">
                          <span className="whitespace-nowrap font-medium">Amount £</span>
                          <input
                            value={String(p.fields.amount ?? "")}
                            onChange={(e) => patchPending(i, k, { fields: { ...p.fields, amount: e.target.value } })}
                            inputMode="decimal"
                            className="w-24 rounded-md border border-line-2 bg-transparent px-2 py-1 text-right text-fg outline-none focus:border-brand-500"
                          />
                          <span className="text-fg-faint">edit if misread</span>
                        </label>
                      )}
                      {p.done ? (
                        <div className="mt-2 flex items-center gap-3">
                          <span className="text-xs font-medium text-brand-300">✓ {p.result}</span>
                          {p.undo && !p.undone && <button type="button" onClick={() => undoAction(i, k)} disabled={p.busy} className="text-xs text-fg-faint underline hover:text-fg disabled:opacity-40">Undo</button>}
                          {p.undone && <span className="text-xs text-fg-faint">· undone</span>}
                        </div>
                      ) : (
                        <button type="button" onClick={() => confirmAction(i, k)} disabled={p.busy} className="mt-2.5 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50">
                          {p.busy ? "Saving…" : "Confirm & save"}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Onboarding preview (bulk items/suppliers) */}
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
                        <button type="button" onClick={() => commitIngest(i)} disabled={loading} className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-40">
                          Add {m.ingest.rows.length} {kindLabel(m.ingest.kind)}
                        </button>
                      )}
                    </div>
                  )}

                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.actions.map((a, j) => (
                        <button key={j} type="button" onClick={() => go(a.href)} className="mise-glow-link rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-300">
                          {a.label} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-[13px] text-white shadow-sm" aria-hidden>✨</span>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-glass/10 bg-paper-3 px-4 py-3.5">
                  <span className="mise-bob h-2 w-2 rounded-full bg-brand-400" />
                  <span className="mise-bob h-2 w-2 rounded-full bg-brand-400" style={{ animationDelay: "0.2s" }} />
                  <span className="mise-bob h-2 w-2 rounded-full bg-brand-400" style={{ animationDelay: "0.4s" }} />
                </div>
              </div>
            )}

            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2 pt-1">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-glass/15 bg-paper-3/60 px-3 py-1.5 text-xs text-fg-soft transition hover:bg-glass/5">{s}</button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="relative flex items-center gap-2 border-t border-glass/10 bg-paper-3/40 p-3">
            <input ref={fileRef} type="file" accept="application/pdf,image/*,.csv" onChange={onFile} className="hidden" />
            {attachOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} aria-hidden />
                <div className="mise-pop absolute bottom-14 left-3 z-20 w-56 rounded-xl border border-glass/10 bg-paper-2/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
                  <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-fg-faint">Upload &amp; let me handle it</p>
                  {ATTACH.map((a) => (
                    <button key={a.mode} type="button" onClick={() => chooseAttach(a.mode)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-fg-soft hover:bg-glass/5">
                      <span aria-hidden>{a.icon}</span> {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button type="button" onClick={() => setAttachOpen((o) => !o)} aria-label="Attach a document" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-glass/15 text-lg text-fg-soft transition hover:bg-glass/5">📎</button>
            {voice.supported && (
              <button
                type="button"
                onClick={toggleMic}
                aria-label={voice.listening ? "Stop listening" : "Speak your message"}
                aria-pressed={voice.listening}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg transition ${voice.listening ? "animate-pulse border-rose-500/50 bg-rose-500/10 text-rose-300" : "border-glass/15 text-fg-soft hover:bg-glass/5"}`}
              >
                🎤
              </button>
            )}
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={voice.listening ? "Listening…" : "Ask, or tell me to add something…"} className="min-w-0 flex-1 rounded-xl border border-glass/15 bg-paper px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-faint focus:border-brand-500/50 focus:outline-none" />
            {ttsSupported && (
              <button
                type="button"
                onClick={toggleSpeak}
                aria-label={speakOn ? "Turn off read-aloud" : "Read answers aloud"}
                aria-pressed={speakOn}
                title={speakOn ? "Read answers aloud: on" : "Read answers aloud: off"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg transition ${speakOn ? "border-brand-500/50 bg-brand-500/10 text-brand-300" : "border-glass/15 text-fg-soft hover:bg-glass/5"}`}
              >
                {speakOn ? "🔊" : "🔈"}
              </button>
            )}
            <button type="submit" disabled={loading || !input.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-40">↑</button>
          </form>
        </div>
      )}
    </>
  );
}
