"use client";

// TEAM CHAT — the hotel talking to itself.
//
//   "inside hotel a grp chat i need... all in that chat they can message, send
//    gif, emojis, pic, video etc, anything they can send and its persistent,
//    literally like a whatsapp... another side, we need a grp chat for super
//    admin + manager roles alone... also i need one customisable grp creation
//    feature like superadmin can decide to create a grp and add members
//    whichever he wish."
//
// SHAPE: two panes on a laptop — rooms beside the conversation, the way every
// chat app on a big screen works — and ONE pane at a time on a phone, because
// 390px cannot hold both and splitting it gives you two things too narrow to
// use. On a phone the list is the screen; tapping a room replaces it, and Back
// returns. That is the same gesture people already have in their thumbs.
//
// The window never scrolls: the shell is a fixed-height column and only the
// message list moves. "i hate scrolling" applies doubly to a chat, where the
// composer must never wander off the bottom.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, fetchBlobUrl, postForm } from "@/lib/api";
import { refreshChatUnread } from "@/lib/chatUnread";
import { Card, PageHeader } from "@/components/ui";
import { SheetPopup } from "@/components/SheetPopup";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

type Room = {
  id: string;
  kind: "everyone" | "managers" | "custom";
  name: string;
  emoji?: string | null;
  unread: number;
  last_message_at?: string | null;
  preview?: string | null;
  last_sender?: string | null;
};

type Msg = {
  id: string;
  body: string | null;
  sender_user_id: string | null;
  sender_name: string;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
};

type Person = { id: string; name: string; email: string; role: string };

/** A small, fast emoji set. Deliberately not a 1,800-emoji library: this is a
 *  staff room, and the ones people actually reach for fit on two rows. */
const EMOJI = [
  "👍", "👌", "🙏", "🔥", "🎉", "😀", "😂", "🙂", "😉", "😍",
  "😅", "😴", "🤝", "💪", "👀", "✅", "❌", "⏰", "📣", "❤️",
  "🍽️", "🍳", "🥗", "🧾", "📦", "🚚", "💷", "⚠️", "🧹", "☕",
];

