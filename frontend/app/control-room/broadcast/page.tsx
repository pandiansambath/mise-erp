"use client";

// /control-room/broadcast — the composer + FULL paginated history.
//
// Two named defects fixed here (ARCHITECTURE.md weaknesses 5 & 6):
//  · the old card fetched 50 and rendered 6 — this shows every one, paginated.
//  · THREE states, not two: live / withdrawn (is_active false) / EXPIRED
//    (is_active true but expires_at already past — the old card drew that as
//    a green "live" badge, while /announcements/active had already stopped
//    serving it).
//  · the blast radius: the server emails every active hotel's admins. The
//    composer and the confirm both now say so, and the confirm lists the N
//    names it actually goes to — never an invented email count.

import { useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { useConfirm } from "@/components/confirm";
import { Button, Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { Pager, applyFilter, pageOf, useListFilter } from "@/components/ListControls";

type Announcement = {
  id: string;
  message: string;
  level: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string | null;
};

type BroadcastState = "live" | "expired" | "withdrawn";

function stateOf(a: Announcement, now: number): BroadcastState {
  if (!a.is_active) return "withdrawn";
  if (a.expires_at && new Date(a.expires_at).getTime() <= now) return "expired";
  return "live";
}

function ErrorCard({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">
        {error.status || "!"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">This did not load</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

export default function BroadcastPage() {
  const { hotels } = useFleet();
  const listQ = useOperatorQuery<{ announcements: Announcement[] }>("/platform/announcements");
  const confirm = useConfirm();

  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const [f, setF] = useListFilter("cr.broadcast.history");

  const activeHotels = useMemo(() => hotels.filter((h) => h.is_active), [hotels]);

  async function send() {
    if (message.trim().length < 3) return;
    const ok = await confirm({
      title: `Broadcast to ${activeHotels.length} active restaurant${activeHotels.length === 1 ? "" : "s"}?`,
      message: (
        <>
          <p>
            Every one of these gets an in-app banner{expires ? ` until ${expires}` : ", until you withdraw it"}
            . Their admins also get an email, unless they have turned broadcast emails off.
          </p>
          <ul className="mise-well mt-3 max-h-48 space-y-1 overflow-y-auto rounded-xl p-2.5 text-xs">
            {activeHotels.map((h) => (
              <li key={h.id} className="truncate text-fg-soft">
                {h.name}
              </li>
            ))}
          </ul>
        </>
      ),
      confirmText: "Broadcast",
    });
    if (!ok) return;
    setBusy(true);
    setSendErr(null);
    try {
      await api.post("/platform/announcements", {
        message: message.trim(),
        level,
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      });
      setMessage("");
      setExpires("");
      listQ.reload();
    } catch (err) {
      setSendErr(err instanceof ApiError ? err.message : "Could not send the broadcast.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(a: Announcement) {
    const ok = await confirm({
      title: "Withdraw this broadcast?",
      message: "It disappears from every restaurant's app immediately.",
      confirmText: "Withdraw",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/platform/announcements/${a.id}`);
      listQ.reload();
    } catch {
      setSendErr("Could not withdraw that broadcast.");
    }
  }

  const rows = useMemo(() => listQ.data?.announcements ?? [], [listQ.data]);
  // Frozen at mount — render-pure "is this expired yet" math, same idiom the
  // fleet table already uses for "days ago".
  const [now] = useState(() => Date.now());
  const filtered = useMemo(
    () =>
      applyFilter(rows, f, (a) => ({
        text: a.message,
        status: stateOf(a, now),
        date: a.created_at ?? "",
        value: 0,
      })),
    [rows, f, now],
  );
  const shown = pageOf(filtered, f);
  const counts = useMemo(() => {
    const c = { live: 0, expired: 0, withdrawn: 0 };
    for (const a of rows) c[stateOf(a, now)]++;
    return c;
  }, [rows, now]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Broadcast"
        subtitle="A dismissible banner in every restaurant's app — maintenance notices, new features, price changes."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[18rem] flex-1">
            <span className="text-xs font-medium text-fg-faint">Message</span>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              placeholder="e.g. DineAI gets new charts tonight 22:00–22:15 — nothing you need to do."
              className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
          </label>
          <Segmented
            value={level}
            onChange={setLevel}
            options={[
              { value: "info", label: "Info" },
              { value: "warn", label: "Warning" },
            ]}
          />
          <label className="block">
            <span className="block text-[11px] text-fg-faint">Auto-expires (optional)</span>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="mise-well mt-1 rounded-lg px-2.5 py-1.5 text-sm outline-none"
            />
          </label>
          <Button variant="primary" onClick={send} busy={busy} disabled={message.trim().length < 3}>
            Broadcast
          </Button>
        </div>
        <p className="mt-3 text-xs text-fg-faint">
          Goes to <b className="text-fg-soft">{activeHotels.length}</b> active restaurant
          {activeHotels.length === 1 ? "" : "s"}. Each gets an in-app banner, and their admins
          also get an email unless they have turned broadcast emails off.
        </p>
        {sendErr && (
          <p className="mt-2 text-xs font-medium text-danger">{sendErr}</p>
        )}
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
            Broadcast history
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-fg-faint">
            {counts.live} live · {counts.expired} expired · {counts.withdrawn} withdrawn
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-line px-4 py-2.5">
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })}
            placeholder="Search broadcast text…"
            className="mise-well w-full max-w-sm rounded-xl px-3 py-2 text-sm outline-none"
          />
          {(["all", "live", "expired", "withdrawn"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setF({ ...f, status: s, page: 1 })}
              className={`mise-press rounded-full px-3 py-1.5 text-xs font-medium transition ${
                f.status === s ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {listQ.error ? (
          <div className="p-4">
            <ErrorCard error={listQ.error} onRetry={listQ.reload} />
          </div>
        ) : listQ.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
            <p className="font-display text-lg font-semibold text-fg">Nothing broadcast yet</p>
            <p className="mt-1.5 max-w-sm text-sm text-fg-faint">
              Send your first banner above — it reaches every active restaurant&apos;s app.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    <th className="px-4 py-2.5">Message</th>
                    <th className="px-3 py-2.5">State</th>
                    <th className="px-3 py-2.5">Sent</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => {
                    const st = stateOf(a, now);
                    const rail =
                      st === "live" ? "bg-emerald-400/60" : st === "expired" ? "bg-amber-400/80" : "bg-fg-faint/25";
                    return (
                      <tr key={a.id} className="group border-b border-line/60 transition hover:bg-glass/[0.04]">
                        <td data-label="Message" className="relative py-2.5 pl-4 pr-3">
                          <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${rail}`} />
                          <span className="block max-w-[28rem] truncate text-sm text-fg">{a.message}</span>
                          {a.level === "warn" && (
                            <span className="mise-chip mt-1 inline-flex" data-tone="amber">
                              warning tone
                            </span>
                          )}
                        </td>
                        <td data-label="State" className="px-3 py-2.5">
                          <span
                            className="mise-chip"
                            data-tone={st === "live" ? "green" : st === "expired" ? "amber" : "slate"}
                          >
                            {st}
                          </span>
                          {a.expires_at && (
                            <span className="ml-2 text-[11px] text-fg-faint">
                              until {a.expires_at.slice(0, 10)}
                            </span>
                          )}
                        </td>
                        <td data-label="Sent" className="px-3 py-2.5 font-mono text-xs text-fg-soft">
                          {a.created_at
                            ? new Date(a.created_at).toLocaleString(undefined, {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setMessage(a.message);
                                setLevel(a.level === "warn" ? "warn" : "info");
                              }}
                              className="mise-btn-flat mise-press px-2.5 py-1 text-xs font-medium"
                            >
                              Reuse
                            </button>
                            {st === "live" && (
                              <button
                                type="button"
                                onClick={() => withdraw(a)}
                                data-tone="danger"
                                className="mise-btn-flat mise-press px-2.5 py-1 text-xs font-medium"
                              >
                                Withdraw
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager value={f} onChange={setF} matched={filtered.length} />
          </>
        )}
      </Card>
    </div>
  );
}
