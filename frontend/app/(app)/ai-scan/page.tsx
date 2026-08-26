"use client";

import { Typewriter } from "@/components/Typewriter";


// The AI surface is a CONVERSATION, not a form.
//
// You send a photo of a supplier bill (or a handwritten recipe) the way you'd
// send it to a colleague on WhatsApp. It comes back as a chat reply — but that
// reply is a live card: every value is tap-to-fix in place, and anything the AI
// wasn't sure of is flagged amber rather than quietly guessed. Nothing reaches
// the books until you tap Save. The AI proposes; you dispose.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { API_BASE, ApiError, api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

/* ── shapes ────────────────────────────────────────────────────────────── */

type Line = {
  name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
  matched_item_id: string | null;
  confident: boolean;
};

type Scan = {
  doc_type: "bill" | "recipe";
  /** A water bill is a real bill, but it is not a sack of rice. */
  bill_for?: "goods" | "overhead" | null;
  vendor_name?: string | null;
  invoice_number?: string | null;
  date?: string | null;
  total?: number | null;
  lines?: Line[];
  name?: string | null;
  serves?: number | null;
  ingredients?: Line[];
  steps?: string[];
  notes?: string | null;
};

type Draft = {
  doc: "bill" | "recipe";
  vendor: string;
  date: string;
  total: string;
  category: string;
  overhead: boolean;
  title: string;
  serves: number | null;
  steps: string[];
  lines: Line[];
  state: "open" | "saved" | "gone";
  savedId?: string;
};

type Action = { label: string; href: string };

type Msg =
  | { id: string; who: "ai" | "me"; kind: "text"; text: string; actions?: Action[]; choices?: string[]; at?: number }
  | { id: string; who: "me"; kind: "photo"; url: string; name: string }
  | { id: string; who: "ai"; kind: "thinking"; note: string }
  | { id: string; who: "ai"; kind: "card" }
  | { id: string; who: "ai"; kind: "offer"; text: string };

let seq = 0;
const nid = () => `m${++seq}`;
const now = () => Date.now();

const GREETING =
  "Hi! Send me a photo of a supplier bill and I'll read it into your books — " +
  "or a handwritten recipe and I'll type it up. Tap any value in my reply to " +
  "correct it; nothing is saved until you say so.";

/* ── little pieces ─────────────────────────────────────────────────────── */

/** Tap-to-edit value. Reads as text until you touch it, then it's an input. */
function Editable({
  value,
  onChange,
  placeholder = "—",
  type = "text",
  wide = false,
  alert = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "decimal";
  wide?: boolean;
  alert?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={ref}
        type={type === "date" ? "date" : "text"}
        inputMode={type === "decimal" ? "decimal" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") setEditing(false);
        }}
        className={`mise-well rounded-lg px-2 py-1 text-sm text-fg outline-none ring-2 ring-brand-500/40 ${
          wide ? "w-full" : "w-28"
        }`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Tap to correct"
      className={`group rounded-lg px-2 py-1 text-left text-sm transition-colors ${
        wide ? "w-full" : ""
      } ${
        alert
          ? "bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
          : "text-fg hover:bg-paper-2"
      }`}
    >
      {value || <span className="text-fg-faint">{placeholder}</span>}
      <span className="ml-1.5 text-[10px] text-fg-faint opacity-0 transition-opacity group-hover:opacity-100">
        ✎
      </span>
    </button>
  );
}