export default function TeamChatPage() {
  const { user } = useAuth();
  const canManage = can(user?.role, "users:write");

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const room = rooms?.find((r) => r.id === openId) ?? null;

  const loadRooms = useCallback(async () => {
    try {
      setRooms(await api.get<Room[]>("/chat/rooms"));
    } catch {
      setRooms((r) => r ?? []);
    }
  }, []);

  const loadMsgs = useCallback(async (id: string) => {
    try {
      setMsgs(await api.get<Msg[]>(`/chat/rooms/${id}/messages`));
      // Reading a room marks it seen server-side, so the nav badge is stale the
      // instant this returns. Dropping it here beats leaving it lit for another
      // half minute after the user has plainly read the message.
      refreshChatUnread();
    } catch {
      setMsgs((m) => m ?? []);
    }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  // Open the busiest room on a laptop so the page is never a dead end; on a
  // phone the LIST is the landing screen, because auto-opening a room would
  // hide the thing you came to choose from.
  useEffect(() => {
    if (openId || !rooms?.length) return;
    if (window.matchMedia("(min-width: 1024px)").matches) setOpenId(rooms[0].id);
  }, [rooms, openId]);

  useEffect(() => {
    if (openId) void loadMsgs(openId);
  }, [openId, loadMsgs]);

  // Poll while somebody is looking. A hidden tab costs nothing.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void loadRooms();
      if (openId) void loadMsgs(openId);
    };
    const id = window.setInterval(tick, 6000);
    return () => window.clearInterval(id);
  }, [openId, loadRooms, loadMsgs]);

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
      const m = await api.post<Msg>(`/chat/rooms/${openId}/messages`, { body });
      setDraft("");
      atBottom.current = true;
      setMsgs((x) => [...(x ?? []), m]);
      void loadRooms();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that");
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
      const m = await postForm<Msg>(`/chat/rooms/${openId}/attachment`, form);
      atBottom.current = true;
      setMsgs((x) => [...(x ?? []), m]);
      void loadRooms();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that file");
    } finally {
      setSending(false);
    }
  }

  const totalUnread = useMemo(
    () => (rooms ?? []).reduce((t, r) => t + r.unread, 0),
    [rooms],
  );

  return (
    <div className="flex h-[calc(100svh-9rem)] min-h-0 flex-col">
      <PageHeader
        title="Team chat"
        subtitle={
          totalUnread > 0
            ? `${totalUnread} unread message${totalUnread === 1 ? "" : "s"}`
            : "Everyone, managers, and any group you make."
        }
        actions={
          canManage ? (
            <button
              type="button"
              onClick={() => setMakeOpen(true)}
              data-tone="brand"
              data-testid="new-group"
              className="mise-btn-flat mise-press min-h-[40px] px-4 py-2 text-sm font-bold text-brand-300"
            >
              ＋ New group
            </button>
          ) : undefined
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = "";
        }}
      />

      {/* TWO PANES ON A LAPTOP, ONE ON A PHONE. */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[19rem_1fr]">
        {/* ── rooms ───────────────────────────────────────────────────── */}
        <Card
          className={`min-h-0 overflow-hidden p-0 ${openId ? "hidden lg:flex" : "flex"} flex-col`}
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-fg">Conversations</p>
          </div>
          <div className="mise-noscrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {rooms === null ? (
              <p className="px-3 py-6 text-center text-sm text-fg-faint">Loading…</p>
            ) : rooms.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-fg-faint">
                No conversations yet.
              </p>
            ) : (
              rooms.map((r) => {
                const on = r.id === openId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    data-testid="chat-room"
                    className={`mise-press mb-1 flex min-h-[60px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      on ? "bg-brand-500/15" : "hover:bg-glass/5"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base"
                    >
                      {r.emoji ?? "💬"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-fg">{r.name}</span>
                        {r.kind !== "custom" && (
                          <span className="mise-chip shrink-0 text-[9px]">
                            {r.kind === "everyone" ? "all" : "staff only"}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-fg-faint">
                        {r.preview
                          ? `${r.last_sender ? `${r.last_sender.split(" ")[0]}: ` : ""}${r.preview}`
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
              })
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
                {/* Back is the phone's way out of a room. On a laptop both
                    panes are visible, so it would be a button to nowhere. */}
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  aria-label="Back to conversations"
                  className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-lg text-fg-soft hover:bg-glass/5 lg:hidden"
                >
                  ‹
                </button>
                <span aria-hidden className="mise-well grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base">
                  {room.emoji ?? "💬"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{room.name}</p>
                  <p className="truncate text-[11px] text-fg-faint">
                    {room.kind === "everyone"
                      ? "Everyone who works here"
                      : room.kind === "managers"
                        ? "Managers and the owner only"
                        : "Private group"}
                  </p>
                </div>
                {/* Only a group the owner made has anything to change. The two
                    standing rooms take their membership from people's roles, so
                    a settings button there would open onto nothing. */}
                {canManage && room.kind === "custom" && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
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
                className="mise-noscrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3"
              >
                {msgs === null ? (
                  <p className="py-8 text-center text-sm text-fg-faint">Loading…</p>
                ) : msgs.length === 0 ? (
                  <p className="py-12 text-center text-sm text-fg-faint">
                    <span aria-hidden className="mr-1.5 text-lg">💬</span>
                    Nothing here yet — say hello.
                  </p>
                ) : (
                  msgs.map((m) => {
                    const own = m.sender_user_id === user?.id;
                    return (
                      <div key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[70%] ${
                            own ? "bg-brand-600 text-white" : "mise-card-inset text-fg"
                          }`}
                        >
                          {!own && (
                            <p className="mb-0.5 text-[11px] font-semibold text-fg-faint">
                              {m.sender_name}
                            </p>
                          )}

                          {m.attachment_url && <Attachment msg={m} />}

                          {m.body && (
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                              {m.body}
                            </p>
                          )}
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

              {err && <p className="px-4 pb-1 text-[11px] text-rose-400">{err}</p>}

              <div className="relative border-t border-line px-3 py-3">
                {showEmoji && (
                  <div className="mise-pop absolute bottom-full left-3 mb-2 w-[min(20rem,86vw)] rounded-2xl border border-line bg-paper p-2 shadow-2xl">
                    <div className="grid grid-cols-10 gap-1">
                      {EMOJI.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            setDraft((d) => d + e);
                            setShowEmoji(false);
                          }}
                          className="mise-press grid h-8 place-items-center rounded-lg text-lg hover:bg-glass/10"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
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
                    aria-label="Send a picture or video"
                    title="Picture or video"
                    className="mise-btn-flat mise-press grid h-11 w-11 shrink-0 place-items-center text-lg"
                  >
                    📎
                  </button>
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
                    placeholder={`Message ${room.name}…`}
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
                <span aria-hidden className="mb-2 block text-3xl">💬</span>
                Pick a conversation to start reading.
              </p>
            </div>
          )}
        </Card>
      </div>

      {makeOpen && (
        <NewGroup
          onClose={() => setMakeOpen(false)}
          onMade={(id) => {
            setMakeOpen(false);
            void loadRooms().then(() => setOpenId(id));
          }}
        />
      )}

      {settingsOpen && room && (
        <GroupSettings
          room={room}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void loadRooms()}
          onClosed={() => {
            setSettingsOpen(false);
            setOpenId(null);
            void loadRooms();
          }}
        />
      )}
    </div>
  );
}

