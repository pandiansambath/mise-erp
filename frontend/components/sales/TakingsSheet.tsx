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

import { useMemo, useRef, useState } from "react";
import { api, ApiError, type DaySummary, type SalesChannel, type SalesLine } from "@/lib/api";
import { useConfirm } from "@/components/confirm";
import { ReachBar } from "@/components/PageKit";
import { Select } from "@/components/Select";
import { numeric } from "@/lib/sanitize";

const METHODS = ["CARD", "CASH", "ONLINE", "BANK"] as const;

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
  const saveRef = useRef<HTMLButtonElement>(null);

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
      let latest: DaySummary | null = null;
      for (const [channel_id, value] of draftEntries) {
        const c = channels.find((x) => x.id === channel_id);
        latest = await api.post<DaySummary>(`/sales/days/${day}/lines`, {
          channel_id,
          gross_amount: value,
          payment_method: c ? methodFor(c) : "CARD",
        });
      }
      if (latest) onSummary(latest);
      setDraft({});
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

          return (
            <div
              key={c.id}
              className={`mise-card-inset flex flex-col rounded-2xl p-3.5 transition ${
                typedNet > 0 ? "ring-1 ring-brand-400/50" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold text-fg">
                  {c.name}
                  {!c.is_active && (
                    <span className="ml-1.5 text-[10px] font-normal text-fg-faint">(retired)</span>
                  )}
                </p>
                <span className="shrink-0 rounded-full bg-glass/[0.06] px-2 py-0.5 text-[10px] text-fg-faint">
                  {pct > 0 ? `${pct}% cut` : "no cut"}
                </span>
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
                  <div className="flex items-center gap-2">
                    <input
                      value={draft[c.id] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [c.id]: numeric(e.target.value) }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draftEntries.length) saveDraft();
                      }}
                      inputMode="decimal"
                      placeholder={saved.length ? "add more" : "0.00"}
                      aria-label={`Gross takings for ${c.name}`}
                      className="mise-well min-h-[40px] w-full min-w-0 rounded-xl px-3 py-2 text-right text-sm tabular-nums outline-none"
                    />
                    {/* The shared picker, not a native <select> — every
                        dropdown in the product was unified on purpose. */}
                    <div className="w-[6.5rem] shrink-0">
                      <Select
                        value={method}
                        onChange={(v) => setMethods((m) => ({ ...m, [c.id]: v }))}
                        ariaLabel={`How ${c.name} was paid`}
                        options={METHODS.map((m) => ({ value: m, label: m.toLowerCase() }))}
                      />
                    </div>
                  </div>
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
