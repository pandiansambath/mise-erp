"use client";

import { Typewriter } from "@/components/Typewriter";


// DineAI Copilot — the project-aware AI, on every page (mounted in AppShell so it
// inherits the theme). It explains things, reads your live numbers, links you
// straight to the right screen, ONBOARDS you from documents, reads bills/photos,
// and can DO things (add an expense/sale/item/supplier) — always behind a
// "here's what I'll do" confirmation, with one-tap Undo.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, postStream, postForm } from "@/lib/api";
import { useDraggable } from "@/components/useDraggable";
import { useResizable } from "@/components/useResizable";
import { speak, speechOutputSupported, stopSpeaking, useVoiceInput } from "@/lib/useVoice";
import ChefMascot from "@/components/auth/ChefMascot";

type Action = { label: string; href: string };
type Row = Record<string, unknown>;
type Pending = {
  kind: string; label: string; summary: string; fields: Row;
  done?: boolean; result?: string; undo?: { type: string; id: string }; undone?: boolean; busy?: boolean;
  /** The server could not tell which item a supplier's wording meant, and is
   *  asking rather than guessing — a price on the wrong item is invisible. */
  choice?: { field: string; query: string; message: string; candidates: { id: string; name: string; score: number }[] };
};
type Ingest = { kind: string; rows: Row[]; committed?: boolean; result?: string };
type ChatResponse = {
  thread_id?: string; // which conversation this reply belongs to
  choices?: string[]; // tappable follow-ups the assistant offered
  reply: string; actions: Action[]; pending_actions: Pending[]; used_tools: string[]; configured: boolean;
  trace?: { kind: string; text?: string; name?: string; input?: string }[];
};
type Msg = {
  role: "user" | "assistant"; content: string;
  actions?: Action[]; pending?: Pending[]; ingest?: Ingest; image?: string;
  choices?: string[]; // tappable follow-ups; tapping one is the same as typing it
  /** What was attached. Kept as a data URL so it stays downloadable later in
   *  the thread — a receipt you can no longer open is not a record. */
  file?: { name: string; mime: string; size: number; dataUrl: string };
  /** What it did to get here: reasoning and tool calls, in order. */
  trace?: { kind: string; text?: string; name?: string; input?: string }[];
};

/** A file the user has chosen but NOT yet sent. */
type Staged = {
  file: File; name: string; mime: string; size: number;
  dataUrl: string; base64: string; mode: string;
};

const prettySize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** An icon for what KIND of file this is. Most attachments cannot be previewed,
 *  and a broken <img> is worse than an honest icon. */
function fileGlyph(mime: string, name: string): string {
  const n = name.toLowerCase();
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "📄";
  if (/\.(csv|xlsx|xls)$/.test(n)) return "📊";
  if (/\.(docx?|txt|rtf)$/.test(n)) return "📝";
  return "📎";
}

const STARTERS = ["What's low on stock?", "How's this month's profit?", "Add a £40 gas expense", "What is slow stock?"];

// The name the user gave at onboarding — so the Copilot addresses them by it.
const userName = (): string | undefined => {
  try {
    return localStorage.getItem("mise.user.name") || undefined;
  } catch {
    return undefined;
  }
};

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi — I'm your DineAI Copilot. Ask about your stock, sales or profit, tell me to add something (“log a £40 gas bill”), or tap 📎 to upload an items list, a supplier list, or a bill/receipt and I'll handle it.",
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

/** Turn a failed /assistant/chat call into something worth reading.
 *  Each branch is a DIFFERENT user action: wait, upgrade, sign in, retry. */