/** A picture or a video, fetched WITH the token and shown from a blob.
 *
 *  It cannot simply be `<img src={url}>`: the endpoint checks that the viewer
 *  can open the room the file was posted in, and an img tag sends no
 *  Authorization header, so the browser would be turned away and paint a broken
 *  icon. Clicking opens the same blob full-size — pointing the link at the API
 *  path would hit the identical wall in a new tab.
 */
function Attachment({ msg }: { msg: Msg }) {
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
      <div className="mb-1.5 grid h-32 w-48 place-items-center rounded-xl bg-glass/10 text-[11px] opacity-70">
        Loading…
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-1.5 block overflow-hidden rounded-xl">
      {msg.attachment_type?.startsWith("video/") ? (
        <video src={url} controls className="max-h-64 w-full rounded-xl" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={msg.attachment_name ?? ""}
          className="max-h-64 rounded-xl object-cover"
        />
      )}
    </a>
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
  const shown = people.filter(
    (p) =>
      !needle ||
      p.name.toLowerCase().includes(needle) ||
      p.email.toLowerCase().includes(needle),
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
        {shown.map((p) => {
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

/** Change who is in a group, or close it.
 *
 *  Without this a group could be made and never unmade, and every experiment
 *  would become permanent furniture in everybody's list. Only the owner's own
 *  groups are editable — Everyone and Managers read their membership off
 *  people's roles, so there is no list here to edit and the server refuses one.
 */
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
    api.get<Person[]>("/chat/people").then(setPeople).catch(() => setPeople([]));
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

        {/* Closing loses the history, so it asks once. It is not a red button
            sitting among ordinary ones — it is a quiet link that turns into a
            question only once you have chosen it. */}
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

/** Make a group and choose who is in it — searchable, because a roster of
 *  thirty is a list you scan rather than read. */
function NewGroup({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("💬");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Person[]>("/chat/people").then(setPeople).catch(() => setPeople([]));
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
    <SheetPopup onClose={onClose} title="New group" subtitle="Name it, then choose who is in it" columns={2}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <select
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            aria-label="Group icon"
            className="mise-well min-h-[44px] w-20 rounded-lg px-2 text-center text-lg outline-none"
          >
            {["💬", "🍽️", "🍳", "📦", "🚚", "🧹", "💷", "📣", "🎉", "⚠️"].map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Kitchen team, Weekend crew"
            data-testid="group-name"
            className="mise-well min-h-[44px] flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          />
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
