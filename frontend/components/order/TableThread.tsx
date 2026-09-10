"use client";

// THE COUNTER'S HALF OF THE CONVERSATION.
//
//   "if customer send msg I can't able to see the reply or the persistent
//    history of that time... it should be interactive between both."
//
// "Interactive between both" needs two halves, and only one existed: a guest
// message appeared on the pass and there was nowhere to answer from. Whoever
// read "more water, please" had to walk over — which is fine for water and
// useless for "is the biryani very spicy?", where a one-line answer would have
// settled it without anybody moving.
//
// Deliberately small. This is a reply box on a kitchen screen, not an inbox:
// the thread for ONE table, a place to type, and out. Anything more would be
// asking a chef mid-service to manage correspondence.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { SheetPopup } from "@/components/SheetPopup";

type Msg = { id: string; body: string; from_staff: boolean; at: string | null };

export function TableThread({
  tableId,
  tableLabel,
  onClose,
}: {
  tableId: string;
  tableLabel: string;
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const foot = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ messages: Msg[] }>(`/ordering/tables/${tableId}/messages`);
      setMsgs(d.messages ?? []);
    } catch {
      /* a dropped poll is not worth interrupting service for */
    }
  }, [tableId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 6000);
    return () => window.clearInterval(id);
  }, [load]);

  // Follow the conversation down. A thread that opens at the top makes you
  // scroll to find what was just said, which during service nobody will do.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/ordering/tables/${tableId}/messages`, { text: body });
      setText("");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPopup
      depth={2}
      columns={2}
      onClose={onClose}
      title={tableLabel}
      subtitle="What this table has asked, this sitting"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Reply to the table…"
            data-testid="thread-reply"
            className="mise-well min-h-[44px] min-w-0 flex-1 rounded-xl px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !text.trim()}
            data-tone="brand"
            className="mise-btn-flat mise-press min-h-[44px] px-5 text-sm disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {msgs.length === 0 && (
          <p className="py-8 text-center text-sm text-fg-faint">
            Nothing said yet at this table.
          </p>
        )}
        {msgs.map((m) => (
          <div key={m.id} className="flex">
            {m.from_staff ? (
              // Ours on the right, theirs on the left — the way round a
              // restaurant reads it, since this screen belongs to the staff.
              <span className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white">
                {m.body}
              </span>
            ) : (
              <span className="mise-card-inset mr-auto w-fit max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2 text-sm text-fg">
                {m.body}
              </span>
            )}
          </div>
        ))}
        <div ref={foot} />
        {err && <p className="text-xs font-semibold text-rose-300">{err}</p>}
      </div>
    </SheetPopup>
  );
}
