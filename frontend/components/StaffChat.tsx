"use client";

// The conversation between a member of staff and their manager.
//
//   "here i want one comment kinda feature. staff can comment that owner can
//    see, owner can comment that staff can see here. they even can chat like
//    whatsapp. make this chat history persistent"
//
// One component, both sides. The only thing that differs is which endpoint it
// talks to and which bubbles count as "mine" — writing it twice would be two
// chat UIs that drift apart, and the half-attended one always drifts worse.
//
// It polls rather than holding a socket. This is a handful of messages a day
// between two people who are rarely both looking, so a socket would be a lot of
// moving parts for a conversation that is usually asleep — and the poll pauses
// entirely while the tab is hidden, so an idle kitchen tablet costs nothing.

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";

export type ChatMessage = {
  id: string;
  body: string;
  from_staff: boolean;
  sender_name: string;
  created_at: string;
};

export function StaffChat({
  /** Where this thread lives — "/me/messages" or "/employees/{id}/messages". */
  endpoint,
  /** Which side am I? Decides which bubbles sit on the right. */
  mine,
  emptyHint,
  className = "",
}: {
  endpoint: string;
  mine: "staff" | "owner";
  emptyHint?: string;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ messages: ChatMessage[] }>(endpoint);
      setMessages(r.messages);
    } catch {
      // A thread that will not load must not blank the page it sits on.
      setMessages((m) => m ?? []);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll, but only while somebody is actually looking. A hidden tab polling
  // every few seconds is a background cost nobody asked for.
  useEffect(() => {
    let id: number | undefined;
    const start = () => {
      stop();
      id = window.setInterval(() => {
        if (document.visibilityState === "visible") void load();
      }, 6000);
    };
    const stop = () => {
      if (id) window.clearInterval(id);
      id = undefined;
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [load]);

  // Follow the conversation down — but only if they were already at the bottom.
  // Yanking someone back while they are reading history is worse than a missed
  // scroll.
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setErr(null);
    try {
      const msg = await api.post<ChatMessage>(endpoint, { body });
      setDraft("");
      atBottom.current = true;
      setMessages((m) => [...(m ?? []), msg]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that");
    } finally {
      setSending(false);
    }
  }

  const isMine = (m: ChatMessage) => (mine === "staff" ? m.from_staff : !m.from_staff);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="mise-noscrollbar min-h-[14rem] flex-1 space-y-2.5 overflow-y-auto px-1 py-2"
      >
        {messages === null ? (
          <p className="py-8 text-center text-sm text-fg-faint">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-faint">
            <span aria-hidden className="mr-1.5 text-lg">💬</span>
            {emptyHint ?? "No messages yet — say hello."}
          </p>
        ) : (
          messages.map((m) => {
            const own = isMine(m);
            return (
              <div key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%] ${
                    own
                      ? "bg-brand-600 text-white"
                      : "mise-card-inset text-fg"
                  }`}
                >
                  {!own && (
                    <p className="mb-0.5 text-[11px] font-semibold text-fg-faint">
                      {m.sender_name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {m.body}
                  </p>
                  <p
                    className={`mt-1 text-[10px] tabular-nums ${
                      own ? "text-white/70" : "text-fg-faint"
                    }`}
                  >
                    {new Date(m.created_at).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {err && <p className="px-1 pb-1 text-[11px] text-rose-400">{err}</p>}

      <div className="flex items-end gap-2 border-t border-line/60 pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — what everyone already
            // expects from a message box.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Write a message…"
          data-testid="chat-input"
          className="mise-well max-h-32 min-h-[44px] flex-1 resize-y rounded-xl px-3.5 py-2.5 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          data-tone="brand"
          data-testid="chat-send"
          className="mise-btn-flat mise-press min-h-[44px] shrink-0 px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