function assistantError(e: unknown): string {
  if (!(e instanceof ApiError)) {
    return "I lost the connection there — check your internet and try again.";
  }
  const detail =
    typeof e.detail === "string"
      ? e.detail
      : (e.detail as { detail?: string } | null)?.detail ?? e.message;
  switch (e.status) {
    case 401:
      return "Please sign in again.";
    case 402:
      return `${detail || "That needs a higher plan."}`;
    case 403:
      return detail || "You don't have access to that.";
    case 413:
      return "That file is too big for me to read. Try a smaller one, or paste the text.";
    case 429:
      return detail || "That's a lot of questions at once — give me a few seconds and ask again.";
    case 502:
    case 503:
    case 504:
      return "The AI service didn't answer in time. Try again in a moment.";
    default:
      // 500s and anything unexpected: show the server's own words when it gave
      // any, because "something went wrong" is not a bug report.
      return detail
        ? `Something went wrong: ${detail}`
        : "Something went wrong on my side. Please try again.";
  }
}

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  // A file chosen but not yet sent — see onFile().
  const [staged, setStaged] = useState<Staged | null>(null);
  // Seconds since the current question was sent. Reset on each send.
  const [elapsed, setElapsed] = useState(0);
  // What it is doing RIGHT NOW, and the reply as it is written. The elapsed
  // counter proved the assistant was alive; this shows what it is alive DOING,
  // which is what was actually asked for.
  const [liveTrace, setLiveTrace] = useState<
    { kind: string; text?: string; name?: string; input?: string }[]
  >([]);
  const [liveText, setLiveText] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ plan?: string; model?: string; today_calls?: number; daily_limit?: number } | null>(null);

  useEffect(() => {
    if (!open || usage) return;
    api
      .get<{ plan?: string; model?: string; today_calls?: number; daily_limit?: number }>(
        "/assistant/usage",
      )
      .then(setUsage)
      .catch(() => {});
  }, [open, usage]);
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  // True only for a reply that just arrived, so replayed history appears at
  // once rather than retyping itself.
  const [justAnswered, setJustAnswered] = useState(false);

  const loadThreads = () => {
    api
      .get<{ threads: { id: string; title: string }[] }>("/assistant/threads")
      .then((d) => setThreads(d.threads))
      .catch(() => {});
  };

  async function openThread(id: string) {
    setShowThreads(false);
    const d = await api.get<{ thread_id: string; messages: { role: string; content: string }[] }>(
      `/assistant/history?thread=${id}`,
    );
    setThreadId(d.thread_id);
    setMessages(
      d.messages.length
        ? (d.messages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })) as Msg[])
        : [GREETING],
    );
  }
  const panelRef = useRef<HTMLDivElement>(null);
  const [speakOn, setSpeakOn] = useState(false);
  const speechBase = useRef("");
  const voice = useVoiceInput((t) =>
    setInput((speechBase.current ? speechBase.current + " " : "") + t)
  );
  const ttsSupported = speechOutputSupported();
  const pathname = usePathname();
  const router = useRouter();

  // Warm the full view as soon as the panel opens. Expanding then costs a
  // repaint, not a page load — which is the whole difference between the
  // animation feeling like growth and feeling like a stall.
  useEffect(() => {
    if (open) router.prefetch("/ai-scan");
  }, [open, router]);

  // Dismiss on a click outside or Escape. Closing is not the same as clearing:
  // the thread stays exactly where it was and reopening resumes it, because
  // people close this panel to see the screen behind it, not to start over.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const el = panelRef.current;
      if (el && !el.contains(e.target as Node)) closePanel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Replay this person's conversation. It lives on the server keyed to THEM,
  // so it survives navigation, a new tab, a different device and logging out.
  useEffect(() => {
    if (!open || threadId) return;  // already loaded: reopening resumes, never resets
    api
      .get<{ thread_id: string; messages: { role: string; content: string }[] }>(
        "/assistant/history",
      )
      .then((d) => {
        setThreadId(d.thread_id);
        setJustAnswered(false);
        if (d.messages.length) {
          setMessages(
            d.messages.map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
            })) as Msg[],
          );
        }
      })
      .catch(() => {});
  }, [open, threadId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

    // Let a page hand the Copilot a FILE to read — "upload a bill" on Expenses
    // opens the bubble and the file chooser in one gesture, so the AI reads the
    // receipt instead of somebody typing it in.
    function onAttach(e: Event) {
      setOpen(true);
      setClosing(false);
      const mode = (e as CustomEvent<{ mode?: string }>).detail?.mode ?? "chat:auto";
      // Deferred: the panel (and its hidden file input) must be mounted before
      // the click, or the chooser never opens.
      setTimeout(() => chooseAttachRef.current(mode), 120);
    }
    window.addEventListener("mise:attach", onAttach);

    return () => {
      window.removeEventListener("mise:ask", onAsk);
      window.removeEventListener("mise:attach", onAttach);
    };
  }, []);

  // Scroll to the bottom when a NEW message arrives — not when an existing one
  // changes.
  //
  // This used to depend on `messages` as a whole, and confirming an action
  // PATCHES a message. So every "Confirm & save" threw you to the bottom of the
  // thread and you had to scroll back up to reach the next item. With twenty
  // items off a price list that is nineteen pointless scrolls.
  const lastCount = useRef(0);
  useEffect(() => {
    if (!open) return;
    const grew = messages.length > lastCount.current;
    lastCount.current = messages.length;
    if (grew || justOpened.current) {
      justOpened.current = false;
      // Jump, don't glide: on REOPEN a smooth scroll walks the whole history
      // past you, which is both slow and shows text mid-render.
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
      inputRef.current?.focus();
    }
  }, [messages, open]);

  const justOpened = useRef(true);
  useEffect(() => {
    if (open) justOpened.current = true;
  }, [open]);

  // Count up while the assistant works, so "is it doing anything?" is answered
  // by the screen instead of by waiting.
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

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
    // A staged file IS the message — it may legitimately carry no text
    // ("read this"), so an empty box must not block sending it.
    if (staged && !loading) return sendStaged(q);
    if (!q || loading) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(history);
    setInput("");
    setLoading(true);
    setLiveTrace([]);
    setLiveText("");
    try {
      const body = { messages: payloadFrom(history), route: pathname, user_name: userName(), thread_id: threadId };
      let done: ChatResponse | null = null;
      // Stream by default; the buffered endpoint is still there and is used
      // whenever streaming cannot be established (an old proxy, a corporate
      // filter, a browser without ReadableStream). A degraded answer beats
      // none, and the two paths end in the same state.
      try {
        await postStream("/assistant/chat/stream", body, (ev) => {
          if (ev.type === "thought" || ev.type === "tool") {
            setLiveTrace((prev) => [...prev, ev as { kind: string }]);
          } else if (ev.type === "delta") {
            setLiveText((prev) => prev + String(ev.text ?? ""));
          } else if (ev.type === "done") {
            done = ev.response as ChatResponse;
          } else if (ev.type === "error") {
            throw new Error(String(ev.message ?? "stream failed"));
          }
        });
      } catch (streamErr) {
        // A 4xx is a real refusal (rate limit, payment, message too long) and
        // must surface as itself rather than being retried against an endpoint
        // that will refuse identically.
        if (streamErr instanceof ApiError && streamErr.status < 500) throw streamErr;
        console.warn("streaming unavailable, falling back", streamErr);
        done = await api.post<ChatResponse>("/assistant/chat", body);
      }
      const res = done as ChatResponse | null;
      if (!res) throw new Error("The assistant stopped before answering.");
      if (res.thread_id) setThreadId(res.thread_id);
      // choices ride on the assistant message so they disappear once answered
      setConfigured(res.configured);
      setJustAnswered(true);
      push({ role: "assistant", content: res.reply, actions: res.actions, pending: res.pending_actions, choices: res.choices, trace: res.trace });
      maybeSpeak(res.reply);
    } catch (e) {
      // Say what actually went wrong. "Couldn't reach the assistant" was shown
      // for EVERY failure — including a 429 you just need to wait out and a 402
      // you can fix by upgrading — so the one message meant nothing and made
      // real faults impossible to report or diagnose.
      push({ role: "assistant", content: assistantError(e) });
      // Keep the real error in the console for diagnosis; the chat bubble stays
      // human.
      console.error("assistant request failed", e);
    } finally {
      setLoading(false);
      // The finished message now carries the trace; leaving the live copy up
      // would show it twice.
      setLiveTrace([]);
      setLiveText("");
    }
  }
  useEffect(() => {
    sendRef.current = send;
  });

  function chooseAttach(mode: string) {
    modeRef.current = mode;
    fileRef.current?.click();
  }
  // Kept in a ref so the window listener above always calls the current one
  // without re-subscribing on every render.
  const chooseAttachRef = useRef(chooseAttach);
  useEffect(() => {
    chooseAttachRef.current = chooseAttach;
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || loading) return;
    // STAGE it. Choosing a file used to fire the request immediately, so the
    // message left before you had finished typing the question that went with
    // it — and there was no way to change your mind. Now it waits for send.
    try {
      const { dataUrl, base64, mime } = await readAsBase64(file);
      setStaged({
        file, dataUrl, base64,
        mime: mime || file.type || "application/octet-stream",
        name: file.name,
        size: file.size,
        mode: modeRef.current,
      });
      inputRef.current?.focus();
    } catch {
      push({ role: "assistant", content: "I couldn't read that file — try another one." });
    }
  }

  /** Send whatever is staged, with the prompt the user has typed. */
  async function sendStaged(prompt: string) {
    if (!staged) return;
    const [channel, kind] = staged.mode.split(":");
    const sheet = /\.(csv|xlsx|xls)$/.test(staged.name.toLowerCase());
    const s = staged;
    setStaged(null);
    if (channel === "ingest") return ingestFile(s.file, kind);
    // "auto": let the file decide. A spreadsheet is a list to import; anything
    // else goes to the model, which reads PDFs, photos and text alike.
    if (kind === "auto" && sheet) return ingestFile(s.file, "items");
    return chatWithImage(s, kind, prompt);
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

  // Any document → multimodal chat → the AI reads it and proposes an action.
  async function chatWithImage(s: Staged, kind: string, prompt: string) {
    setLoading(true);
    try {
      const ask = prompt.trim() || (kind === "receipt" ? "Please read this bill/receipt and record it." : "Please read this and do what's needed.");
      const userMsg: Msg = {
        role: "user",
        content: ask,
        // Only real images get an inline preview. A PDF in an <img> renders as
        // a broken-image icon, which is what it used to do.
        image: s.mime.startsWith("image/") ? s.dataUrl : undefined,
        file: { name: s.name, mime: s.mime, size: s.size, dataUrl: s.dataUrl },
      };
      const history = [...messages, userMsg];
      setMessages(history);
      setInput("");
      const res = await api.post<ChatResponse>("/assistant/chat", { messages: payloadFrom(history), route: pathname, attachment: { mime: s.mime, data: s.base64, name: s.name }, user_name: userName(), thread_id: threadId });
      if (res.thread_id) setThreadId(res.thread_id);
      setConfigured(res.configured);
      push({ role: "assistant", content: res.reply, actions: res.actions, pending: res.pending_actions, choices: res.choices });
      maybeSpeak(res.reply);
    } catch (err) {
      push({ role: "assistant", content: assistantError(err) });
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
      const res = await api.post<{
        ok: boolean; summary: string; undo?: { type: string; id: string };
        needs_choice?: boolean; field?: string; query?: string; error?: string;
        candidates?: { id: string; name: string; score: number }[];
      }>("/assistant/act", { kind: p.kind, fields: p.fields });

      // Not an error — a question. Show the options inline so the answer is one
      // tap, instead of dead-ending on "item not found".
      if (res.needs_choice) {
        patchPending(mi, pi, {
          busy: false,
          choice: {
            field: res.field ?? "item",
            query: res.query ?? "",
            message: res.error ?? "Which one did you mean?",
            candidates: res.candidates ?? [],
          },
        });
        return;
      }
      patchPending(mi, pi, { busy: false, done: true, result: res.summary, undo: res.undo, choice: undefined });
    } catch (e) {
      patchPending(mi, pi, { busy: false });
      push({ role: "assistant", content: e instanceof ApiError ? e.message : "Sorry — that didn't save." });
    }
  }


  /** The user picked which item the supplier meant. Re-run with the explicit id;
   *  the server remembers the answer so this vendor's wording is translated
   *  automatically from now on. */
  async function resolveChoice(mi: number, pi: number, itemId: string) {
    const p = messages[mi]?.pending?.[pi];
    if (!p) return;
    patchPending(mi, pi, { busy: true });
    const fields = { ...p.fields, item_id: itemId };
    try {
      const res = await api.post<{ ok: boolean; summary: string; undo?: { type: string; id: string } }>(
        "/assistant/act", { kind: p.kind, fields },
      );
      patchPending(mi, pi, { busy: false, done: true, result: res.summary, undo: res.undo, choice: undefined, fields });
    } catch (e) {
      patchPending(mi, pi, { busy: false });
      push({ role: "assistant", content: e instanceof ApiError ? e.message : "Sorry — that didn't save." });
    }
  }


  /** Confirm every outstanding action in one message, in order.
   *
   *  He asked the assistant for exactly this and was told it was not possible.
   *  It plainly is: the actions are independent, so they run one after another
   *  and a failure on one does not stop the rest. Sequential rather than
   *  parallel on purpose — these write to stock and prices, and twenty
   *  simultaneous writes is how you get a deadlock instead of a saving.
   */
  async function confirmAll(mi: number) {
    const pendings = messages[mi]?.pending ?? [];
    for (let k = 0; k < pendings.length; k++) {
      const p = messages[mi]?.pending?.[k];
      // Skip anything already done, or waiting on a question only the user can
      // answer — bulk approval must never answer those on their behalf.
      if (!p || p.done || p.choice) continue;
      await confirmAction(mi, k);
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
  /** Grow the bubble into the full page, carrying the conversation with it. */
  function expandToPage() {
    voice.stop();
    stopSpeaking();
    try {
      // hand the thread over so the full view doesn't start from nothing
      sessionStorage.setItem(
        "copilot:thread",
        JSON.stringify(messages.filter((m) => !m.image).slice(-12)),
      );
    } catch {
      /* private mode / quota — the page just opens fresh, which is fine */
    }
    setExpanding(true);
    router.push("/ai-scan");           // start painting immediately
    window.setTimeout(() => {          // dissolve plays OVER the new page
      setOpen(false);
      setExpanding(false);
    }, 220);
  }

  function go(href: string) { voice.stop(); stopSpeaking(); setOpen(false); setClosing(false); router.push(href); }

  // Where the user has decided this thing belongs.
  const drag = useDraggable("mise.copilot.pos");
  // How big the assistant is, and where. Remembered, because resizing the same
  // window twice a day is worse than it being the wrong size once.
  const panel = useResizable("mise.copilot.box", { w: 400, h: 600 });
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setIsWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <>
      {!open && (
        <button
          type="button"
          // Touch and move to reposition, tap to open — no long-press, no
          // handle, no mode. The gesture tells us which it was: past a few
          // pixels it is a drag. It was covering things that mattered in the
          // corner we happened to choose.
          {...drag.handlers}
          onClick={() => {
            if (drag.wasDrag()) return;
            setOpen(true);
          }}
          aria-label="Ask DineAI Copilot — drag to move"
          style={drag.style}
          className={`mise-launcher-in group fixed bottom-20 left-4 z-50 lg:bottom-6 lg:left-6 flex touch-none items-center gap-2 rounded-2xl border border-glass/10 bg-brand-600 px-3.5 py-3 text-white shadow-lg shadow-black/20 ring-1 ring-white/10 hover:bg-brand-500 hover:shadow-xl [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] ${
            drag.dragging
              ? "scale-110 cursor-grabbing opacity-90 shadow-2xl"
              : "cursor-grab transition active:scale-95"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M12 2.5l1.7 5.3a3 3 0 0 0 1.9 1.9L21 11.4l-5.3 1.7a3 3 0 0 0-1.9 1.9L12 20.3l-1.7-5.3a3 3 0 0 0-1.9-1.9L3 11.4l5.3-1.7a3 3 0 0 0 1.9-1.9z" />
            <circle cx="18.5" cy="5" r="1.4" />
          </svg>
          <span className="hidden text-sm font-semibold sm:inline">Ask DineAI</span>
        </button>
      )}

      {/* A scrim, on phones only.
          The panel already capped itself at 68dvh, but with the page still at
          full brightness behind it the two read as one cluttered screen rather
          than a sheet over a page — "it's really making the UI clumsy". This
          is what every native app does: dim what is behind, and tapping the
          dimmed part closes. On a desktop the panel is a small corner card
          with plenty of page around it, so a scrim there would be theatre. */}
      {open && (
        <div
          className="mise-scrim-in fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {open && (
        <div
          ref={panelRef}
          data-resizable
          // `data-narrow` is what makes the CONTENTS obey the size. A panel
          // that changes its frame and leaves a wide toolbar inside is worse
          // than one that never resized — so the real width is published here
          // and the children key off it.
          data-narrow={panel.box.w < 380 ? "true" : undefined}
          style={
            // Below sm the panel is a sheet and stays where it is; dragging a
            // window around a phone screen is not a thing anyone wants.
            isWide
              ? {
                  width: panel.box.w,
                  height: panel.box.h,
                  ...(panel.box.x != null
                    ? { left: panel.box.x, top: panel.box.y ?? 0, right: "auto", bottom: "auto" }
                    : {}),
                }
              : undefined
          }
          className={`${expanding ? "mise-copilot-expand" : closing ? "mise-copilot-out" : "mise-copilot-in"} fixed inset-x-2 bottom-[5.5rem] z-50 flex max-h-[68dvh] flex-col overflow-hidden rounded-2xl border border-glass/10 bg-paper-2/[0.98] shadow-2xl shadow-black/50 backdrop-blur-xl sm:bottom-6 [padding-bottom:env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-h-none ${
            panel.active ? "select-none transition-none" : ""
          }`}
          role="dialog"
          aria-label="DineAI Copilot"
        >
          {/* Eight grips: four edges, four corners — the shape of every window
              anybody has ever resized, so nothing has to be explained. Hidden
              on phones, where the panel is a sheet. */}
          {isWide && (
            <>
              {([
                ["n", "left-3 right-3 top-0 h-1.5 cursor-ns-resize"],
                ["s", "left-3 right-3 bottom-0 h-1.5 cursor-ns-resize"],
                ["w", "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize"],
                ["e", "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize"],
                ["nw", "left-0 top-0 h-3 w-3 cursor-nwse-resize"],
                ["ne", "right-0 top-0 h-3 w-3 cursor-nesw-resize"],
                ["sw", "left-0 bottom-0 h-3 w-3 cursor-nesw-resize"],
                ["se", "right-0 bottom-0 h-3 w-3 cursor-nwse-resize"],
              ] as const).map(([edge, cls]) => (
                <span
                  key={edge}
                  {...panel.grip(edge)}
                  className={`absolute z-20 touch-none ${cls}`}
                  aria-hidden
                />
              ))}
            </>
          )}
          {/* Header — and the handle. Dragging a window by its title bar is
              the one gesture nobody needs telling. */}
          <div
            {...(isWide ? panel.grip("move") : {})}
            // Double-click puts it back where it started. `reset` existed but
            // nothing called it, so a panel dragged somewhere awkward had no
            // way home — and the drag handle is this header, so "awkward"
            // could mean "unreachable".
            onDoubleClick={isWide ? panel.reset : undefined}
            title={isWide ? "Drag to move · double-click to reset" : undefined}
            className={`relative flex items-center gap-2.5 overflow-hidden border-b border-glass/10 px-4 py-3 ${
              isWide ? "cursor-grab touch-none active:cursor-grabbing" : ""
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-brand-600/25 via-brand-500/10 to-transparent" aria-hidden />
            {/* A grip you can SEE. A grab cursor only appears once the pointer
                is already there, so it cannot tell you the thing is movable —
                which is why he thought it was not. */}
            {isWide && (
              <span
                aria-hidden
                className="relative -ml-1 select-none text-xs leading-none tracking-tighter text-fg-faint/60"
              >
                ⠿
              </span>
            )}
            <ChefMascot mood={loading ? "think" : "happy"} className="relative w-10 shrink-0" />
            <div className="relative min-w-0 leading-tight">
              <p className="text-sm font-semibold text-fg">DineAI Copilot</p>
              <p className="truncate text-[11px] text-fg-faint">
                {configured === false
                  ? "Quick help & navigation"
                  : usage?.model
                    ? `${usage.model.includes("haiku") ? "Haiku" : "Sonnet"}${usage.plan ? ` · ${usage.plan}` : ""}`
                    : "One place for every plate & penny"}
              </p>
            </div>
            {/* The same allowance ring as the full page. Parity means the same
                information, not a smaller version of a different thing. */}
            {usage?.daily_limit ? (
              <div className="relative h-9 w-9 shrink-0" title="AI questions left today">
                <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-glass/15" />
                  <circle
                    cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" strokeLinecap="round"
                    className={
                      (usage.daily_limit - (usage.today_calls ?? 0)) / usage.daily_limit > 0.25
                        ? "stroke-brand-400"
                        : "stroke-amber-400"
                    }
                    strokeDasharray={`${Math.max(0, ((usage.daily_limit - (usage.today_calls ?? 0)) / usage.daily_limit) * 97.4)} 97.4`}
                  />
                </svg>
                <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-fg">
                  {Math.max(0, usage.daily_limit - (usage.today_calls ?? 0))}
                </span>
              </div>
            ) : null}
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => { loadThreads(); setShowThreads((v) => !v); }}
                aria-label="Past conversations"
                title="Past conversations"
                className="relative rounded-lg p-1.5 text-fg-faint transition hover:bg-glass/5 hover:text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 8v4l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.5 4" />
                </svg>
              </button>
              {showThreads && (
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setShowThreads(false)} aria-hidden />
                  <div className="mise-pop absolute right-0 top-9 z-[60] max-h-64 w-64 overflow-y-auto rounded-xl border border-glass/10 bg-paper-2/95 p-1.5 shadow-2xl backdrop-blur">
                    {threads.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-fg-faint">No earlier conversations yet.</p>
                    ) : (
                      threads.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => openThread(t.id)}
                          className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-glass/5 ${
                            t.id === threadId ? "text-brand-300" : "text-fg-soft"
                          }`}
                        >
                          {t.title}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const d = await api.post<{ thread_id: string }>("/assistant/history/new", {});
                  setThreadId(d.thread_id);
                } catch {
                  setThreadId(null);
                }
                setMessages([GREETING]);
              }}
              aria-label="Start a new chat"
              title="New chat — your old conversations are kept"
              className="relative rounded-lg p-1.5 text-fg-faint transition hover:bg-glass/5 hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={expandToPage}
              aria-label="Open full screen"
              title="Open full screen — more room, and you can send photos"
              className="relative rounded-lg p-1.5 text-fg-faint transition hover:bg-glass/5 hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
              </svg>
            </button>
            <button type="button" onClick={closePanel} aria-label="Close" className="relative rounded-lg p-1.5 text-fg-faint hover:bg-glass/5 hover:text-fg">✕</button>
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
                  {m.image && <img src={m.image} alt={m.file?.name ?? "attachment"} className="mb-1.5 max-h-40 rounded-xl border border-glass/15 object-cover" />}
                  {/* Anything that is not an image gets an honest chip instead
                      of a broken <img>. Downloadable, because a receipt you
                      cannot reopen is not a record. */}
                  {m.file && !m.image && (
                    <a
                      href={m.file.dataUrl}
                      download={m.file.name}
                      className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-glass/15 bg-paper-3/60 px-3 py-2 transition hover:border-brand-400/40 hover:bg-glass/5"
                    >
                      <span aria-hidden className="text-lg">{fileGlyph(m.file.mime, m.file.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{m.file.name}</span>
                        <span className="block text-[10px] text-fg-faint">{prettySize(m.file.size)} · tap to download</span>
                      </span>
                      <span aria-hidden className="text-fg-faint">⬇</span>
                    </a>
                  )}
                  <div className={`rounded-2xl px-4 py-3 text-[15px] leading-[1.65] ${m.role === "user" ? "rounded-br-md bg-brand-600 text-white shadow-lg shadow-brand-900/20" : "mise-neo-raised rounded-bl-md text-fg"}`}>
                    <Typewriter text={m.content} animate={m.role === "assistant" && i === messages.length - 1 && justAnswered} />
                  </div>

                  {(m.pending?.filter((p) => !p.done && !p.choice).length ?? 0) > 1 && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-brand-500/25 bg-brand-500/[0.07] px-2.5 py-2">
                      <span className="text-[11px] text-fg-soft">
                        {m.pending?.filter((p) => !p.done && !p.choice).length} to confirm
                      </span>
                      <button
                        type="button"
                        onClick={() => confirmAll(i)}
                        disabled={m.pending?.some((p) => p.busy)}
                        className="mise-press rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
                      >
                        Approve all
                      </button>
                    </div>
                  )}
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
                      ) : p.choice ? (
                        /* A question, not a failure. The old behaviour was
                           "No stock item matches 'Tomatos'" and a dead end. */
                        <div className="mise-pop mt-2.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-2.5">
                          <p className="text-xs font-medium text-amber-200">{p.choice.message}</p>
                          {p.choice.candidates.length > 0 ? (
                            <div className="mt-2 space-y-1">
                              {p.choice.candidates.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => resolveChoice(i, k, c.id)}
                                  disabled={p.busy}
                                  className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-paper-3/60 px-2.5 py-1.5 text-left text-xs text-fg transition hover:border-brand-400/50 hover:bg-brand-400/10 disabled:opacity-50"
                                >
                                  <span className="truncate">{c.name}</span>
                                  <span className="shrink-0 text-[10px] text-fg-faint">
                                    {Math.round(c.score * 100)}% match
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-[11px] text-fg-faint">
                              Nothing in your inventory looks close. Add the item first, then try again.
                            </p>
                          )}
                          <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                            I&apos;ll remember your answer for this supplier, so I won&apos;t ask again.
                          </p>
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

                  {m.choices && m.choices.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.choices.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => send(c)}
                          disabled={loading}
                          className="mise-press rounded-full border border-brand-400/40 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* The working, collapsed. Open it and you can see the steps
                      it took; leave it shut and the answer stands alone. Only
                      shown when there is something worth showing — a one-step
                      reply has no story to tell. */}
                  {m.role === "assistant" && (m.trace?.length ?? 0) > 0 && (
                    <details className="mt-2 group">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-fg-faint transition hover:text-fg-soft">
                        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                        How I worked this out
                        <span className="rounded-full bg-glass/10 px-1.5 py-0.5 text-[9px] tabular-nums">
                          {m.trace!.filter((t) => t.kind === "tool").length} step
                          {m.trace!.filter((t) => t.kind === "tool").length === 1 ? "" : "s"}
                        </span>
                      </summary>
                      <ol className="mise-pop mt-1.5 space-y-1.5 border-l border-glass/15 pl-3">
                        {m.trace!.map((t, ti) => (
                          <li key={ti} className="text-[11px] leading-relaxed">
                            {t.kind === "thought" ? (
                              <span className="italic text-fg-faint">{t.text}</span>
                            ) : (
                              <span className="text-fg-soft">
                                <span className="font-mono text-[10px] text-brand-300">
                                  {(t.name ?? "").replace(/_/g, " ")}
                                </span>
                                {t.input ? <span className="text-fg-faint"> — {t.input}</span> : null}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
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
                <div className="mise-shimmer flex items-center gap-2 rounded-2xl rounded-bl-md border border-glass/10 bg-paper-3 px-4 py-3">
                  <span className="mise-bob h-2 w-2 rounded-full bg-brand-400" />
                  <span className="mise-bob h-2 w-2 rounded-full bg-brand-400" style={{ animationDelay: "0.2s" }} />
                  <span className="mise-bob h-2 w-2 rounded-full bg-brand-400" style={{ animationDelay: "0.4s" }} />
                  {/* An elapsed count, not a fixed phrase. On a slow question
                      the assistant can run several tool calls, and a static
                      "thinking…" is indistinguishable from a hang — you sat
                      waiting with no sign it was alive. A number that keeps
                      moving is proof that it is. */}
                  <span className="text-xs tabular-nums text-fg-faint">
                    {liveTrace.length > 0
                      ? `${liveTrace[liveTrace.length - 1].kind === "tool" ? "reading" : "thinking"} · ${elapsed}s`
                      : elapsed < 4
                        ? "thinking…"
                        : elapsed < 12
                          ? `working on it… ${elapsed}s`
                          : `still going — this one needs a few steps… ${elapsed}s`}
                  </span>
                </div>
              </div>
            )}

            {/* The work, as it happens. This is the whole point: fifteen silent
                seconds and a hang looked identical, and the trace that already
                existed only arrived once everything was over. */}
            {loading && liveTrace.length > 0 && (
              <div className="ml-9 space-y-1">
                {liveTrace.map((t, i) => (
                  <div
                    key={i}
                    className="mise-pop flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-faint"
                  >
                    <span aria-hidden className="mt-px shrink-0">
                      {t.kind === "tool" ? "🔧" : "💭"}
                    </span>
                    <span className="min-w-0">
                      {t.kind === "tool" ? (
                        <>
                          <b className="font-medium text-fg-soft">{t.name}</b>
                          {t.input ? <span className="opacity-80"> · {t.input}</span> : null}
                        </>
                      ) : (
                        t.text
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* The reply, arriving as it is written. */}
            {loading && liveText && (
              <div className="flex justify-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-[13px] text-white shadow-sm" aria-hidden>✨</span>
                <div className="mise-chat-msg max-w-[85%] rounded-2xl rounded-bl-md border border-glass/10 bg-paper-3 px-4 py-3 text-sm leading-relaxed text-fg">
                  {liveText}
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-brand-400 align-text-bottom" />
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

          {/* Staged attachment: visible, removable, and NOT yet sent. */}
          {staged && (
            <div className="mise-pop flex items-center gap-2.5 border-t border-glass/10 bg-paper-3/60 px-3 py-2">
              {staged.mime.startsWith("image/") ? (
                <img src={staged.dataUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-glass/15 object-cover" />
              ) : (
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-glass/15 bg-paper-3 text-lg">
                  {fileGlyph(staged.mime, staged.name)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{staged.name}</span>
                <span className="block text-[10px] text-fg-faint">
                  {prettySize(staged.size)} · add a question, then send
                </span>
              </span>
              <button
                type="button"
                onClick={() => setStaged(null)}
                aria-label="Remove attachment"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-faint transition hover:bg-glass/10 hover:text-fg"
              >
                ✕
              </button>
            </div>
          )}

          {/* Composer */}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="relative flex items-center gap-2 border-t border-glass/10 bg-paper-3/40 p-3">
            <input ref={fileRef} type="file" accept="*/*" onChange={onFile} className="hidden" />
            <button type="button" onClick={() => chooseAttach("chat:auto")} aria-label="Attach a file" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-glass/15 text-lg text-fg-soft transition hover:bg-glass/5">📎</button>
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
            {/* A textarea that grows with what you write. It was a single-line
                input, so anything past one line scrolled out of sight and you
                could not read your own message before sending it. */}
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a new line, as everywhere else.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={voice.listening ? "Listening…" : "Ask me anything…"}
              // min-h + overflow-hidden rather than a fixed row count: a one-row
              // box cannot show a placeholder that wraps, and cutting it mid-word
              // is the first thing anyone sees on a phone.
              className="mise-chat-input min-h-[2.75rem] min-w-0 flex-1 resize-none overflow-hidden rounded-xl border border-glass/15 bg-paper px-3.5 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus:border-brand-500/50 focus:outline-none"
            />
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
            <button type="submit" disabled={loading || (!input.trim() && !staged)} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-40">↑</button>
          </form>
        </div>
      )}
    </>
  );
}
