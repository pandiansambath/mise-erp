"use client";

// MESSAGES — every conversation this hotel has, in one place.
//
//   "here itself integrate all message related for super admin — like hotel to
//    hotel in one side, within hotel one on one or grp or anything is other
//    side. but we need a best whatsapp style UI UX with emoji gif video audio
//    image doc etc, anything we can send via chat."
//
//   "one to one within the hotel — like any staff can chat with anyone, like
//    organisation in teams"
//
// THREE THINGS WERE WRONG AND THEY WERE THE SAME THING.
//
// Talking to another restaurant lived on /messages. Talking to your own team
// lived on /chat. Talking to ONE colleague lived at the bottom of their record
// on the Employees admin page — "seriously worst place to keep" — which also
// meant a chef or a cashier, who cannot open employee records, had no way to
// message anybody at all. Three screens, three shapes, one activity.
//
// So there is one screen, and the only thing that changes is who you are
// talking to. Inside the hotel: Everyone, Managers, the groups the owner makes,
// and any colleague by name. Outside it: the other restaurants on the network.
// The composer, the bubbles, the attachments and the unread counts are the same
// in all of them, because a message is a message.
//
// On a laptop the list sits beside the conversation. On a phone the list IS the
// screen and opening one replaces it — 390px split two ways gives you two
// things too narrow to use.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmojiPicker } from "@/components/EmojiPicker";
import { SheetPopup } from "@/components/SheetPopup";
import { Card, PageHeader } from "@/components/ui";
import { api, ApiError, fetchBlobUrl, postForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { refreshChatUnread } from "@/lib/chatUnread";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { can } from "@/lib/permissions";

type Scope = "hotel" | "network";

type Room = {
  id: string;
  kind: "everyone" | "managers" | "custom" | "direct";
  name: string;
  emoji?: string | null;
  unread: number;
  last_message_at?: string | null;
  preview?: string | null;
  last_sender?: string | null;
  scope: Scope;
};

type Bubble = {
  id: string;
  body: string | null;
  mine: boolean;
  sender_name: string;
  created_at: string;
  /** An API path, already absolute. Fetched with the token, never linked raw. */
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
};

type Person = { id: string; name: string; email: string; role: string };

/** What the file picker offers. Pictures and video were the original set; he
 *  asked for documents and audio too, and he is right about the workflow — a
 *  rota PDF or a supplier invoice is a normal thing to hand a colleague. An
 *  animated GIF is just an image file, so it needs nothing special. */
const ACCEPT =
  "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.odt,.ods,.rtf";

const ROOM_ICONS = ["💬", "🍽️", "🍳", "📦", "🚚", "🧹", "💷", "📣", "🎉", "⚠️"];

/** "Today", "Yesterday", or the date. A timestamp on every line is noise; a
 *  date once, where it changes, is the thing you actually scan for. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function MessagesPage() {
  const { user } = useAuth();
  const canManage = can(user?.role, "users:write");
  // Talking to other restaurants is a different job from talking to your team,
  // and not everyone who works here does it.
  const canNetwork = can(user?.role, "employees:read");

  const [scope, setScope] = useState<Scope>("hotel");
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [talk, setTalk] = useState<Room[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Bubble[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pickTab, setPickTab] = useState<"emoji" | "gif">("emoji");
  const [sheet, setSheet] = useState<null | "group" | "person" | "settings">(null);

  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = scope === "hotel" ? rooms : talk;
  const room = (shown ?? []).find((r) => r.id === openId) ?? null;

  const loadRooms = useCallback(async () => {
    try {
      const rs = await api.get<Omit<Room, "scope">[]>("/chat/rooms");
      setRooms(rs.map((r) => ({ ...r, scope: "hotel" as const })));
    } catch {
      setRooms((r) => r ?? []);
    }
  }, []);

  const loadTalk = useCallback(async () => {
    if (!canNetwork) {
      setTalk([]);
      return;
    }
    try {
      const cs = await api.get<
        {
          chat_id: string;
          other_hotel: string;
          last_message: string | null;
          last_message_at: string | null;
          unread: number;
        }[]
      >("/talent/chats");
      setTalk(
        cs.map((c) => ({
          id: c.chat_id,
          kind: "custom" as const,
          name: c.other_hotel,
          emoji: "🏨",
          unread: c.unread,
          last_message_at: c.last_message_at,
          preview: c.last_message,
          scope: "network" as const,
        })),
      );
    } catch {
      setTalk((t) => t ?? []);
    }
  }, [canNetwork]);

  const loadMsgs = useCallback(
    async (id: string, sc: Scope) => {
      try {
        if (sc === "hotel") {
          const raw = await api.get<
            {
              id: string;
              body: string | null;
              sender_user_id: string | null;
              sender_name: string;
              created_at: string;
              attachment_url: string | null;
              attachment_name: string | null;
              attachment_type: string | null;
            }[]
          >(`/chat/rooms/${id}/messages`);
          setMsgs(
            raw.map((m) => ({
              id: m.id,
              body: m.body,
              mine: m.sender_user_id === user?.id,
              sender_name: m.sender_name,
              created_at: m.created_at,
              attachment_url: m.attachment_url,
              attachment_name: m.attachment_name,
              attachment_type: m.attachment_type,
            })),
          );
          refreshChatUnread();
        } else {
          const d = await api.get<{
            other_hotel: string;
            messages: {
              id: string;
              mine: boolean;
              sender_name: string;
              body: string;
              created_at: string;
              has_attachment?: boolean;
              is_image?: boolean;
              attachment_name?: string | null;
            }[];
          }>(`/talent/chats/${id}/messages`);
          setMsgs(
            d.messages.map((m) => ({
              id: m.id,
              body: m.body,
              mine: m.mine,
              sender_name: m.sender_name,
              created_at: m.created_at,
              attachment_url: m.has_attachment
                ? `/api/talent/chats/${id}/attachment/${m.id}`
                : null,
              attachment_name: m.attachment_name ?? null,
              attachment_type: m.is_image ? "image/*" : null,
            })),
          );
        }
      } catch {
        setMsgs((m) => m ?? []);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    void loadRooms();
    void loadTalk();
  }, [loadRooms, loadTalk]);

  // On a laptop open the busiest conversation so the page is never a dead end.
  // On a phone the LIST is the landing screen — auto-opening one would hide the
  // thing you came to choose from.
  useEffect(() => {
    if (openId || !rooms?.length) return;
    if (window.matchMedia("(min-width: 1024px)").matches) setOpenId(rooms[0].id);
  }, [rooms, openId]);

  useEffect(() => {
    if (openId) void loadMsgs(openId, scope);
  }, [openId, scope, loadMsgs]);

  // LIVE. "its not realtime, i can see small delay in message delivery" — and
  // he was right: a six-second poll makes every message three seconds old on
  // average. The hotel already keeps a Server-Sent Events stream open for live
  // PO updates, so chat rides on that rather than opening a second connection.
  //
  // The event carries no text, only "something changed in room X", because
  // everyone in the hotel is on that stream including people who cannot open
  // this room. We fetch through the endpoint that checks.
  useLiveRefresh("chat.message", () => {
    void loadRooms();
    if (openId && scope === "hotel") void loadMsgs(openId, scope);
  });

  // A slow backstop, for the hotel-to-hotel side (which is not on this hotel's
  // bus) and for a stream that dropped without the browser noticing.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void loadRooms();
      void loadTalk();
      if (openId) void loadMsgs(openId, scope);
    };
    const id = window.setInterval(tick, scope === "network" ? 6000 : 20000);
    return () => window.clearInterval(id);
  }, [openId, scope, loadRooms, loadTalk, loadMsgs]);

  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function send() {
    const body = draft.trim();
    if (!body || !openId || sending) return;
    setSending(true);
    setErr(null);
    try {
      if (scope === "hotel") {
        await api.post(`/chat/rooms/${openId}/messages`, { body });
      } else {
        await api.post(`/talent/chats/${openId}/messages`, { body });
      }
      setDraft("");
      atBottom.current = true;
      await loadMsgs(openId, scope);
      void loadRooms();
      void loadTalk();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that");
    } finally {
      setSending(false);
    }
  }

  async function sendGif(url: string) {
    if (!openId) return;
    setSending(true);
    setErr(null);
    try {
      // Only in-hotel rooms can take a GIF today: the other-restaurants side has
      // its own attachment endpoint and no picker behind it yet.
      await api.post(`/chat/rooms/${openId}/gif`, { url });
      atBottom.current = true;
      await loadMsgs(openId, scope);
      void loadRooms();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that GIF");
    } finally {
      setSending(false);
    }
  }

  async function attach(file: File) {
    if (!openId) return;
    setSending(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await postForm(
        scope === "hotel"
          ? `/chat/rooms/${openId}/attachment`
          : `/talent/chats/${openId}/attach`,
        form,
      );
      atBottom.current = true;
      await loadMsgs(openId, scope);
      void loadRooms();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that file");
    } finally {
      setSending(false);
    }
  }

  async function startDirect(personId: string) {
    setSheet(null);
    setErr(null);
    try {
      const r = await api.post<{ id: string; name: string }>("/chat/direct", {
        user_id: personId,
      });
      setScope("hotel");
      // A brand-new conversation has no messages, so the server does not list it
      // yet — an empty thread in everybody's sidebar the moment somebody opened
      // the picker and changed their mind would be worse. Showing it here is
      // what makes "message Balaji" feel like it worked.
      setRooms((list) =>
        list && list.some((x) => x.id === r.id)
          ? list
          : [
              {
                id: r.id,
                kind: "direct" as const,
                name: r.name,
                unread: 0,
                scope: "hotel" as const,
              },
              ...(list ?? []),
            ],
      );
      setOpenId(r.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not open that conversation");
    }
  }

  const groups = useMemo(() => {
    const list = shown ?? [];
    if (scope === "network") return [{ title: "Other restaurants", items: list }];
    return [
      { title: "Rooms", items: list.filter((r) => r.kind !== "direct") },
      { title: "People", items: list.filter((r) => r.kind === "direct") },
    ].filter((g) => g.items.length > 0);
  }, [shown, scope]);

  return (
    // WHY IT COULD ONLY SHOW TWO MESSAGES.
    //
    //   "messages are very tight, i can see only 2 messages at once. if i want
    //    more mean i need scroll chat to see. worst exp ever. better make that
    //    chat showing screen alone big in terms of height"
    //
    // The height was going to furniture. A page title and subtitle took ~120px,
    // main's own padding another ~144, and the card sat inside what was left —
    // so a 900px screen gave the conversation about 380. WhatsApp Web does not
    // put a masthead above the conversation, and neither should this.
    //
    // `data-bench` tells the shell to drop main's vertical padding for this
    // page; the title moves into the rail where it costs nothing; and the whole
    // thing takes the viewport minus the top bar. The conversation gets the
    // screen, which is the only thing on it worth having.
    <div data-bench className="flex h-[calc(100svh-4rem)] min-h-0 flex-col pb-2 pt-2">
      <div className="sr-only">
        <PageHeader
          title="Messages"
          subtitle="Your team, and the restaurants you work with."
        />
      </div>
      <div className="mb-2 flex items-center justify-end gap-2 lg:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSheet("person")}
              data-testid="new-direct-mobile"
              className="mise-btn-flat mise-press min-h-[40px] px-3 py-2 text-sm font-semibold text-fg-soft"
            >
              ＋ New chat
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => setSheet("group")}
                data-tone="brand"
                data-testid="new-group-mobile"
                className="mise-btn-flat mise-press min-h-[40px] px-3 py-2 text-sm font-bold text-brand-300"
              >
                ＋ Group
              </button>
            )}
          </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = "";
        }}
      />

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[19rem_1fr]">
        {/* ── the conversations ───────────────────────────────────────── */}
        <Card
          className={`min-h-0 overflow-hidden p-0 ${openId ? "hidden lg:flex" : "flex"} flex-col`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <p className="font-display text-lg font-semibold text-fg">Messages</p>
            <div className="hidden items-center gap-1.5 lg:flex">
              <button
                type="button"
                onClick={() => setSheet("person")}
                data-testid="new-direct"
                title="Start a conversation with a colleague"
                className="mise-btn-flat mise-press grid h-9 w-9 place-items-center text-base"
              >
                ＋
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setSheet("group")}
                  data-testid="new-group"
                  title="Make a group"
                  className="mise-btn-flat mise-press grid h-9 w-9 place-items-center text-base"
                >
                  👥
                </button>
              )}
            </div>
          </div>

          {canNetwork && (
            <div className="mise-card-inset m-2 flex gap-1 rounded-xl p-1">
              {(
                [
                  ["hotel", "This hotel"],
                  ["network", "Other hotels"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setScope(key);
                    setOpenId(null);
                    setMsgs(null);
                  }}
                  data-testid={`scope-${key}`}
                  className={`mise-press min-h-[36px] flex-1 rounded-lg px-2 text-xs font-semibold transition ${
                    scope === key ? "bg-brand-600 text-white" : "text-fg-soft hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="mise-noscrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {shown === null ? (
              <p className="px-3 py-6 text-center text-sm text-fg-faint">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-fg-faint">
                {scope === "hotel"
                  ? "No conversations yet — start one with ＋ New chat."
                  : "No other restaurants yet."}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.title} className="mb-2">
                  <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint/70">
                    {g.title}
                  </p>
                  {g.items.map((r) => {
                    const on = r.id === openId;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        data-testid="chat-room"
                        className={`mise-press mb-1 flex min-h-[58px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          on ? "bg-brand-500/15" : "hover:bg-glass/5"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base"
                        >
                          {r.kind === "direct"
                            ? r.name.slice(0, 1).toUpperCase()
                            : (r.emoji ?? "💬")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-fg">
                              {r.name}
                            </span>
                            {(r.kind === "everyone" || r.kind === "managers") && (
                              <span className="mise-chip shrink-0 text-[9px]">
                                {r.kind === "everyone" ? "all" : "staff only"}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-fg-faint">
                            {r.preview
                              ? `${
                                  r.last_sender && r.kind !== "direct"
                                    ? `${r.last_sender.split(" ")[0]}: `
                                    : ""
                                }${r.preview}`
                              : "No messages yet"}
                          </span>
                        </span>
                        {r.unread > 0 && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold tabular-nums text-white">
                            {r.unread}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* ── the conversation ────────────────────────────────────────── */}
        <Card
          className={`min-h-0 overflow-hidden p-0 ${openId ? "flex" : "hidden lg:flex"} flex-col`}
        >
          {room ? (
            <>
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  aria-label="Back to conversations"
                  className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-lg text-fg-soft hover:bg-glass/5 lg:hidden"
                >
                  ‹
                </button>
                <span
                  aria-hidden
                  className="mise-well grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base"
                >
                  {room.kind === "direct"
                    ? room.name.slice(0, 1).toUpperCase()
                    : (room.emoji ?? "💬")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{room.name}</p>
                  <p className="truncate text-[11px] text-fg-faint">
                    {room.scope === "network"
                      ? "Another restaurant"
                      : room.kind === "everyone"
                        ? "Everyone who works here"
                        : room.kind === "managers"
                          ? "Managers and the owner only"
                          : room.kind === "direct"
                            ? "Just the two of you"
                            : "Private group"}
                  </p>
                </div>
                {canManage && room.kind === "custom" && room.scope === "hotel" && (
                  <button
                    type="button"
                    onClick={() => setSheet("settings")}
                    aria-label="Group settings"
                    data-testid="room-settings"
                    className="mise-btn-flat mise-press grid h-9 w-9 shrink-0 place-items-center text-base"
                  >
                    ⋯
                  </button>
                )}
              </div>

              <div
                ref={listRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
                className="mise-noscrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"
              >
                {msgs === null ? (
                  <p className="py-8 text-center text-sm text-fg-faint">Loading…</p>
                ) : msgs.length === 0 ? (
                  <p className="py-12 text-center text-sm text-fg-faint">
                    <span aria-hidden className="mr-1.5 text-lg">
                      💬
                    </span>
                    Nothing here yet — say hello.
                  </p>
                ) : (
                  msgs.map((m, i) => {
                    // WHAT MADE IT FEEL TIGHT, and it was not the padding.
                    //
                    // Every message repeated the sender's name and the full
                    // date, so five lines from one person in one minute printed
                    // their name five times and the date five times. A chat
                    // reads as a conversation because it DROPS what has not
                    // changed: a run of messages from the same person shows one
                    // name, and a time only when the run ends.
                    const prev = i > 0 ? msgs[i - 1] : null;
                    const next = i < msgs.length - 1 ? msgs[i + 1] : null;
                    const newDay =
                        !prev ||
                        new Date(prev.created_at).toDateString() !==
                          new Date(m.created_at).toDateString();
                    const startsRun =
                        newDay || !prev || prev.mine !== m.mine ||
                        prev.sender_name !== m.sender_name;
                    const endsRun =
                        !next ||
                        next.mine !== m.mine ||
                        next.sender_name !== m.sender_name ||
                        new Date(next.created_at).toDateString() !==
                          new Date(m.created_at).toDateString();

                    return (
                      <div key={m.id}>
                        {newDay && (
                          <div className="my-4 flex items-center gap-3">
                            <span className="h-px flex-1 bg-line" />
                            <span className="mise-well rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                              {dayLabel(m.created_at)}
                            </span>
                            <span className="h-px flex-1 bg-line" />
                          </div>
                        )}
                        <div
                          className={`flex items-end gap-2 ${
                            m.mine ? "justify-end" : "justify-start"
                          } ${endsRun ? "mb-2.5" : "mb-0.5"}`}
                        >
                          {/* The avatar sits with the LAST message of a run, so
                              a burst of five reads as one person speaking. */}
                          {!m.mine && room.kind !== "direct" && (
                            <span
                              aria-hidden
                              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[10px] font-bold text-brand-300 ${
                                endsRun ? "" : "invisible"
                              }`}
                            >
                              {m.sender_name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <div
                            className={`max-w-[78%] px-3.5 py-2 sm:max-w-[65%] ${
                              m.mine
                                ? "bg-brand-600 text-white"
                                : "mise-card-inset text-fg"
                            } ${
                              m.mine
                                ? `rounded-2xl ${startsRun ? "rounded-tr-md" : ""} ${endsRun ? "rounded-br-md" : ""}`
                                : `rounded-2xl ${startsRun ? "rounded-tl-md" : ""} ${endsRun ? "rounded-bl-md" : ""}`
                            }`}
                          >
                            {startsRun && !m.mine && room.kind !== "direct" && (
                              <p className="mb-1 text-[11px] font-semibold text-brand-300">
                                {m.sender_name}
                              </p>
                            )}
                            {m.attachment_url && <Attachment msg={m} />}
                            {m.body && (
                              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                                {m.body}
                              </p>
                            )}
                            {endsRun && (
                              <p
                                className={`mt-0.5 text-right text-[10px] tabular-nums ${
                                  m.mine ? "text-white/70" : "text-fg-faint"
                                }`}
                              >
                                {new Date(m.created_at).toLocaleTimeString(undefined, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {err && <p className="px-4 pb-1 text-[11px] text-rose-400">{err}</p>}

              <div className="relative border-t border-line px-3 py-3">
                {showEmoji && (
                  <button
                    type="button"
                    aria-label="Close emoji picker"
                    onClick={() => setShowEmoji(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                )}
                {showEmoji && (
                  <div className="mise-pop absolute bottom-full left-3 z-20 mb-2 rounded-2xl border border-line bg-paper p-2 shadow-2xl">
                    <div className="mise-card-inset mb-2 flex gap-1 rounded-xl p-1">
                      {(
                        [
                          ["emoji", "Emoji"],
                          ["gif", "GIF"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPickTab(key)}
                          data-testid={`pick-${key}`}
                          className={`mise-press min-h-[32px] flex-1 rounded-lg px-3 text-xs font-semibold transition ${
                            pickTab === key
                              ? "bg-brand-600 text-white"
                              : "text-fg-soft hover:text-fg"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {pickTab === "emoji" ? (
                      <EmojiPicker
                        onPick={(e) => {
                          setDraft((d) => d + e);
                          setShowEmoji(false);
                        }}
                      />
                    ) : (
                      <GifPicker
                        onPick={(url) => {
                          setShowEmoji(false);
                          void sendGif(url);
                        }}
                      />
                    )}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEmoji((v) => !v)}
                    aria-label="Emoji"
                    className="mise-btn-flat mise-press grid h-11 w-11 shrink-0 place-items-center text-lg"
                  >
                    🙂
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Send a photo, video or document"
                    title="Photo, video, audio or document"
                    className="mise-btn-flat mise-press grid h-11 w-11 shrink-0 place-items-center text-lg"
                  >
                    📎
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setShowEmoji(false);
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
                    {sending ? "…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <p className="text-sm text-fg-faint">
                <span aria-hidden className="mb-2 block text-3xl">
                  💬
                </span>
                Pick a conversation to start reading.
              </p>
            </div>
          )}
        </Card>
      </div>

      {sheet === "person" && (
        <NewDirect onClose={() => setSheet(null)} onPick={(id) => void startDirect(id)} />
      )}

      {sheet === "group" && (
        <NewGroup
          onClose={() => setSheet(null)}
          onMade={(id) => {
            setSheet(null);
            setScope("hotel");
            void loadRooms().then(() => setOpenId(id));
          }}
        />
      )}

      {sheet === "settings" && room && (
        <GroupSettings
          room={room}
          onClose={() => setSheet(null)}
          onChanged={() => void loadRooms()}
          onClosed={() => {
            setSheet(null);
            setOpenId(null);
            void loadRooms();
          }}
        />
      )}
    </div>
  );
}

/** A picture, a video, a voice note or a document — fetched WITH the token and
 *  shown from a blob.
 *
 *  It cannot simply be `<img src={url}>`: the endpoint checks that the viewer
 *  can open the conversation the file was posted in, and an img tag sends no
 *  Authorization header, so the browser would be turned away and paint a broken
 *  icon. Anything that is not media is offered as a named file to open, because
 *  a document you cannot identify is not much of an attachment.
 */
function Attachment({ msg }: { msg: Bubble }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!msg.attachment_url) return;
    let alive = true;
    fetchBlobUrl(msg.attachment_url)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [msg.attachment_url]);

  if (failed) {
    return (
      <p className="mb-1.5 rounded-xl bg-glass/10 px-3 py-2 text-[11px] opacity-80">
        ⚠️ {msg.attachment_name ?? "That file"} could not be loaded.
      </p>
    );
  }
  if (!url) {
    return (
      <div className="mb-1.5 grid h-24 w-44 place-items-center rounded-xl bg-glass/10 text-[11px] opacity-70">
        Loading…
      </div>
    );
  }

  const type = msg.attachment_type ?? "";
  const name = msg.attachment_name ?? "file";

  if (type.startsWith("video/")) {
    return <video src={url} controls className="mb-1.5 max-h-64 w-full rounded-xl" />;
  }
  if (type.startsWith("audio/")) {
    return <audio src={url} controls className="mb-1.5 w-full" />;
  }
  if (type.startsWith("image/")) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mb-1.5 block overflow-hidden rounded-xl"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-64 rounded-xl object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mb-1.5 flex items-center gap-2 rounded-xl bg-glass/10 px-3 py-2 text-[11px] underline-offset-2 hover:underline"
    >
      <span aria-hidden className="text-base">
        📄
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </a>
  );
}

/** Start a conversation with one colleague.
 *
 *  WHY THIS IS NOT PersonPicker. That component is a dropdown: a closed trigger
 *  that opens a portalled list positioned against the trigger. Inside a popup
 *  that produced two search boxes stacked on each other and a list hanging out
 *  through the bottom of the sheet — "how can i search with this UI".
 *
 *  A sheet is already a surface that opened for one job, so the list belongs
 *  open. No trigger, no portal, no second box: type, and the names narrow.
 */
function NewDirect({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Person[]>("/chat/people")
      .then(setPeople)
      .catch(() => setPeople([]))
      .finally(() => setLoading(false));
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = people.filter(
    (p) => !needle || p.name.toLowerCase().includes(needle) || p.role.toLowerCase().includes(needle),
  );

  return (
    <SheetPopup onClose={onClose} title="New chat" subtitle="Anyone who works here" columns={2}>
      <div className="space-y-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search colleagues…"
          autoFocus
          data-testid="direct-search"
          className="mise-well min-h-[46px] w-full rounded-xl px-4 text-sm outline-none"
        />

        <div className="mise-noscrollbar max-h-[52vh] space-y-1 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-6 text-center text-sm text-fg-faint">Loading colleagues…</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-faint">
              {people.length === 0 ? "Nobody else has a login yet." : `Nobody matches “${q}”.`}
            </p>
          ) : (
            shown.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                data-testid="direct-person"
                className="mise-press flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-brand-500/10"
              >
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-300"
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{p.name}</span>
                  <span className="block truncate text-[11px] text-fg-faint">
                    {p.role.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-fg-faint">
                  ›
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </SheetPopup>
  );
}

/** GIF search.
 *
 *  The key lives on the server, so this asks our own API rather than Tenor: a
 *  key in front-end JavaScript is a key you have published. Choosing one does
 *  not hot-link it either — the server fetches it and stores it like any
 *  attachment, so the joke somebody sent in March is still there in June rather
 *  than depending on someone else's CDN.
 */
function GifPicker({ onPick }: { onPick: (url: string) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ preview: string; url: string; description: string }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unconfigured">("loading");
  const [hint, setHint] = useState("");

  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => {
      api
        .get<{
          configured: boolean;
          results: { preview: string; url: string; description: string }[];
          hint?: string;
        }>(`/chat/gifs?q=${encodeURIComponent(q)}`)
        .then((d) => {
          if (!alive) return;
          setItems(d.results);
          setHint(d.hint ?? "");
          setState(d.configured ? "ready" : "unconfigured");
        })
        .catch(() => alive && setState("ready"));
      // Typing a word at a time should not be a request a letter at a time.
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [q]);

  return (
    <div className="w-[min(22rem,88vw)]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search GIFs…"
        data-testid="gif-search"
        className="mise-well mb-2 min-h-[38px] w-full rounded-lg px-3 text-sm outline-none"
      />
      {state === "unconfigured" ? (
        <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-fg-faint">
          {hint || "GIF search is not set up yet."}
          <br />
          <span className="opacity-80">
            You can still send a .gif file with the 📎 button.
          </span>
        </p>
      ) : state === "loading" ? (
        <p className="py-6 text-center text-[11px] text-fg-faint">Looking…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-fg-faint">Nothing found.</p>
      ) : (
        <div className="mise-noscrollbar grid max-h-56 grid-cols-3 gap-1 overflow-y-auto">
          {items.map((g) => (
            <button
              key={g.url}
              type="button"
              onClick={() => onPick(g.url)}
              data-testid="gif-option"
              className="mise-press overflow-hidden rounded-lg"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.preview}
                alt={g.description || "GIF"}
                loading="lazy"
                className="h-20 w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Who is in the group — searchable, because a roster of thirty is a list you
 *  scan rather than read. Shared by "new group" and "group settings" so the two
 *  cannot drift into behaving differently. */
function MemberList({
  people,
  picked,
  setPicked,
}: {
  people: Person[];
  picked: Set<string>;
  setPicked: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = people.filter(
    (p) =>
      !needle || p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle),
  );

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Members</p>
        <p className="text-[11px] text-fg-faint">{picked.size} chosen</p>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people…"
        data-testid="member-search"
        className="mise-well mt-1.5 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm outline-none"
      />
      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
        {people.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-fg-faint">Loading people…</p>
        )}
        {list.map((p) => {
          const on = picked.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              data-testid="member-option"
              onClick={() =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
              className={`mise-press flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                on ? "bg-brand-500/15" : "hover:bg-glass/5"
              }`}
            >
              <span
                aria-hidden
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] ${
                  on ? "border-brand-400 bg-brand-600 text-white" : "border-line"
                }`}
              >
                {on ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                <span className="block truncate text-[11px] text-fg-faint">
                  {p.role.replace(/_/g, " ").toLowerCase()}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Make a group and choose who is in it. */
function NewGroup({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("💬");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Person[]>("/chat/people")
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  async function create() {
    if (!name.trim()) {
      setErr("Give the group a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ id: string }>("/chat/rooms", {
        name,
        emoji,
        member_ids: [...picked],
      });
      onMade(r.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not make that group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPopup
      onClose={onClose}
      title="New group"
      subtitle="Name it, then choose who is in it"
      columns={2}
    >
      <div className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Kitchen team, Weekend crew"
          data-testid="group-name"
          className="mise-well min-h-[44px] w-full rounded-lg px-3 py-2 text-sm outline-none"
        />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Icon</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ROOM_ICONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-label={`Icon ${e}`}
                aria-pressed={emoji === e}
                className={`mise-press grid h-10 w-10 place-items-center rounded-xl text-lg transition ${
                  emoji === e ? "bg-brand-500/20 ring-1 ring-brand-400/50" : "mise-well"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <MemberList people={people} picked={picked} setPicked={setPicked} />

        {err && <p className="text-[11px] text-rose-400">{err}</p>}

        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          data-tone="brand"
          data-testid="group-create"
          className="mise-btn-flat mise-press min-h-[46px] w-full px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
        >
          {busy ? "Making…" : "Create group"}
        </button>
      </div>
    </SheetPopup>
  );
}

/** Change who is in a group, or close it. Only the owner's own groups: Everyone
 *  and Managers read their membership off people's roles, and a one-to-one is
 *  between the two of you. */
function GroupSettings({
  room,
  onClose,
  onChanged,
  onClosed,
}: {
  room: Room;
  onClose: () => void;
  onChanged: () => void;
  onClosed: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Person[]>("/chat/people")
      .then(setPeople)
      .catch(() => setPeople([]));
    api
      .get<{ member_ids: string[] }>(`/chat/rooms/${room.id}/members`)
      .then((m) => setPicked(new Set(m.member_ids)))
      .catch(() => setPicked(new Set()));
  }, [room.id]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/chat/rooms/${room.id}/members`, { member_ids: [...picked] });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  async function shut() {
    setBusy(true);
    setErr(null);
    try {
      await api.delete(`/chat/rooms/${room.id}`);
      onClosed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not close that group");
      setBusy(false);
    }
  }

  return (
    <SheetPopup onClose={onClose} title={room.name} subtitle="Who is in this group" columns={2}>
      <div className="space-y-4">
        <MemberList people={people} picked={picked} setPicked={setPicked} />

        {err && <p className="text-[11px] text-rose-400">{err}</p>}

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          data-tone="brand"
          data-testid="members-save"
          className="mise-btn-flat mise-press min-h-[46px] w-full px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save members"}
        </button>

        <div className="border-t border-line pt-3 text-center">
          {confirming ? (
            <div className="space-y-2">
              <p className="text-[11px] text-fg-faint">
                Close &ldquo;{room.name}&rdquo;? Everyone in it loses the conversation.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="mise-btn-flat mise-press min-h-[40px] flex-1 px-3 text-sm"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={() => void shut()}
                  disabled={busy}
                  data-testid="group-close-confirm"
                  className="mise-btn-flat mise-press min-h-[40px] flex-1 px-3 text-sm font-bold text-rose-400 disabled:opacity-40"
                >
                  Close the group
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="group-close"
              className="text-[11px] text-fg-faint underline underline-offset-2 hover:text-rose-400"
            >
              Close this group
            </button>
          )}
        </div>
      </div>
    </SheetPopup>
  );
}
