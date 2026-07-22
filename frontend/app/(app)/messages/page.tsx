"use client";

// 💬 Messages — WhatsApp-style hotel-to-hotel chat. Every message is stored in
// the database (persisted forever), so threads survive reloads and sign-outs.
// The list polls every 4s; the open thread every 3s (near-live without sockets).

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui";

type ChatSummary = {
  chat_id: string;
  other_hotel: string;
  other_hotel_id: string;
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
};
type Msg = {
  id: string;
  mine: boolean;
  sender_name: string;
  body: string;
  created_at: string;
};

const monogram = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

function timeShort(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function MessagesInner() {
  const params = useSearchParams();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<string | null>(null);
  useEffect(() => { openRef.current = openId; }, [openId]);

  const loadChats = useCallback(() => {
    api.get<ChatSummary[]>("/talent/chats").then(setChats).catch(() => setChats([]));
  }, []);

  const loadThread = useCallback((id: string) => {
    api.get<{ other_hotel: string; messages: Msg[] }>(`/talent/chats/${id}/messages`)
      .then((r) => {
        setOpenName(r.other_hotel);
        setMsgs(r.messages);
      })
      .catch(() => {});
  }, []);

  // open a specific chat if ?chat= or ?post= is present (from careers "Chat")
  useEffect(() => {
    loadChats();
    const chat = params.get("chat");
    const post = params.get("post");
    if (chat) {
      setOpenId(chat);
    } else if (post) {
      api.post<{ chat_id: string }>("/talent/chats/open", { staff_post_id: post })
        .then((r) => setOpenId(r.chat_id))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // poll the chat list (unread counts move)
  useEffect(() => {
    const t = window.setInterval(loadChats, 4000);
    return () => window.clearInterval(t);
  }, [loadChats]);

  // load + poll the open thread
  useEffect(() => {
    if (!openId) return;
    loadThread(openId);
    const t = window.setInterval(() => { if (openRef.current) loadThread(openRef.current); }, 3000);
    return () => window.clearInterval(t);
  }, [openId, loadThread]);

  // autoscroll to newest when the thread grows
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, openId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !openId) return;
    setSending(true);
    setDraft("");
    // optimistic bubble
    const temp: Msg = {
      id: `tmp-${Date.now()}`, mine: true, sender_name: "You",
      body, created_at: new Date().toISOString(),
    };
    setMsgs((m) => [...m, temp]);
    try {
      await api.post(`/talent/chats/${openId}/messages`, { body });
      loadThread(openId);
      loadChats();
    } finally {
      setSending(false);
    }
  }

  // day-divider grouping — precompute which messages open a new day (pure)
  const dayBreaks = new Set<string>();
  {
    let seen = "";
    for (const m of msgs) {
      const dl = dayLabel(m.created_at);
      if (dl !== seen) { dayBreaks.add(m.id); seen = dl; }
    }
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Chat with other Mise hotels about lending & hiring staff. Every message is saved."
      />
      <div className="mise-feel grid h-[70vh] grid-cols-1 overflow-hidden rounded-2xl border border-line bg-paper sm:grid-cols-[300px_1fr]">
        {/* chat list */}
        <div className={`flex flex-col border-line sm:border-r ${openId ? "hidden sm:flex" : "flex"}`}>
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">Chats</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats === null ? (
              <p className="p-4 text-sm text-fg-faint">Loading…</p>
            ) : chats.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-3xl" aria-hidden>💬</p>
                <p className="mt-2 text-sm font-medium text-fg">No chats yet</p>
                <p className="mt-1 text-xs text-fg-faint">
                  Open <b className="text-fg-soft">Careers → Available staff</b> and tap
                  &ldquo;Chat&rdquo; on a listing to start talking to another hotel.
                </p>
              </div>
            ) : (
              chats.map((c) => (
                <button
                  key={c.chat_id}
                  type="button"
                  onClick={() => { setOpenId(c.chat_id); setOpenName(c.other_hotel); }}
                  className={`flex w-full items-center gap-3 border-b border-line/50 px-3 py-3 text-left transition hover:bg-fg/[0.03] ${openId === c.chat_id ? "bg-brand-500/5" : ""}`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-400 text-xs font-bold text-white">
                    {monogram(c.other_hotel)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{c.other_hotel}</span>
                      {c.last_message_at && (
                        <span className="shrink-0 text-[10px] text-fg-faint">{timeShort(c.last_message_at)}</span>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-fg-faint">{c.last_message ?? "—"}</span>
                      {c.unread > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* thread */}
        <div className={`flex flex-col ${openId ? "flex" : "hidden sm:flex"}`}>
          {openId ? (
            <>
              <div className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-brand-500/10 to-transparent px-4 py-3">
                <button type="button" onClick={() => setOpenId(null)} className="mise-press sm:hidden text-lg text-fg-faint">←</button>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-400 text-xs font-bold text-white shadow-lg shadow-brand-500/20">
                  {monogram(openName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">{openName}</p>
                  <p className="text-[10px] text-fg-faint">🔒 messages saved &amp; private to your two hotels</p>
                </div>
              </div>
              <div ref={threadRef} className="mise-chat-bg min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
                {msgs.map((m) => {
                  const showDay = dayBreaks.has(m.id);
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <p className="my-3 text-center text-[10px] font-semibold uppercase tracking-wide text-fg-faint">{dayLabel(m.created_at)}</p>
                      )}
                      <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${m.mine ? "rounded-br-sm bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-brand-500/20" : "mise-well rounded-bl-sm text-fg"}`}>
                          {!m.mine && <p className="mb-0.5 text-[10px] font-semibold text-brand-400">{m.sender_name}</p>}
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <p className={`mt-0.5 text-right text-[9px] ${m.mine ? "text-white/70" : "text-fg-faint"}`}>{timeShort(m.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {msgs.length === 0 && (
                  <p className="pt-10 text-center text-sm text-fg-faint">Say hello 👋</p>
                )}
              </div>
              <form onSubmit={send} className="flex items-center gap-2 border-t border-line px-3 py-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message…"
                  className="mise-well flex-1 rounded-full px-4 py-2.5 text-sm text-fg outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="mise-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white disabled:opacity-50"
                  aria-label="Send"
                >
                  ➤
                </button>
              </form>
            </>
          ) : (
            <div className="hidden flex-1 place-items-center text-center sm:grid">
              <div>
                <p className="text-4xl" aria-hidden>💬</p>
                <p className="mt-2 text-sm text-fg-faint">Pick a chat to start talking</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-fg-faint">Loading…</p>}>
      <MessagesInner />
    </Suspense>
  );
}
