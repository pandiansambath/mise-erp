"use client";

// THE ACTIVITY THREAD ON ONE DOCUMENT REQUEST.
//
//   "let say superadmin request document to staff, this will be shown in staff
//    account. now suppose staff need some info means he can click that doc
//    request and put comment — like we do in jira comments nah. both of that
//    can see that chat under that 1 doc request, and this will be persistent
//    history, so that even after years we can find why this doc requested what
//    issues faced. please use best UI, jira ticket comment area."
//
// SO: NOT CHAT BUBBLES. Bubbles are for a conversation you read once and let
// scroll away. This is a record — the question is "why was this asked for three
// times", asked months later by somebody who was not there. That reads as a
// ticket: avatar, who, when, and the text at full width, oldest first, so the
// story runs top to bottom in the order it happened.
//
// Both sides render the same component, so the manager and the member of staff
// are demonstrably looking at one history rather than two views that drift.

import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

type Comment = {
  id: string;
  body: string;
  author_name: string;
  from_staff: boolean;
  created_at: string;
};

/** "3 minutes ago", "yesterday", "12 Mar 2026".
 *
 *  Recent things are relative because that is how people hold them; old things
 *  get a date, because "11 months ago" is not something you can look up. */
function when(iso: string): string {
  const then = new Date(iso);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DocComments({
  requestId,
  /** Which side is reading, so "you" is labelled and nobody has to work it out. */
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

  // Live: a note asking for a clearer photo is worth nothing if the person
  // holding the phone only sees it after a refresh.
  useLiveRefresh("documents.comment", () => void load());

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
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
          Activity
        </p>
        {rows && rows.length > 0 && (
          <p className="text-[11px] text-fg-faint">
            {rows.length} comment{rows.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {rows === null ? (
        <p className="py-3 text-[11px] text-fg-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[11px] text-fg-faint">
          Nothing yet. Ask a question about this request, or say what is wrong with
          what was sent — it stays here for good.
        </p>
      ) : (
        <ol className="space-y-3">
          {rows.map((c) => {
            const isMine = (mine === "staff") === c.from_staff;
            return (
              <li key={c.id} className="flex gap-2.5">
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    c.from_staff
                      ? "bg-sky-400/15 text-sky-300"
                      : "bg-brand-500/15 text-brand-300"
                  }`}
                >
                  {c.author_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold text-fg">
                      {c.author_name}
                    </span>
                    {isMine && (
                      <span className="mise-chip text-[9px]">you</span>
                    )}
                    <span className="text-[10px] text-fg-faint">{when(c.created_at)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-soft">
                    {c.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {err && <p className="mt-2 text-[11px] text-rose-400">{err}</p>}

      {/* The composer sits at the BOTTOM, after the history, because that is the
          order the thread is read in and the order a reply is written in. */}
      <div className="mt-3 border-t border-line pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Add a comment…"
          data-testid="doc-comment-input"
          className="mise-well min-h-[56px] w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-fg-faint">
            Everyone on this request sees it. It is kept for good.
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !draft.trim()}
            data-tone="brand"
            data-testid="doc-comment-send"
            className="mise-btn-flat mise-press min-h-[38px] shrink-0 px-4 text-sm font-bold text-brand-300 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
