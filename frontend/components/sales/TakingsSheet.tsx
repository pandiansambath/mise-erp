"use client";

// The day's takings — seen, typed and corrected in one place.
//
//     "if i enter today's sales and money box....yesterday sales related
//      history i cant able to see even if i go back using time"
//     "i can also edit that sales information if needed which will also sync
//      wherever needed"
//     "that sales entering area is tooo stretched which is bit old style"
//
// ⚠️ WHY A PAST DAY LOOKED EMPTY. The old sheet was an ADD form: a column of
// blank 0.00 boxes, one per channel, that appended a new line when saved. Step
// back to a day that already had £2,141 of takings and you saw… blank boxes.
// The figures were real and saved — they sat in a separate list further down,
// titled "Today's lines" whatever day it was. So the day read as lost.
//
// NOW EACH CHANNEL CARD SHOWS WHAT THAT DAY ALREADY HAS, and every saved figure
// can be tapped and corrected in place. The box underneath still adds more.
//
// ⚠️ WHAT THIS MUST NOT BECOME AGAIN. He rejected tiles once, and the reason is
// recorded in the page: each tile opened a popup, so entering five numbers
// meant five popups, and the popup was so cramped its keypad scrolled. The
// rule from that stays: EVERY box is visible at once, typed directly, nothing
// to open, saved once. These are cards with the input INSIDE them — the
// popups were the mistake, not the grid.
//
// THREE SMALLER FAULTS FIXED IN PASSING:
//  · "Paid by" was ONE control for every box. Type Deliveroo while CASH was
//    selected and it was recorded as cash — which then inflated the expected
//    cash in the drawer. The method is now per card.
//  · Drafts survived a change of day, so typed figures saved onto whichever
//    day you had stepped to. The parent keys this component by day, so a new
//    day is a new, empty draft.
//  · A deactivated channel's PAST sales vanished from the form, because it
//    listed active channels only. A channel with figures on this day is shown
//    whatever its status — history does not disappear because a platform did.
//
// THE CARD, SECOND PASS (29 Sep):
//
//     "i cant comfortably enter the numbers in that small input box of foodhub,
//      cash, uber etc"   "what if that foodhub name is too big"
//     "when typing bring that particular card alone front with smooth animation
//      and show as bit big than other cards"
//
// The amount box was ~70px wide because it shared a row with a 104px "paid by"
// picker — the thing you type into most got the least room, for a setting that
// almost never changes. Now the AMOUNT spans the card, large, with the currency
// in front; "paid by" is a small pill beside the cut; the name has the whole
// width and wraps to two lines before it ellipsises. And the card being typed
// in LIFTS — a little larger, in front, the others dimmed — so the eye is on
// the one number that matters. Resting, every card is roomy on its own: the
// lift is a finish, not the fix.
//
// ⚠️ TYPED FIGURES ARE KEPT ON THE SERVER as they are typed (a per-person
// draft: /sales/days/{day}/draft), so a reload, a crash or logging out and in
// gives them back. The draft is never a sale. Saving a figure removes it from
// the draft IN THE SAME COMMIT on the server — a figure left behind would come
// back as "1 unsaved" and be saved twice.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE, ApiError, getToken, type DaySummary, type SalesChannel, type SalesLine } from "@/lib/api";
import { useConfirm } from "@/components/confirm";
import { ReachBar } from "@/components/PageKit";
import { Select } from "@/components/Select";
import { numeric } from "@/lib/sanitize";

const METHODS = ["CARD", "CASH", "ONLINE", "BANK"] as const;

/** Said as a phrase, so the small pill reads on its own: "paid online ▾". */
const PAID: Record<string, string> = {
  CARD: "paid by card",
  CASH: "paid in cash",
  ONLINE: "paid online",
  BANK: "paid to bank",
};

type DraftEntries = Record<string, { amount: string; method?: string | null }>;
type Keeping = "idle" | "keeping" | "kept" | "restored" | "failed";

