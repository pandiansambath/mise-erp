"use client";

// THE CONVERSATION ABOUT ONE PIECE OF PAPER.
//
//   "here i need comment feature. superadmin and staff can comment on that doc.
//    suppose anything is missing or needed he can comment and superadmin can
//    read and request again nah. keep comment persistent."
//
// Deliberately not the chat. "This passport photo is blurred, send another"
// belongs beside the passport photo — in a chat room it is forty messages up by
// tomorrow, and six months later nobody can answer why a document was
// re-requested three times. A thread that cannot name its subject is a thread
// nobody finds twice.
//
// Both sides use this same component, so the manager and the member of staff
// are demonstrably looking at one conversation rather than two views that drift.

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

type Comment = {
  id: string;
  body: string;
  author_name: string;
  from_staff: boolean;
  created_at: string;
};

export function DocComments({
  requestId,
  /** Which side of the conversation this reader is on, so "mine" sits right. */
  mine,
  className = "",
}: {
  requestId: string;
  mine: "staff" | "owner";
  className?: string;
}) {
  const [rows, setRows] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Comment[]>(`/documents/requests/${requestId}/comments`));
    } catch {
      setRows((r) => r ?? []);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live, like the chat: a comment asking for a better photo is worth nothing
  // if the person holding the phone does not see it until they refresh.
  useLiveRefresh("documents.comment", () => void load());

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await api.post<Comment>(`/documents/requests/${requestId}/comments`, { body });
      setDraft("");
      setRows((r) => [...(r ?? []), c]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div
        ref={boxRef}
        className="mise-noscrollbar max-h-48 space-y-2 overflow-y-auto pr-1"
      >
        {rows === null ? (
          <p className="py-3 text-center text-[11px] text-fg-faint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-fg-faint">
            No notes yet — say what is wrong with it, or what you need.
          </p>
        ) : (
          rows.map((c) => {
            const isMine = (mine === "staff") === c.from_staff;
            return (
              <div key={c.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 ${
                    isMine ? "bg-brand-600 text-white" : "mise-well text-fg"
                  }`}
                >
                  {!isMine && (
                    <p className="mb-0.5 text-[10px] font-semibold text-fg-faint">
                      {c.author_name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {c.body}
                  </p>
                  <p
                    className={`mt-0.5 text-right text-[9px] tabular-nums ${
                      isMine ? "text-white/70" : "text-fg-faint"
                    }`}
                  >
                    {new Date(c.created_at).toLocaleString(undefined, {
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

      {err && <p className="mt-1 text-[11px] text-rose-400">{err}</p>}

      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Add a note about this document…"
          data-testid="doc-comment-input"
          className="mise-well max-h-24 min-h-[40px] flex-1 resize-y rounded-lg px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          data-tone="brand"
          data-testid="doc-comment-send"
          className="mise-btn-flat mise-press min-h-[40px] shrink-0 px-3 text-sm font-bold text-brand-300 disabled:opacity-40"
        >
          {busy ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}
