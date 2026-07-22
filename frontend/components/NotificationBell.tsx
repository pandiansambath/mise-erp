"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Alert = {
  id: string; kind: string; severity: "danger" | "warn" | "info";
  icon: string; title: string; body: string; route: string;
};
type Activity = {
  id: string; kind: string; icon: string; title: string; body: string;
  route: string; at: string; who: string;
};
type Feed = { alerts: Alert[]; activity: Activity[]; count: number };
type ChatUnread = {
  chat_id: string; other_hotel: string; last_message: string | null;
  last_message_at: string | null; unread: number;
};

const SEEN_KEY = "mise.notif.seen";

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago", else a date. */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const SEV: Record<string, string> = {
  danger: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  info: "bg-brand-500/15 text-brand-300 ring-brand-500/30",
};

export default function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>({ alerts: [], activity: [], count: 0 });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [chats, setChats] = useState<ChatUnread[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<Feed>("/notifications");
      setFeed({ alerts: res.alerts || [], activity: res.activity || [], count: res.count || 0 });
    } catch {
      /* header must never break — ignore transient errors */
    }
    try {
      const cs = await api.get<ChatUnread[]>("/talent/chats");
      setChats(cs.filter((c) => c.unread > 0));
    } catch {
      /* chat is optional — never break the bell */
    }
  }, []);

  // Initial load + poll every 45s + refresh when the tab regains focus.
  useEffect(() => {
    setSeen(loadSeen());
    refresh();
    const t = setInterval(refresh, 45_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const all = [...feed.alerts, ...feed.activity];
  const chatUnread = chats.reduce((t, c) => t + c.unread, 0);
  const unseen = all.filter((i) => !seen.has(i.id)).length + chatUnread;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) refresh();
  }

  function persistSeen(next: Set<string>) {
    setSeen(next);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }

  function markAllRead() {
    const merged = new Set(seen);
    all.forEach((i) => merged.add(i.id));
    persistSeen(merged);
  }

  function go(route: string, id?: string) {
    if (id && !seen.has(id)) persistSeen(new Set(seen).add(id));
    if (!route) return;
    setOpen(false);
    router.push(route);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={toggle}
        className="relative rounded-lg border border-glass/15 p-2 text-fg-soft transition hover:bg-glass/5 active:scale-95"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-lg shadow-rose-500/40">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="mise-pop absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-glass/15 bg-shell/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-glass/10 px-4 py-3">
            <span className="text-sm font-semibold text-fg">Notifications</span>
            <span className="flex items-center gap-2">
              {unseen > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="mise-press rounded-full border border-brand-400/30 bg-brand-400/10 px-2 py-0.5 text-[11px] font-medium text-brand-300"
                >
                  ✓ Mark all read
                </button>
              )}
              <span className="rounded-full bg-glass/10 px-2 py-0.5 text-[11px] font-medium text-fg-faint">
                {feed.alerts.length} alert{feed.alerts.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>

          <div className="max-h-[70vh] overflow-y-auto overscroll-contain">
            {all.length === 0 && chats.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-fg-faint">You&apos;re all caught up 🎉</p>
            )}

            {/* 💬 Unread messages — grouped by hotel */}
            {chats.length > 0 && (
              <>
                <p className="sticky top-0 bg-shell/95 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-300/80 backdrop-blur">
                  💬 Messages · {chatUnread} new
                </p>
                {chats.map((c) => (
                  <button
                    key={c.chat_id}
                    type="button"
                    onClick={() => { setOpen(false); router.push(`/messages?chat=${c.chat_id}`); }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-glass/5"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-400 text-[11px] font-bold text-white">
                      {c.other_hotel.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-fg">{c.other_hotel}</span>
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">{c.unread}</span>
                      </span>
                      <span className="truncate text-xs text-fg-faint">{c.last_message ?? "new message"}</span>
                    </span>
                  </button>
                ))}
              </>
            )}

            {/* Needs attention */}
            {feed.alerts.length > 0 && (
              <>
                <p className="sticky top-0 bg-shell/95 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-amber-300/80 backdrop-blur">
                  ⚠ Needs attention
                </p>
                {feed.alerts.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => go(n.route, n.id)}
                    className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-glass/5 ${seen.has(n.id) ? "opacity-75" : ""}`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm ring-1 ${SEV[n.severity] ?? SEV.info}`}>
                      {n.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {!seen.has(n.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-label="unread" />}
                        <span className="truncate text-sm font-medium text-fg">{n.title}</span>
                      </span>
                      <span className="block truncate text-xs text-fg-soft">{n.body}</span>
                    </span>
                    <span aria-hidden className="mt-1 text-fg-faint">›</span>
                  </button>
                ))}
              </>
            )}

            {/* Recent activity */}
            {feed.activity.length > 0 && (
              <>
                <p className="sticky top-0 bg-shell/95 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-fg-faint backdrop-blur">
                  🕒 Recent activity
                </p>
                {feed.activity.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => go(n.route, n.id)}
                    className={`flex w-full items-start gap-3 border-t border-glass/5 px-4 py-2.5 text-left transition first:border-t-0 hover:bg-glass/5 ${seen.has(n.id) ? "opacity-75" : ""}`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-glass/8 text-sm ring-1 ring-glass/10">
                      {n.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {!seen.has(n.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-label="unread" />}
                          <span className="truncate text-sm font-medium text-fg">{n.title}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-fg-faint">{timeAgo(n.at)}</span>
                      </span>
                      <span className="block truncate text-xs text-fg-soft">{n.body}</span>
                      {n.who && <span className="block truncate text-[10px] text-fg-faint">by {n.who}</span>}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
