"use client";

// THE BELL, REBUILT (32.10–32.13).
//
//     "the bell is very previous one" — old and raw.   "add as many features as
//      possible to it."   "if I get so many notifications from different area
//      means one area is dominating and makes others to be very bottom, that I
//      need to scroll to check that. eg: price alerts has 10+ notifications
//      which is hiding some important ones."
//
// The server now shapes the feed (backend/app/notifications/pipeline.py):
// one BOX per area, each showing its first few rows with the rest behind
// "+N more", so a noisy area grows its own box instead of pushing a quiet one
// off the bottom. Danger rows are PINNED at the top of their box and can never
// be collapsed, capped, dismissed or muted away — the one promise the design
// makes, and his sentence.
//
// Read / dismissed / muted is now a ROW on the server per person, not this
// browser's localStorage: read on the phone, read on the laptop. The old local
// "seen" set is handed to the server once and then forgotten.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Severity = "danger" | "warn" | "info";
type Item = {
  id: string;
  kind: string;
  stream: string;
  area: string;
  severity?: Severity;
  icon: string;
  title: string;
  body: string;
  route: string;
  at?: string | null;
  who?: string;
  read?: boolean;
};
type Group = {
  area: string;
  label: string;
  icon: string;
  route: string;
  pinned: Item[];
  items: Item[];
  more: Item[];
  hidden: number;
  total: number;
  unread: number;
  urgent: number;
  urgent_unread: number;
  worst: Severity;
};
type Muted = { area: string; label: string; icon: string; count: number };
type Feed = {
  groups: Group[];
  dismissed: Item[];
  dismissed_count: number;
  muted: Muted[];
  total: number;
  unread: number;
  urgent: number;
  urgent_unread: number;
};
type ChatUnread = {
  chat_id: string;
  other_hotel: string;
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
};

const EMPTY: Feed = {
  groups: [],
  dismissed: [],
  dismissed_count: 0,
  muted: [],
  total: 0,
  unread: 0,
  urgent: 0,
  urgent_unread: 0,
};