function Bubble({
  who,
  children,
  tight = false,
  grouped = false,
  at,
}: {
  who: "ai" | "me";
  children: React.ReactNode;
  tight?: boolean;
  /** Same speaker as the message above: drop the avatar and tighten the gap. */
  grouped?: boolean;
  at?: number;
}) {
  const mine = who === "me";
  return (
    <div
      className={`ai-rise group flex gap-2.5 ${mine ? "flex-row-reverse" : ""} ${
        grouped ? "-mt-2" : ""
      }`}
    >
      {!mine &&
        (grouped ? (
          <span className="w-8 shrink-0" aria-hidden />
        ) : (
          <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-sky-400 text-sm text-white shadow-lg shadow-brand-500/20">
            ✦
          </div>
        ))}
      <div
        className={`max-w-[min(54rem,78%)] rounded-2xl ${
          tight ? "p-2" : "px-5 py-4"
        } text-[15px] leading-[1.65] ${
          mine
            ? "mise-press rounded-br-md bg-brand-600 text-white shadow-lg shadow-brand-900/20"
            : "mise-card-inset rounded-bl-md text-fg"
        }`}
      >
        {children}
      </div>
      {/* Timestamps on hover only — useful when you want them, noise when you
          don't, and a chat covered in clock text reads like a log file. */}
      {at && (
        <span className="self-end pb-1 text-[10px] text-fg-faint opacity-0 transition-opacity group-hover:opacity-100">
          {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default function AiScanPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "expenses:write");

  const [status, setStatus] = useState<{ configured: boolean; reason?: string } | null>(null);
  // what plan + model this hotel is on — people should know what they're using
  const [usage, setUsage] = useState<{ plan?: string; model?: string; today_calls?: number; daily_limit?: number } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: nid(), who: "ai", kind: "text", text: GREETING },
  ]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  // The id of the reply that just arrived; only that one types itself out.
  const [liveId, setLiveId] = useState<string | null>(null);
  // Past conversations. "New chat" never deleted anything — but with no way
  // back to the old thread it may as well have.
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  const loadThreads = useCallback(() => {
    api
      .get<{ threads: { id: string; title: string }[] }>("/assistant/threads")
      .then((d) => setThreads(d.threads))
      .catch(() => {});
  }, []);

  async function openThread(id: string) {
    setShowThreads(false);
    const d = await api.get<{ thread_id: string; messages: { role: string; content: string }[] }>(
      `/assistant/history?thread=${id}`,
    );
    setThreadId(d.thread_id);
    setMsgs(
      d.messages.length
        ? d.messages.map((m) => ({
            id: nid(),
            who: (m.role === "assistant" ? "ai" : "me") as "ai" | "me",
            kind: "text" as const,
            text: m.content,
          }))
        : [{ id: nid(), who: "ai", kind: "text", text: GREETING }],
    );
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // The conversation lives on the server against THIS person, so it survives a
  // reload, a new tab, another device and logging out. sessionStorage was only
  // ever a stopgap for the expand animation.
  useEffect(() => {
    sessionStorage.removeItem("copilot:thread");
    api
      .get<{ thread_id: string; messages: { role: string; content: string }[] }>(
        "/assistant/history",
      )
      .then((d) => {
        setThreadId(d.thread_id);
        loadThreads();
        if (!d.messages.length) return;
        setMsgs(
          d.messages.map((m) => ({
            id: nid(),
            who: (m.role === "assistant" ? "ai" : "me") as "ai" | "me",
            kind: "text" as const,
            text: m.content,
          })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get<{ configured: boolean; reason?: string }>("/assistant/vision/status")
      .then(setStatus)
      .catch(() => setStatus({ configured: false }));
    api
      .get<{ plan?: string; model?: string; today_calls?: number; daily_limit?: number }>(
        "/assistant/usage",
      )
      .then(setUsage)
      .catch(() => {});
  }, []);

  // keep the newest message in view — a chat that doesn't follow you is broken
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const push = useCallback((m: Msg) => setMsgs((prev) => [...prev, m]), []);
  const drop = useCallback(
    (id: string) => setMsgs((prev) => prev.filter((m) => m.id !== id)),
    [],
  );
  const say = useCallback(
    (text: string, actions?: Action[], choices?: string[]) => {
      const id = nid();
      setLiveId(id);
      push({ id, who: "ai", kind: "text", text, actions, choices, at: now() });
    },
    [push],
  );

  // A file handed over from the voice panel. It travels in memory rather than
  // through storage: it is a photo of a bill, it is only wanted for the next
  // second, and putting it anywhere persistent would be a copy of his paperwork
  // nobody asked for.
  useEffect(() => {
    const w = window as Window & { __miseHandoff?: File };
    const file = w.__miseHandoff;
    if (!file) return;
    delete w.__miseHandoff;
    void read(file);
    // Mount only: a handoff is consumed once, by the load it arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start a fresh conversation, keeping the old ones. */
  async function newChat() {
    try {
      const d = await api.post<{ thread_id: string }>("/assistant/history/new", {});
      setThreadId(d.thread_id);
    } catch {
      setThreadId(null);
    }
    setMsgs([{ id: nid(), who: "ai", kind: "text", text: GREETING }]);
    loadThreads();
  }

  /* photo → Bedrock → a live card in the thread */
  async function read(file: File) {
    setBusy(true);
    push({ id: nid(), who: "me", kind: "photo", url: URL.createObjectURL(file), name: file.name });
    const thinking = nid();
    push({ id: thinking, who: "ai", kind: "thinking", note: "Reading your photo…" });

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "auto");
      const res = await fetch(`${API_BASE}/api/assistant/vision/read`, {
        method: "POST",
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new ApiError(res.status, body?.detail || "Could not read that");

      const s = body as Scan;
      const lines = (s.doc_type === "recipe" ? s.ingredients : s.lines) ?? [];
      const cardId = nid();
      setDrafts((d) => ({
        ...d,
        [cardId]: {
          doc: s.doc_type === "recipe" ? "recipe" : "bill",
          vendor: s.vendor_name ?? "",
          date: (s.date ?? "").slice(0, 10),
          total: s.total != null ? String(s.total) : "",
          category: s.bill_for === "overhead" ? "Utilities" : "Food",
          overhead: s.bill_for === "overhead",
          title: s.name ?? "",
          serves: s.serves ?? null,
          steps: s.steps ?? [],
          lines,
          state: "open",
        },
      }));

      drop(thinking);
      const unsure = lines.filter((l) => !l.confident).length;
      say(
        s.doc_type === "recipe"
          ? `Got it — that's a recipe with ${lines.length} ingredient${lines.length === 1 ? "" : "s"}.`
          : s.bill_for === "overhead"
            ? `That's an overhead bill${s.vendor_name ? ` from ${s.vendor_name}` : ""}, not a delivery — so it belongs in Expenses rather than the stock room. I've read the amounts; save it as an expense and nothing touches your stock.`
            : `Here's what I read${s.vendor_name ? ` from ${s.vendor_name}` : ""}.` +
              (unsure
                ? ` ${unsure} value${unsure === 1 ? "" : "s"} I couldn't read cleanly — they're marked in amber, please check those.`
                : " Everything came through clearly, but have a quick look before you save."),
      );
      push({ id: cardId, who: "ai", kind: "card" });
    } catch (e) {
      drop(thinking);
      if (e instanceof ApiError && e.status === 429) {
        // the plan doesn't cover this — answer in-character and offer the upgrade
        push({ id: nid(), who: "ai", kind: "offer", text: e.message });
      } else {
        say(
          e instanceof ApiError
            ? `Sorry — ${e.message}`
            : "Sorry, I couldn't read that photo. A flatter page in better light usually does it.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /* typed message → the Copilot, so this is a real conversation */
  async function send(preset?: string) {
    const q = (preset ?? text).trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    push({ id: nid(), who: "me", kind: "text", text: q, at: now() });
    const thinking = nid();
    push({ id: thinking, who: "ai", kind: "thinking", note: "Thinking…" });

    const history = msgs
      .filter((m): m is Extract<Msg, { kind: "text" }> => m.kind === "text")
      .slice(-8)
      .map((m) => ({ role: m.who === "ai" ? "assistant" : "user", content: m.text }));

    try {
      const r = await api.post<{ reply: string; actions?: Action[]; choices?: string[]; thread_id?: string }>(
        "/assistant/chat",
        {
          messages: [...history, { role: "user", content: q }],
          route: "/ai-scan",
          thread_id: threadId,
        },
      );
      if (r.thread_id) setThreadId(r.thread_id);
      drop(thinking);
      say(r.reply, r.actions, r.choices);
    } catch (e) {
      drop(thinking);
      say(e instanceof ApiError ? `Sorry — ${e.message}` : "Sorry, I couldn't answer that.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(cardId: string) {
    const d = drafts[cardId];
    if (!d || busy) return;
    setBusy(true);
    const thinking = nid();
    push({ id: thinking, who: "ai", kind: "thinking", note: "Saving it…" });
    try {
      const r = await api.post<{ expense_id: string; amount: string; date: string }>(
        "/assistant/vision/commit",
        {
          vendor_name: d.vendor || null,
          date: d.date || null,
          total: parseFloat(d.total),
          category: d.category,
          lines: d.lines.map((l) => ({
            name: l.name,
            qty: l.qty,
            unit: l.unit,
            line_total: l.line_total,
          })),
        },
      );
      setDrafts((prev) => ({ ...prev, [cardId]: { ...d, state: "saved", savedId: r.expense_id } }));
      drop(thinking);
      say(`Done — ${format(r.amount)} is in your books${d.vendor ? ` under ${d.vendor}` : ""}. 🎉`, [
        { label: "Open Expenses", href: "/expenses" },
      ]);
    } catch (e) {
      drop(thinking);
      say(e instanceof ApiError ? `I couldn't save it — ${e.message}` : "I couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  function patch(cardId: string, part: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [cardId]: { ...prev[cardId], ...part } }));
  }

  function patchLine(cardId: string, i: number, part: Partial<Line>) {
    setDrafts((prev) => {
      const d = prev[cardId];
      const lines = d.lines.map((l, j) => (j === i ? { ...l, ...part, confident: true } : l));
      return { ...prev, [cardId]: { ...d, lines } };
    });
  }

  const offline = status !== null && !status.configured;
  const left = Math.max(0, (usage?.daily_limit ?? 0) - (usage?.today_calls ?? 0));

  /* ── the interactive reply card ──────────────────────────────────────── */
  function Card({ id }: { id: string }) {
    const d = drafts[id];
    if (!d) return null;

    if (d.state === "gone") {
      return <p className="px-2 py-1 text-sm text-fg-faint">Discarded.</p>;
    }

    const unsure = d.lines.filter((l) => !l.confident).length;
    const bill = d.doc === "bill";
    const done = d.state === "saved";

    return (
      <div className={`w-full ${done ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1.5">
          <span className="text-sm font-semibold text-fg">
            {bill ? "🧾 Supplier bill" : "📖 Recipe"}
          </span>
          {done ? (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              SAVED ✓
            </span>
          ) : unsure > 0 ? (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
              {unsure} to check
            </span>
          ) : null}
        </div>

        {bill && d.overhead ? (
          // A water bill filed under "Food" quietly inflates food-cost % — the
          // one number this whole app is built to get right. Say what it is and
          // pre-file it correctly, rather than defaulting everything to Food.
          <p className="mise-tone-info mt-2 rounded-xl px-3 py-2 text-xs leading-relaxed">
            This looks like an <b>overhead</b> — utilities, rent or a service, not a
            delivery. It is filed under <b>{d.category}</b> so it does not count against
            your food cost. Change the category if that is wrong.
          </p>
        ) : null}
        {bill ? (
          <div className="mt-2 grid gap-1 px-1 sm:grid-cols-2">
            {(
              [
                ["Supplier", d.vendor, (v: string) => patch(id, { vendor: v }), "text"],
                ["Date", d.date, (v: string) => patch(id, { date: v }), "date"],
                ["Total", d.total, (v: string) => patch(id, { total: v }), "decimal"],
                ["Category", d.category, (v: string) => patch(id, { category: v }), "text"],
              ] as const
            ).map(([label, value, set, type]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded-lg px-1">
                <span className="text-xs font-medium text-fg-faint">{label}</span>
                {done ? (
                  <span className="px-2 py-1 text-sm text-fg">{value || "—"}</span>
                ) : (
                  <Editable value={value} onChange={set} type={type} alert={!value} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 px-2">
            <p className="text-base font-semibold text-fg">{d.title || "Untitled recipe"}</p>
            {d.serves ? <p className="text-xs text-fg-faint">serves {d.serves}</p> : null}
          </div>
        )}

        {d.lines.length > 0 && (
          <ul className="mt-2 divide-y divide-line/60 rounded-xl border border-line/60">
            {d.lines.map((l, i) => (
              <li
                key={i}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${
                  !l.confident ? "bg-amber-500/5" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {l.name}
                  {!l.confident && (
                    <span className="ml-1.5 text-[10px] font-semibold text-amber-400">CHECK</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-fg-faint">
                  {done ? (
                    `${l.qty ?? "—"} ${l.unit ?? ""}`
                  ) : (
                    <Editable
                      value={l.qty != null ? String(l.qty) : ""}
                      onChange={(v) => patchLine(id, i, { qty: v === "" ? null : Number(v) })}
                      type="decimal"
                      placeholder="qty"
                      alert={!l.confident}
                    />
                  )}
                </span>
                {bill && (
                  <span className="w-24 shrink-0 text-right text-sm font-medium text-fg">
                    {done || l.line_total == null ? (
                      l.line_total != null ? (
                        format(String(l.line_total))
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )
                    ) : (
                      <Editable
                        value={String(l.line_total)}
                        onChange={(v) =>
                          patchLine(id, i, { line_total: v === "" ? null : Number(v) })
                        }
                        type="decimal"
                        alert={!l.confident}
                      />
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {!bill && d.steps.length > 0 && (
          <ol className="mt-2 list-decimal space-y-1 pl-6 pr-2 text-sm text-fg-soft">
            {d.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}

        {!done && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-1 pb-1">
            {bill ? (
              <button
                type="button"
                onClick={() => approve(id)}
                disabled={busy || !canWrite || !d.total}
                className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                ✓ Save to Expenses
              </button>
            ) : (
              <span className="px-1 text-xs text-fg-faint">
                Recipe saving lands next — copy what you need into Recipes for now.
              </span>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-line px-3 py-2 text-sm text-fg-soft hover:bg-paper-2"
            >
              Another photo
            </button>
            <button
              type="button"
              onClick={() => patch(id, { state: "gone" })}
              className="rounded-xl px-3 py-2 text-sm text-fg-faint hover:bg-paper-2"
            >
              Discard
            </button>
          </div>
        )}

        {done && d.savedId && (
          <div className="px-2 pb-1">
            <Link href="/expenses" className="text-xs text-brand-400 underline">
              See it in Expenses →
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    // "take that entire square screen and in left side you can keep the
    //  history other stuff and all (with inside outside closing feature)..
    //  right side you can keep the full chat... it looks like a rectangle now"
    //
    // It WAS a rectangle: a 64rem column centred in a 1440px window, with the
    // history hidden in a dropdown. Now the room is used — a rail on the left
    // that opens and closes, and the conversation taking everything else.
    <div className="mise-page-grow -mb-28 flex h-[calc(100dvh-12rem)] w-full gap-4 lg:h-[calc(100dvh-7rem)]">
      <style>{`
        @keyframes aiRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ai-rise { animation: aiRise .32s cubic-bezier(.22,1,.36,1) both; }
        @keyframes aiDot { 0%,80%,100% { transform: translateY(0); opacity: .35 } 40% { transform: translateY(-4px); opacity: 1 } }
        .ai-dot { animation: aiDot 1.2s infinite; }
      `}</style>

      {/* The left pane. Hidden on phones, where a rail would eat the
          conversation it exists to serve. */}
      {railOpen && (
        <aside className="mise-chat-rail hidden w-64 shrink-0 flex-col overflow-hidden rounded-3xl lg:flex">
          <span aria-hidden className="mise-voice-aurora" data-phase="idle">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div className="relative flex items-center justify-between px-4 pb-2 pt-4">
            <p className="font-display text-sm font-semibold text-fg">Conversations</p>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              title="Hide this panel"
              aria-label="Hide the conversations panel"
              className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:text-fg"
            >
              ‹
            </button>
          </div>
          <button
            type="button"
            onClick={() => newChat()}
            className="mise-press mise-card-inset relative mx-3 mb-2 rounded-xl px-3 py-2 text-left text-[13px] text-fg"
          >
            + New chat
          </button>
          <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {threads.length === 0 ? (
              <p className="px-3 py-3 text-xs text-fg-faint">No earlier conversations yet.</p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t.id)}
                  className={`mise-press block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-glass/5 ${
                    t.id === threadId ? "text-brand-300" : "text-fg-soft"
                  }`}
                >
                  {t.title}
                </button>
              ))
            )}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Closing the rail must not be a one-way door. */}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            title="Show conversations"
            className="mise-press mb-2 hidden w-fit items-center gap-1.5 rounded-xl border border-line px-2.5 py-1.5 text-[12px] text-fg-soft hover:text-fg lg:flex"
          >
            › Conversations
          </button>
        )}

      {/* Header modelled on the recipe sheet: an identity block, a progress
          RING, and stat tiles with big legible numbers. The old version buried
          the same facts in 11px grey text nobody reads. */}
      <header className="mise-neo-raised relative mb-3 overflow-hidden rounded-2xl px-4 py-3">
        {/* The same aurora as the voice bubble - one assistant, heard or read. */}
        <span aria-hidden className="mise-voice-aurora" data-phase="idle">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div className="relative flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-sky-400 text-base text-white shadow-lg shadow-brand-500/25">
            ✦
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight text-fg">DineAI Copilot</h1>
            <p className="truncate text-xs text-fg-faint">
              {offline ? "AI is switched off" : "Ask anything, or send any file"}
            </p>
          </div>
          {/* Allowance as a ring, the way the recipe sheet shows margin:
              a shape you read in a glance beats a number you have to parse. */}
          {usage?.daily_limit ? (
            <div className="relative hidden h-12 w-12 shrink-0 sm:block" title="AI questions left today">
              <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-line" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
                  className={left / (usage.daily_limit || 1) > 0.25 ? "stroke-brand-500" : "stroke-amber-400"}
                  strokeDasharray={`${(left / (usage.daily_limit || 1)) * 97.4} 97.4`}
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-fg">
                {left}
              </span>
            </div>
          ) : null}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              loadThreads();
              setShowThreads((v) => !v);
            }}
            title="Past conversations"
            className="mise-press flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 8v4l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.5 4" />
            </svg>
            <span className="hidden sm:inline">History</span>
          </button>
          {showThreads && (
            <>
              <div className="fixed inset-0 z-[55]" onClick={() => setShowThreads(false)} aria-hidden />
              <div className="mise-pop absolute right-0 top-11 z-[60] max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-paper-2/95 p-1.5 shadow-2xl backdrop-blur">
                {threads.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-fg-faint">No earlier conversations yet.</p>
                ) : (
                  threads.map((t) => (
                    <div key={t.id} className="group/row flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openThread(t.id)}
                        className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition hover:bg-glass/5 ${
                          t.id === threadId ? "text-brand-300" : "text-fg-soft"
                        }`}
                      >
                        {t.title}
                      </button>
                      <button
                        type="button"
                        title="Rename"
                        onClick={async () => {
                          const next = window.prompt("Name this conversation", t.title);
                          if (next === null) return;
                          try {
                            await api.patch(`/assistant/threads/${t.id}`, { title: next });
                            setThreads((prev) =>
                              prev.map((x) => (x.id === t.id ? { ...x, title: next.trim() || x.title } : x)),
                            );
                          } catch {
                            /* leave the old name rather than show a half-renamed list */
                          }
                        }}
                        className="rounded-md px-1.5 py-1 text-[11px] text-fg-faint opacity-0 transition hover:text-brand-300 group-hover/row:opacity-100"
                      >
                        ✎
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={newChat}
          title="New chat — your old conversations are kept"
          className="mise-press flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden sm:inline">New chat</span>
        </button>
        </div>

        {/*  "how tight it is.. make it free... this expanded look is very very
            poor to see."

            These were three full-height tiles announcing Model / Plan /
            Questions-left above the conversation. On a laptop that is a
            quarter of the window spent on facts that do not change during a
            chat, and the chat itself got what was left — which is the band he
            screenshotted. They are the same three facts, now a line of chips
            in the header, and the conversation gets the room back.  */}
        {usage?.model && (
          <div className="relative mt-2 flex flex-wrap items-center gap-1.5">
            {(
              [
                ["Model", usage.model.includes("haiku") ? "Haiku" : "Sonnet"],
                ["Plan", usage.plan ?? "—"],
                ["Left today", usage.daily_limit ? String(left) : "—"],
              ] as const
            ).map(([label, value]) => (
              <span
                key={label}
                className="mise-card-inset rounded-full px-2.5 py-1 text-[11px] text-fg-soft"
              >
                <span className="text-fg-faint">{label}</span>{" "}
                <span className="font-semibold text-fg">{value}</span>
              </span>
            ))}
          </div>
        )}
      </header>

      {offline && (
        <div className="mise-feel mb-3 rounded-xl border border-amber-500/30 px-4 py-3">
          <p className="text-sm font-semibold text-amber-300">The AI isn&apos;t switched on yet</p>
          <p className="mt-0.5 text-xs text-fg-faint">
            {status?.reason ?? "Model access is still pending."}
          </p>
        </div>
      )}

      {/* the thread */}
      <div className="mise-chat-shell relative flex min-h-0 flex-1 overflow-hidden rounded-3xl">
        {/* "we need aurora effect for the entire chat ui interface."
            It sits on the SHELL, not inside the scroller: an absolutely
            positioned layer inside an overflow-y-auto box sizes to the content
            rather than the visible area, so it would scroll away — and a
            `fixed` one would pin itself to the whole window instead. */}
        <span aria-hidden className="mise-voice-aurora" data-phase="idle">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div className="mise-chat-log relative z-[1] flex-1 space-y-8 overflow-y-auto p-5 sm:p-8">
        {msgs.map((m, i) => {
          // grouped = same speaker as the message above
          const prev = msgs[i - 1];
          const grouped = Boolean(prev && prev.who === m.who && prev.kind !== "card");
          if (m.kind === "photo") {
            return (
              <Bubble key={m.id} who="me" tight grouped={grouped}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.name}
                  className="max-h-64 w-full rounded-xl object-contain"
                />
              </Bubble>
            );
          }
          if (m.kind === "thinking") {
            return (
              <Bubble key={m.id} who="ai">
                <span className="flex items-center gap-2 text-fg-faint">
                  <span className="mise-breathe flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="ai-dot h-1.5 w-1.5 rounded-full bg-brand-400"
                        style={{ animationDelay: `${i * 0.16}s` }}
                      />
                    ))}
                  </span>
                  {m.note}
                </span>
              </Bubble>
            );
          }
          if (m.kind === "offer") {
            return (
              <Bubble key={m.id} who="ai">
                <Typewriter text={m.text} animate={m.who === "ai" && m.id === liveId} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/settings?tab=plan"
                    className="mise-press rounded-lg bg-gradient-to-r from-brand-500 to-sky-400 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    See what Service adds →
                  </Link>
                  <button
                    type="button"
                    onClick={() => say("No problem — carry on. What else can I help with?")}
                    className="rounded-lg bg-paper-2 px-3 py-1.5 text-xs font-medium text-fg-soft hover:bg-paper-3"
                  >
                    Not now
                  </button>
                </div>
              </Bubble>
            );
          }
          if (m.kind === "card") {
            return (
              <Bubble key={m.id} who="ai" tight>
                <Card id={m.id} />
              </Bubble>
            );
          }
          return (
            <Bubble key={m.id} who={m.who} grouped={grouped} at={m.at}>
              <Typewriter text={m.text} animate={m.who === "ai" && m.id === liveId} />
              {m.choices && m.choices.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {m.choices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => send(c)}
                      disabled={busy}
                      className="mise-press rounded-full border border-brand-400/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-500/20 disabled:opacity-50"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {m.actions && m.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.actions.map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="mise-press rounded-lg bg-paper-2 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-paper-3"
                    >
                      {a.label} →
                    </Link>
                  ))}
                </div>
              )}
            </Bubble>
          );
        })}
        {/* Openers, shown only while the thread is still empty. Chips that
            persist through a conversation become wallpaper. */}
        {msgs.length <= 2 && !busy && (
          <div className="ai-rise flex flex-wrap gap-2 pl-11">
            {[
              "What's low on stock?",
              "How's this month's profit?",
              "Which dishes make the least?",
              "Who's on the rota today?",
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="mise-press rounded-full border border-line px-3 py-1.5 text-xs text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      </div>

      {/* composer */}
      <div className="pt-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) read(f);
            e.target.value = "";
          }}
        />
        <div className="mise-chat-composer flex items-end gap-2 rounded-2xl p-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || offline}
            title="Photograph a bill or recipe"
            className="mise-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-lg text-white hover:bg-brand-700 disabled:opacity-50"
          >
            📷
          </button>
          <textarea
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // Grow to fit, capped so the thread never loses the screen.
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask, or send a file…"
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none overflow-hidden bg-transparent px-1 py-2 text-sm text-fg outline-none placeholder:text-fg-faint"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !text.trim()}
            className="mise-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
          >
            ➤
          </button>
        </div>
        <p className="px-2 pt-1.5 text-[11px] text-fg-faint">
          Nothing is written to your books until you tap Save.
        </p>
        </div>
      </div>
    </div>
  );
}