/** A sensible first guess at how a channel is paid — always changeable. */
function defaultMethod(channel: SalesChannel, lines: SalesLine[]): string {
  // Whatever it was last paid by today is the best guess of all.
  const last = [...lines].reverse().find((l) => l.channel_id === channel.id);
  if (last) return last.payment_method;
  const n = channel.name.toLowerCase();
  if (n.includes("cash")) return "CASH";
  // The delivery platforms settle into the bank, never into the drawer — and
  // guessing CASH for one would inflate the expected cash every single time.
  if (/(deliveroo|uber|just ?eat|foodhub|online|app)/.test(n)) return "ONLINE";
  return "CARD";
}

export function TakingsSheet({
  day,
  isToday,
  summary,
  channels,
  canWrite,
  format,
  onSummary,
}: {
  day: string;
  isToday: boolean;
  summary: DaySummary;
  channels: SalesChannel[];
  canWrite: boolean;
  format: (v: string) => string;
  onSummary: (s: DaySummary) => void;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which saved line is being corrected, and its working value.
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  // The card being typed in — it lifts to the front.
  const [focused, setFocused] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  // ── keeping the draft on the server ──────────────────────────────────────
  const [loaded, setLoaded] = useState(!canWrite);
  const [keeping, setKeeping] = useState<Keeping>("idle");
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<DraftEntries | null>(null);
  // What the server already holds, so an unchanged draft is not written again
  // (and "brought back from earlier" is not instantly replaced by "kept").
  const lastKept = useRef("{}");
  const draftUrl = `/sales/days/${day}/draft`;

  // What we have now, in the server's shape. Only figures actually typed:
  // a method picked with no amount beside it is not worth keeping.
  const toEntries = (d: Record<string, string>, m: Record<string, string>): DraftEntries =>
    Object.fromEntries(
      Object.entries(d)
        .filter(([, v]) => v !== "")
        .map(([id, amount]) => [id, { amount, method: m[id] ?? null }]),
    );

  // Bring back what was typed and not saved — after a reload, or a new login.
  useEffect(() => {
    if (!canWrite) return;
    let live = true;
    api
      .get<{ entries: DraftEntries }>(draftUrl)
      .then(({ entries }) => {
        if (!live) return;
        const ids = Object.keys(entries);
        if (!ids.length) return;
        // Anything typed while this was loading wins over what was kept.
        setDraft((d) => ({ ...Object.fromEntries(ids.map((id) => [id, entries[id].amount])), ...d }));
        setMethods((m) => ({
          ...Object.fromEntries(
            ids.filter((id) => entries[id].method).map((id) => [id, entries[id].method as string]),
          ),
          ...m,
        }));
        lastKept.current = JSON.stringify(entries);
        setKeeping("restored");
      })
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [canWrite, draftUrl]);

  // Keep it as it is typed: a short pause, then one write. Writes go in
  // ORDER, one after another — two in flight could land the older one last.
  useEffect(() => {
    if (!canWrite || !loaded) return;
    const entries = toEntries(draft, methods);
    const key = JSON.stringify(entries);
    if (key === lastKept.current) {
      pending.current = null;
      return;
    }
    pending.current = entries;
    const t = setTimeout(() => {
      pending.current = null;
      lastKept.current = key;
      setKeeping("keeping");
      chain.current = chain.current
        .then(() => api.put(draftUrl, { entries }))
        .then(() => setKeeping(Object.keys(entries).length ? "kept" : "idle"))
        .catch(() => {
          lastKept.current = ""; // try again on the next keystroke
          setKeeping("failed");
        });
    }, 500);
    return () => clearTimeout(t);
  }, [draft, methods, loaded, canWrite, draftUrl]);

  // Closing the tab, reloading, or leaving the page inside that half-second
  // pause must not lose the last keystrokes. `keepalive` lets the request
  // outlive the page — the one thing a normal fetch cannot do.
  useEffect(() => {
    const flush = () => {
      const entries = pending.current;
      if (!entries) return;
      pending.current = null;
      lastKept.current = JSON.stringify(entries);
      const token = getToken();
      fetch(`${API_BASE}/api${draftUrl}`, {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ entries }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush(); // stepping to another day, or another page, counts too
    };
  }, [draftUrl]);

  // The currency's own symbol, for the front of the amount box.
  const symbol = format("0").replace(/[\d.,\s-]/g, "") || "£";

  /** Active channels, plus any inactive one that has figures on THIS day. */
  const shown = useMemo(() => {
    const withLines = new Set(summary.lines.map((l) => l.channel_id));
    return channels.filter((c) => c.is_active || withLines.has(c.id));
  }, [channels, summary.lines]);

  const methodFor = (c: SalesChannel) => methods[c.id] ?? defaultMethod(c, summary.lines);

  const draftEntries = Object.entries(draft).filter(([, v]) => parseFloat(v) > 0);
  const draftNet = draftEntries.reduce((t, [id, v]) => {
    const c = channels.find((x) => x.id === id);
    const pct = parseFloat(c?.commission_pct ?? "0") || 0;
    return t + parseFloat(v) * (1 - pct / 100);
  }, 0);

  async function saveDraft() {
    setError(null);
    setSaving(true);
    try {
      // SEQUENTIAL, deliberately: each call returns the whole day, and firing
      // them together means the last response wins and the others' lines
      // vanish from the screen until a reload.
      for (const [channel_id, value] of draftEntries) {
        const c = channels.find((x) => x.id === channel_id);
        const latest = await api.post<DaySummary>(`/sales/days/${day}/lines`, {
          channel_id,
          gross_amount: value,
          payment_method: c ? methodFor(c) : "CARD",
        });
        // Off the screen THE MOMENT it is saved, not after the whole batch:
        // if the third of five fails, pressing Save again must not add the
        // first two a second time.
        // (The server took it out of the kept draft in the same commit as the
        // sale; this stops the screen writing it back.)
        const without = <T,>(o: Record<string, T>) => {
          const rest = { ...o };
          delete rest[channel_id];
          return rest;
        };
        setDraft(without);
        setMethods(without);
        onSummary(latest);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the takings.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(line: SalesLine, patch: { gross_amount?: string; payment_method?: string }) {
    setError(null);
    try {
      onSummary(await api.patch<DaySummary>(`/sales/days/${day}/lines/${line.id}`, patch));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change that figure.");
    } finally {
      setEditing(null);
    }
  }

  async function remove(line: SalesLine) {
    const ok = await confirm({
      title: `Remove ${format(line.gross_amount)} from ${line.channel_name}?`,
      message: "It comes out of this day's takings, and every report that reads them.",
      confirmText: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      onSummary(await api.delete<DaySummary>(`/sales/days/${day}/lines/${line.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove that line.");
    }
  }

  const hasAnything = summary.lines.length > 0;

  return (
    <>
      {/* WHICH DAY THESE ARE — said in words, because "Today's lines" on a
          day three weeks ago is how the data came to look lost. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 px-4 py-2.5">
        <p className="text-sm text-fg-soft">
          {isToday ? (
            <b className="text-fg">Today&apos;s takings</b>
          ) : (
            <>
              <b className="text-fg">
                Takings for{" "}
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </b>
              {canWrite && <span className="text-fg-faint"> · you can still change them</span>}
            </>
          )}
        </p>
        {hasAnything && (
          <p className="text-xs text-fg-faint">
            {summary.lines.length} saved ·{" "}
            <b className="font-display text-sm text-fg">{format(summary.totals.gross)}</b> gross
          </p>
        )}
      </div>

      {/* ── the cards ────────────────────────────────────────────────────── */}
      <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) => {
          const pct = parseFloat(c.commission_pct) || 0;
          const saved = summary.lines.filter((l) => l.channel_id === c.id);
          const savedGross = saved.reduce((t, l) => t + (parseFloat(l.gross_amount) || 0), 0);
          const typed = parseFloat(draft[c.id] ?? "");
          const typedNet = Number.isFinite(typed) && typed > 0 ? typed * (1 - pct / 100) : 0;
          const method = methodFor(c);
          const lifted = focused === c.id;

          return (
            <div
              key={c.id}
              // THE LIFT. Focus anywhere in the card raises it; leaving the
              // card (not just moving between its own controls) lowers it.
              onFocus={() => setFocused(c.id)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setFocused((f) => (f === c.id ? null : f));
                }
              }}
              className={`mise-card-inset relative flex flex-col rounded-2xl p-3.5 transition-[transform,opacity,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transform-none motion-reduce:transition-none ${
                lifted
                  ? "z-10 scale-[1.04] shadow-[0_22px_48px_-16px_rgba(0,0,0,0.45)] ring-2 ring-brand-400/60"
                  : focused
                    ? "scale-[0.985] opacity-70"
                    : typedNet > 0
                      ? "ring-1 ring-brand-400/50"
                      : ""
              }`}
            >
              {/* The NAME gets the whole width and two lines; only a name
                  longer than that ellipsises, and the full one is on hover. */}
              <p
                title={c.name}
                className={`line-clamp-2 break-words font-semibold leading-snug text-fg ${
                  c.name.length > 18 ? "text-sm" : ""
                }`}
              >
                {c.name}
                {!c.is_active && (
                  <span className="ml-1.5 text-[10px] font-normal text-fg-faint">(retired)</span>
                )}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-glass/[0.06] px-2 py-0.5 text-[10px] text-fg-faint">
                  {pct > 0 ? `${pct}% cut` : "no cut"}
                </span>
                {/* How it was paid: a pill, because it almost never changes —
                    it used to take half the card from the amount box. */}
                {canWrite && (
                  <Select
                    compact
                    className="inline-block"
                    value={method}
                    onChange={(v) => setMethods((m) => ({ ...m, [c.id]: v }))}
                    ariaLabel={`How ${c.name} was paid`}
                    options={METHODS.map((m) => ({ value: m, label: PAID[m] }))}
                  />
                )}
              </div>

              {/* What this day already has — the thing that used to be hidden. */}
              {saved.length > 0 && (
                <div className="mt-2">
                  <p className="font-display text-xl font-semibold tabular-nums text-fg">
                    {format(savedGross.toFixed(2))}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {saved.map((l) => (
                      <li key={l.id} className="flex items-center gap-1.5 text-xs">
                        {editing?.id === l.id ? (
                          <input
                            autoFocus
                            value={editing.value}
                            inputMode="decimal"
                            onChange={(e) => setEditing({ id: l.id, value: numeric(e.target.value) })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(l, { gross_amount: editing.value });
                              if (e.key === "Escape") setEditing(null);
                            }}
                            onBlur={() => {
                              if (editing.value && editing.value !== l.gross_amount) {
                                saveEdit(l, { gross_amount: editing.value });
                              } else setEditing(null);
                            }}
                            aria-label={`Correct ${c.name} amount`}
                            className="mise-well w-24 rounded-md px-2 py-1 text-right tabular-nums outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => setEditing({ id: l.id, value: l.gross_amount })}
                            title={canWrite ? "Tap to correct" : undefined}
                            className="mise-press rounded-md px-1.5 py-0.5 tabular-nums text-fg-soft hover:bg-glass/[0.06] disabled:hover:bg-transparent"
                          >
                            {format(l.gross_amount)}
                            {canWrite && <span aria-hidden className="ml-1 text-fg-faint">✎</span>}
                          </button>
                        )}
                        {canWrite ? (
                          // Paid-by on a SAVED line is one tap to change, because
                          // "that was card, not cash" is the commonest correction.
                          <button
                            type="button"
                            onClick={() => {
                              const at = (METHODS as readonly string[]).indexOf(l.payment_method);
                              const next = METHODS[(at + 1) % METHODS.length];
                              saveEdit(l, { payment_method: next });
                            }}
                            title="Tap to change how it was paid"
                            className="mise-press rounded-full border border-line px-1.5 py-0.5 text-[10px] text-fg-faint hover:text-fg"
                          >
                            {l.payment_method.toLowerCase()}
                          </button>
                        ) : (
                          <span className="text-[10px] text-fg-faint">{l.payment_method.toLowerCase()}</span>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => remove(l)}
                            aria-label={`Remove ${format(l.gross_amount)} from ${c.name}`}
                            className="mise-press ml-auto rounded-md px-1.5 text-fg-faint hover:text-rose-300"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── adding more — the box is IN the card, never a popup ── */}
              {canWrite && (
                <div className="mt-auto pt-3">
                  {/* THE AMOUNT, THE WIDTH OF THE CARD. A <label>, so a tap
                      anywhere on the well — the symbol included — lands in it. */}
                  <label className="mise-well flex min-h-[52px] cursor-text items-center gap-2 rounded-xl px-3.5 transition">
                    <span aria-hidden className="font-display text-lg text-fg-faint">
                      {symbol}
                    </span>
                    <input
                      value={draft[c.id] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [c.id]: numeric(e.target.value) }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draftEntries.length) saveDraft();
                      }}
                      inputMode="decimal"
                      placeholder={saved.length ? "add more" : "0.00"}
                      aria-label={`Gross takings for ${c.name}`}
                      // The WELL shows focus (its own halo); the global keyboard
                      // outline on the input drew a second box inside it.
                      className="w-full min-w-0 bg-transparent py-2 text-right font-display text-2xl tabular-nums text-fg outline-none! placeholder:text-base placeholder:text-fg-faint/70"
                    />
                  </label>
                  {typedNet > 0 && (
                    <p className="mt-1 text-right text-[11px] text-fg-faint">
                      nets{" "}
                      <b className="font-display text-sm text-brand-300">
                        {format(typedNet.toFixed(2))}
                      </b>
                    </p>
                  )}
                </div>
              )}

              {!canWrite && saved.length === 0 && (
                <p className="mt-2 text-xs text-fg-faint">nothing on this day</p>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="px-4 pb-2 text-sm text-rose-400">{error}</p>}

      {/* THE SAVE, IN NORMAL FLOW — never sticky inside the card, because a
          bottom-stuck element gets painted over the rows above it. ReachBar
          covers the case where it has scrolled out of sight. */}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line/60 bg-paper-2/30 px-4 py-2.5">
          <span className="text-xs text-fg-faint">
            {draftEntries.length === 0 ? (
              hasAnything ? "tap a figure to correct it · type in a card to add more" : "fill in what you took"
            ) : (
              <>
                {draftEntries.length} to add · nets{" "}
                <b className="font-display text-sm text-brand-300">{format(draftNet.toFixed(2))}</b>
                {/* Said out loud, so an unsaved figure is not a worry: it is
                    kept, it is not yet a sale, and Save is what makes it one. */}
                <span
                  className={`ml-2 ${keeping === "failed" ? "text-amber-300" : "text-fg-faint"}`}
                  aria-live="polite"
                >
                  {keeping === "keeping" && "· keeping…"}
                  {keeping === "kept" && "· ☁ kept safe until you save"}
                  {keeping === "restored" && "· ☁ brought back from earlier — not saved yet"}
                  {keeping === "failed" && "· could not keep this — save it soon"}
                </span>
              </>
            )}
          </span>
          <button
            ref={saveRef}
            type="button"
            onClick={saveDraft}
            disabled={saving || draftEntries.length === 0}
            data-tone="brand"
            className="mise-btn-flat mise-press ml-auto min-h-[40px] px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
          >
            {saving ? "Saving…" : draftEntries.length > 1 ? `Save ${draftEntries.length} takings` : "Save takings"}
          </button>
        </div>
      )}

      <ReachBar watch={saveRef} show={draftEntries.length > 0 && !saving}>
        <span className="text-xs text-fg-faint">
          nets <b className="font-display text-sm text-brand-300">{format(draftNet.toFixed(2))}</b>
        </span>
        <button
          type="button"
          onClick={saveDraft}
          data-tone="brand"
          className="mise-btn-flat mise-press min-h-[40px] px-4 py-2 text-sm font-bold text-brand-300"
        >
          Save {draftEntries.length} unsaved
        </button>
      </ReachBar>
    </>
  );
}