/** Where the bell used to keep "seen" — read once, handed to the server, deleted. */
const LEGACY_SEEN_KEY = "mise.notif.seen";

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago", else a date. */
function timeAgo(iso?: string | null): string {
  if (!iso) return "";
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

const SEV: Record<Severity, string> = {
  danger: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  info: "bg-brand-500/15 text-brand-300 ring-brand-500/30",
};
const DOT: Record<Severity, string> = {
  danger: "bg-rose-400",
  warn: "bg-amber-400",
  info: "bg-brand-400",
};

export default function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>(EMPTY);
  const [chats, setChats] = useState<ChatUnread[]>([]);
  const [open, setOpen] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  // Boxes whose "+N more" has been opened, and boxes folded shut.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [showPutAway, setShowPutAway] = useState(false);
  // The last dismissal, so it can be undone for a few seconds.
  const [undo, setUndo] = useState<Item | null>(null);
  const undoTimer = useRef<number | null>(null);
  const migrated = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<Partial<Feed>>("/notifications");
      const next: Feed = { ...EMPTY, ...res, groups: res.groups ?? [] };
      setFeed(next);
      // ONE-TIME HAND-OVER of the old browser-only "seen" set. Only keys still
      // in the feed are sent (the server ignores the rest anyway).
      if (!migrated.current) {
        migrated.current = true;
        try {
          const raw = localStorage.getItem(LEGACY_SEEN_KEY);
          if (raw) {
            const live = new Set(
              next.groups.flatMap((g) => [...g.pinned, ...g.items, ...g.more]).map((i) => i.id),
            );
            const keys = (JSON.parse(raw) as string[]).filter((k) => live.has(k)).slice(0, 500);
            if (keys.length) await api.post("/notifications/read", { keys });
            localStorage.removeItem(LEGACY_SEEN_KEY);
          }
        } catch {
          /* storage refused or bad JSON — nothing to carry over */
        }
      }
    } catch {
      /* the header must never break — ignore transient errors */
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
    refresh();
    const t = setInterval(refresh, 45_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Close on an outside click (desktop) and on Escape (everywhere).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chatUnread = chats.reduce((t, c) => t + c.unread, 0);
  const badge = feed.unread + chatUnread;

  // Mark rows read on screen at once; the server confirms on the next poll.
  function markLocal(ids: Set<string>) {
    setFeed((f) => ({
      ...f,
      groups: f.groups.map((g) => {
        const touch = (xs: Item[]) => xs.map((i) => (ids.has(i.id) ? { ...i, read: true } : i));
        const pinned = touch(g.pinned);
        const items = touch(g.items);
        const more = touch(g.more);
        const unread = [...pinned, ...items, ...more].filter((i) => !i.read).length;
        return { ...g, pinned, items, more, unread, urgent_unread: pinned.filter((i) => !i.read).length };
      }),
      unread: Math.max(0, f.unread - [...ids].length),
    }));
  }

  async function post(path: string, body: unknown) {
    try {
      await api.post(path, body);
    } catch {
      /* a failed mark is retried by the next click; never break the bell */
    }
    refresh();
  }

  function go(item: Item) {
    if (!item.read) {
      markLocal(new Set([item.id]));
      void post("/notifications/read", { keys: [item.id] });
    }
    if (!item.route) return;
    setOpen(false);
    router.push(item.route);
  }

  function readArea(g: Group) {
    markLocal(new Set([...g.pinned, ...g.items, ...g.more].map((i) => i.id)));
    void post("/notifications/read-all", { area: g.area });
  }

  function readAll() {
    markLocal(new Set(feed.groups.flatMap((g) => [...g.pinned, ...g.items, ...g.more]).map((i) => i.id)));
    void post("/notifications/read-all", {});
  }

  function dismiss(item: Item) {
    setFeed((f) => ({
      ...f,
      groups: f.groups.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.id !== item.id),
        more: g.more.filter((i) => i.id !== item.id),
      })),
    }));
    setUndo(item);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
    void post("/notifications/dismiss", { keys: [item.id] });
  }

  function restore(item: Item) {
    setUndo(null);
    void post("/notifications/undismiss", { keys: [item.id] });
  }

  function mute(area: string, muted: boolean) {
    void post("/notifications/mute", { area, muted });
  }

  function toggleSet(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  // "Urgent only" shows each box's pinned danger rows and nothing else.
  const groups = urgentOnly ? feed.groups.filter((g) => g.pinned.length > 0) : feed.groups;
  const empty = groups.length === 0 && (urgentOnly || chats.length === 0);

  function Row({ item, pinned }: { item: Item; pinned?: boolean }) {
    const sev: Severity = item.severity ?? "info";
    return (
      <div
        className={`group/row flex items-start gap-3 px-4 py-2.5 transition hover:bg-glass/5 ${
          pinned ? "bg-rose-500/[0.06]" : ""
        } ${item.read ? "opacity-70" : ""}`}
      >
        <button
          type="button"
          onClick={() => go(item)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none"
        >
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm ring-1 ${SEV[sev]}`}>
            {item.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {!item.read && (
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[sev]}`} aria-label="unread" />
              )}
              <span className="truncate text-sm font-medium text-fg">{item.title}</span>
              {item.at && <span className="ml-auto shrink-0 text-[10px] text-fg-faint">{timeAgo(item.at)}</span>}
            </span>
            <span className="block truncate text-xs text-fg-soft">{item.body}</span>
            {item.who && <span className="block truncate text-[10px] text-fg-faint">by {item.who}</span>}
          </span>
        </button>
        {/* A pinned (danger) row has no ✕: an empty chicken bin goes away when
            somebody fills it, not when somebody hides it. */}
        {!pinned && (
          <button
            type="button"
            onClick={() => dismiss(item)}
            aria-label={`Put away: ${item.title}`}
            title="Put away"
            className="mise-press mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs text-fg-faint opacity-60 transition hover:bg-glass/10 hover:text-fg group-hover/row:opacity-100"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={badge > 0 ? `Notifications, ${badge} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) refresh();
        }}
        className="relative rounded-lg border border-glass/15 p-2 text-fg-soft transition hover:bg-glass/5 active:scale-95"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {/* Something urgent and unread: the bell itself says so, not just a number. */}
        {feed.urgent_unread > 0 && (
          <span aria-hidden className="absolute inset-0 animate-ping rounded-lg ring-2 ring-rose-400/40 motion-reduce:animate-none" />
        )}
        {badge > 0 && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-lg ${
              feed.urgent_unread > 0 ? "bg-rose-500 shadow-rose-500/40" : "bg-brand-500 shadow-brand-500/40"
            }`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {/* A phone: dim the page behind the sheet — without it, page text read
          through the strip under it (live check, 2 Nov). A tap outside closes. */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="mise-fade fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm sm:hidden"
        />
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // A phone gets a sheet from under the top bar to the bottom edge, ABOVE
          // the floating mic (z-60) that used to sit on its last row; a desktop
          // the familiar panel under the bell.
          className="mise-pop fixed inset-x-2 bottom-2 top-16 z-[75] flex flex-col overflow-hidden rounded-2xl border border-glass/15 bg-shell/95 shadow-2xl shadow-black/50 backdrop-blur-xl sm:absolute sm:inset-auto sm:right-0 sm:z-50 sm:mt-2 sm:max-h-[78vh] sm:w-[26rem]"
        >
          <div className="shrink-0 border-b border-glass/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-fg">Notifications</span>
              <span className="flex items-center gap-1.5">
                {feed.unread > 0 && (
                  <button
                    type="button"
                    onClick={readAll}
                    className="mise-press rounded-full border border-brand-400/30 bg-brand-400/10 px-2 py-0.5 text-[11px] font-medium text-brand-300"
                  >
                    ✓ Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:bg-glass/10 hover:text-fg sm:hidden"
                >
                  ✕
                </button>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px]">
              {(
                [
                  [false, `All · ${feed.total}`],
                  [true, `Urgent · ${feed.urgent}`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={urgentOnly === value}
                  onClick={() => setUrgentOnly(value)}
                  className={`mise-press rounded-full px-2.5 py-0.5 font-medium transition ${
                    urgentOnly === value
                      ? value
                        ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30"
                        : "bg-glass/10 text-fg ring-1 ring-glass/20"
                      : "text-fg-faint hover:text-fg-soft"
                  }`}
                >
                  {label}
                </button>
              ))}
              {feed.unread > 0 && <span className="ml-auto text-fg-faint">{feed.unread} unread</span>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {empty && (
              <p className="px-4 py-10 text-center text-sm text-fg-faint">
                {urgentOnly ? "Nothing urgent. 👍" : "You're all caught up 🎉"}
              </p>
            )}

            {/* 💬 Unread messages — grouped by restaurant. */}
            {!urgentOnly && chats.length > 0 && (
              <section className="border-b border-glass/10 pb-1">
                <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-300/80">
                  💬 Messages · {chatUnread} new
                </p>
                {chats.map((c) => (
                  <button
                    key={c.chat_id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(`/messages?chat=${c.chat_id}`);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-glass/5"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-400 text-[11px] font-bold text-white">
                      {c.other_hotel
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? "")
                        .join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-fg">{c.other_hotel}</span>
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      </span>
                      <span className="truncate text-xs text-fg-faint">{c.last_message ?? "new message"}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            {/* ONE BOX PER AREA — the server already ordered them danger-first,
                then For you, then by severity, then a FIXED area order. */}
            {groups.map((g) => {
              const isFolded = folded.has(g.area);
              const isOpen = expanded.has(g.area);
              const rows = urgentOnly ? [] : isOpen ? [...g.items, ...g.more] : g.items;
              return (
                <section key={g.area} className="border-b border-glass/10 last:border-b-0">
                  <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                    <button
                      type="button"
                      onClick={() => toggleSet(folded, g.area, setFolded)}
                      aria-expanded={!isFolded}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span aria-hidden className={`text-[9px] text-fg-faint transition-transform ${isFolded ? "-rotate-90" : ""}`}>
                        ▾
                      </span>
                      <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-fg-soft">
                        {g.icon} {g.label}
                      </span>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[g.worst] ?? DOT.info}`} aria-hidden />
                      {/* In Urgent view the box says how many URGENT rows it is
                          showing, not its whole count — "13" over 5 rows read
                          as a miscount (live check). */}
                      <span className="text-[10px] text-fg-faint">
                        {urgentOnly ? g.urgent : g.total}
                        {urgentOnly
                          ? g.urgent_unread > 0
                            ? ` · ${g.urgent_unread} new`
                            : ""
                          : g.unread > 0
                            ? ` · ${g.unread} new`
                            : ""}
                      </span>
                    </button>
                    {g.unread > 0 && (
                      <button
                        type="button"
                        onClick={() => readArea(g)}
                        className="mise-press rounded-md px-1.5 py-0.5 text-[10px] text-fg-faint hover:bg-glass/10 hover:text-fg"
                      >
                        mark read
                      </button>
                    )}
                    {/* "For you" cannot be muted: you always see what was asked of you. */}
                    {g.area !== "mine" && (
                      <button
                        type="button"
                        onClick={() => mute(g.area, true)}
                        title={`Mute ${g.label} — urgent ones still show`}
                        aria-label={`Mute ${g.label}`}
                        className="mise-press rounded-md px-1.5 py-0.5 text-[10px] text-fg-faint hover:bg-glass/10 hover:text-fg"
                      >
                        🔕
                      </button>
                    )}
                  </div>
                  {!isFolded && (
                    <div className="pb-1">
                      {g.pinned.map((i) => (
                        <Row key={i.id} item={i} pinned />
                      ))}
                      {rows.map((i) => (
                        <Row key={i.id} item={i} />
                      ))}
                      {!urgentOnly && g.more.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleSet(expanded, g.area, setExpanded)}
                          className="mise-press mx-4 my-1 rounded-lg px-2 py-1 text-[11px] font-medium text-brand-300 hover:bg-brand-400/10"
                        >
                          {isOpen ? "Show fewer" : `+${g.more.length} more`}
                        </button>
                      )}
                      {!urgentOnly && g.hidden > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            router.push(g.route);
                          }}
                          className="mise-press mx-4 mb-1 block rounded-lg px-2 py-1 text-[11px] text-fg-faint hover:text-fg"
                        >
                          {g.hidden} more on the {g.label} page ›
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {/* Muted areas: what they are holding back, and the way back. */}
            {!urgentOnly && feed.muted.length > 0 && (
              <section className="border-t border-glass/10 px-4 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">🔕 Muted</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {feed.muted.map((m) => (
                    <button
                      key={m.area}
                      type="button"
                      onClick={() => mute(m.area, false)}
                      title={`Unmute ${m.label}`}
                      className="mise-press rounded-full bg-glass/10 px-2 py-0.5 text-[11px] text-fg-soft hover:text-fg"
                    >
                      {m.icon} {m.label}
                      {m.count > 0 ? ` · ${m.count}` : ""} · unmute
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Put away: dismissed rows can be brought back. */}
            {!urgentOnly && feed.dismissed_count > 0 && (
              <section className="border-t border-glass/10 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setShowPutAway((v) => !v)}
                  aria-expanded={showPutAway}
                  className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint hover:text-fg-soft"
                >
                  {showPutAway ? "▾" : "▸"} Put away · {feed.dismissed_count}
                </button>
                {showPutAway && (
                  <ul className="mt-1.5 space-y-1">
                    {feed.dismissed.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 text-xs">
                        <span aria-hidden>{i.icon}</span>
                        <span className="min-w-0 flex-1 truncate text-fg-soft">{i.title}</span>
                        <button
                          type="button"
                          onClick={() => restore(i)}
                          className="mise-press shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-brand-300 hover:bg-brand-400/10"
                        >
                          bring back
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>

          {/* Undo the last put-away, for a few seconds. */}
          {undo && (
            <div className="flex shrink-0 items-center gap-2 border-t border-glass/10 bg-paper-2/60 px-4 py-2 text-xs" aria-live="polite">
              <span className="min-w-0 flex-1 truncate text-fg-soft">Put away “{undo.title}”</span>
              <button
                type="button"
                onClick={() => restore(undo)}
                className="mise-press shrink-0 rounded-md px-2 py-0.5 font-semibold text-brand-300 hover:bg-brand-400/10"
              >
                Undo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
