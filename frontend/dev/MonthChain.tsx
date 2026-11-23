"use client";

// Time in the chain, drawn as a chain: one block per month since he started.
//
//   "show the details when i click… even in mobile view… i need cursor smooth
//    animation whenever i place cursor or touch that block like it need to
//    grow and shrink… one at a time"
//   "after 1 month 2027 will come… a new line of blocks should come…
//    configurable… i can click any block and add recognition or promotion"
//
// · Rows come from the clock: the year turns, a row appears.
// · Under the pointer (or a finger) the blocks swell like a dock: each block's
//   size follows a smooth falloff from the pointer, eased every frame, so a
//   fast sweep reads as a wave passing through them, never a jump.
// · One click opens the month in a card that grows out of the block —
//   details only.
// · A DOUBLE click (double tap) opens it in edit mode, behind his password:
//   "accidental click can show the input field… if I double click any block
//   then only it needs to come in edit mode". Entries are saved to the server
//   and every view of the milestones updates at once.

import { useEffect, useMemo, useRef, useState } from "react";
import { useDev, useWord } from "./context";
import { IconLock, IconUnlock } from "./icons";
import { Popup, originOf, usePopupClose, type Origin } from "./Popup";
import { KIND_META, monthIndex, type Milestone, type MilestoneKind } from "./profile";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86_400_000;
const PRIORITY: MilestoneKind[] = ["recognition", "promotion", "milestone", "note"];

function addYears(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
}

function blockStyle(kind: MilestoneKind | null, state: "past" | "now" | "future") {
  if (kind === "recognition")
    return { cls: "border-[var(--d-gold)]/70 text-[#3a2410] shadow-[0_0_12px_color-mix(in_srgb,var(--d-gold)_45%,transparent)]", bg: "linear-gradient(135deg, #ffe2a3, var(--d-gold))" };
  if (kind === "promotion")
    return { cls: "border-[var(--d-b2)]/80 text-[var(--d-on)] shadow-[0_0_12px_color-mix(in_srgb,var(--d-b)_50%,transparent)]", bg: "linear-gradient(135deg, var(--d-b2), var(--d-b))" };
  if (kind === "milestone")
    return { cls: "border-[var(--d-c)]/80 text-[var(--d-on)] shadow-[0_0_12px_color-mix(in_srgb,var(--d-c)_45%,transparent)]", bg: "linear-gradient(135deg, color-mix(in srgb, var(--d-c) 70%, white), var(--d-c))" };
  if (kind === "note")
    return { cls: "border-[var(--d-a2)]/70 text-[var(--d-on)]", bg: "linear-gradient(135deg, var(--d-a2), var(--d-a))" };
  if (state === "future") return { cls: "border-[var(--d-line)]", bg: "transparent" };
  if (state === "now") return { cls: "border-[var(--d-b)]/60", bg: "transparent" };
  return { cls: "border-[var(--d-b)]/25", bg: "linear-gradient(135deg, color-mix(in srgb, var(--d-b) 42%, transparent), color-mix(in srgb, var(--d-b) 14%, transparent))" };
}

/** What the Template calls each kind of block. */
const KIND_WORD: Record<MilestoneKind, string> = { recognition: "kindRecognition", promotion: "kindPromotion", milestone: "kindMilestone", note: "kindNote" };

export function MonthChain({ start, now, play }: { start: Date; now: Date; play: boolean }) {
  const w = useWord();
  const { milestones, unlocked, requestUnlock } = useDev();
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ when: string; origin: Origin; edit: boolean } | null>(null);
  // A single click waits a beat in case it is the first half of a double.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBlockClick = (when: string, el: HTMLElement) => {
    if (pending.current) clearTimeout(pending.current);
    const origin = originOf(el);
    pending.current = setTimeout(() => {
      pending.current = null;
      setOpen({ when, origin, edit: false });
    }, 230);
  };
  const onBlockDouble = async (when: string, el: HTMLElement) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    const origin = originOf(el);
    if (await requestUnlock()) setOpen({ when, origin, edit: true });
  };
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  const byMonth = useMemo(() => {
    const m = new Map<string, Milestone[]>();
    for (const e of milestones) m.set(e.when, [...(m.get(e.when) ?? []), e]);
    return m;
  }, [milestones]);

  const sy = start.getUTCFullYear();
  const sm = start.getUTCMonth();
  const current = (now.getUTCFullYear() - sy) * 12 + now.getUTCMonth() - sm;
  const lastYear = Math.max(now.getUTCFullYear(), ...milestones.map((m) => Number(m.when.slice(4))));
  const years: number[] = [];
  for (let y = sy; y <= lastYear; y++) years.push(y);

  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const filled = (now.getUTCDate() - 1 + now.getUTCHours() / 24) / daysInMonth;
  let done = 0;
  while (addYears(start, done + 1) <= now) done += 1;
  // A running countdown, not a number that changes overnight: "that number
  // needs to be a running number… count daily and change accordingly".
  const left = Math.max(0, addYears(start, done + 1).getTime() - now.getTime());
  const dd = Math.floor(left / DAY);
  const hh = Math.floor((left % DAY) / 3_600_000);
  const mm = Math.floor((left % 3_600_000) / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  // The dock: smooth swell under the pointer, eased each frame.
  useEffect(() => {
    const el = grid.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [...el.querySelectorAll<HTMLElement>("[data-block]")];
    const scale = nodes.map(() => 1);
    let centers: { x: number; y: number }[] = [];
    let cell = 30;
    let px = -1e5;
    let py = -1e5;
    let raf = 0;
    const measure = () => {
      const g = el.getBoundingClientRect();
      centers = nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2 };
      });
      cell = nodes[0]?.getBoundingClientRect().width || 30;
    };
    const frame = () => {
      let moving = false;
      const sigma = cell * 1.05;
      for (let i = 0; i < nodes.length; i++) {
        const c = centers[i];
        const d2 = c ? (c.x - px) ** 2 + (c.y - py) ** 2 : 1e9;
        const target = 1 + 0.62 * Math.exp(-d2 / (2 * sigma * sigma));
        scale[i] += (target - scale[i]) * 0.2;
        if (Math.abs(target - scale[i]) > 0.002) moving = true;
        nodes[i].style.transform = `scale(${scale[i].toFixed(3)})`;
        nodes[i].style.zIndex = scale[i] > 1.02 ? String(Math.round(scale[i] * 10)) : "";
      }
      raf = moving ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      const g = el.getBoundingClientRect();
      px = e.clientX - g.left;
      py = e.clientY - g.top;
      wake();
    };
    const onEnter = (e: PointerEvent) => {
      measure();
      onMove(e);
    };
    const onLeave = () => {
      px = py = -1e5;
      wake();
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointercancel", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
    };
  }, [years.length]);

  return (
    <div className="mt-4">
      <div ref={grid} className="touch-pan-y space-y-1.5">
        {years.map((y) => (
          <div key={y} className="flex items-center gap-2">
            <span className="w-8 shrink-0 font-mono text-[9px] tabular-nums tracking-[0.1em] text-[var(--d-ink6)]">{y}</span>
            <div className="relative grid min-w-0 flex-1 grid-cols-12 gap-[3px] sm:gap-1">
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--d-line)]" />
              {MONTHS.map((name, mi) => {
                const when = `${name} ${y}`;
                const idx = (y - sy) * 12 + mi - sm;
                const entries = byMonth.get(when) ?? [];
                const kind = PRIORITY.find((k) => entries.some((e) => e.kind === k)) ?? null;
                const state = idx > current ? "future" : idx === current ? "now" : "past";
                const before = idx < 0;
                const look = blockStyle(kind, state);
                return (
                  <span
                    key={name}
                    className="relative block"
                    style={play ? { animation: `devBlockOn .45s ${Math.max(0, idx) * 30 + 250}ms cubic-bezier(.2,.9,.3,1.2) both` } : { opacity: 0 }}
                  >
                    <button
                      type="button"
                      data-block
                      disabled={before}
                      onClick={(e) => onBlockClick(when, e.currentTarget)}
                      onDoubleClick={(e) => void onBlockDouble(when, e.currentTarget)}
                      aria-label={`${LONG[mi]} ${y}${entries.length ? `: ${entries.map((e) => e.title).join(", ")}` : ""}`}
                      className={`relative grid aspect-square w-full touch-manipulation place-items-center overflow-hidden rounded-[3px] border text-[8px] font-bold leading-none outline-none transition-[border-color] focus-visible:ring-2 focus-visible:ring-[var(--d-b)] disabled:invisible sm:rounded ${look.cls}`}
                      style={{ background: look.bg, transformOrigin: "center" }}
                    >
                      {state === "now" && !kind && (
                        <span
                          aria-hidden
                          className="absolute inset-x-0 bottom-0"
                          style={{
                            height: `${Math.round(filled * 100)}%`,
                            background: "linear-gradient(to top, color-mix(in srgb, var(--d-b) 70%, transparent), color-mix(in srgb, var(--d-b) 25%, transparent))",
                            animation: "devFill 2.4s ease-in-out infinite",
                          }}
                        />
                      )}
                      {kind && <span className="relative">{KIND_META[kind].glyph}</span>}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 font-mono text-[9px] tracking-[0.14em] text-[var(--d-ink6)]">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {PRIORITY.map((k) => (
            <span key={k} className="inline-flex items-center gap-1" style={{ color: `var(--d-${KIND_META[k].role})` }}>
              {KIND_META[k].glyph} {w(KIND_WORD[k]).toUpperCase()}
            </span>
          ))}
          <button
            type="button"
            onClick={() => void requestUnlock()}
            aria-label={unlocked ? "Editing unlocked" : "Unlock editing"}
            title={unlocked ? "Editing unlocked — double-click any month" : "Owner: unlock editing"}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--d-ink6)] transition hover:text-[var(--d-ink2)]"
          >
            {unlocked ? <IconUnlock width={12} height={12} /> : <IconLock width={12} height={12} />}
          </button>
        </span>
        <span className="text-[var(--d-ink4)]">
          {current + 1} {w("chainBlocks")} · {done + 1} {w("chainYears")}{" "}
          <span className="tabular-nums text-[var(--d-ink2)]">
            {dd}D {pad(hh)}:{pad(mm)}:{pad(ss)}
          </span>
        </span>
      </div>

      {open && (
        <MonthCard
          when={open.when}
          origin={open.origin}
          now={now}
          start={start}
          entries={byMonth.get(open.when) ?? []}
          edit={open.edit}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function MonthCard({
  when,
  origin,
  now,
  start,
  entries,
  edit,
  onClose,
}: {
  when: string;
  origin: Origin;
  now: Date;
  start: Date;
  entries: Milestone[];
  /** Opened with a double click: the remove buttons and the add form show. */
  edit: boolean;
  onClose: () => void;
}) {
  const [m, y] = when.split(" ");
  const mi = MONTHS.indexOf(m);
  const year = Number(y);
  const first = Date.UTC(year, mi, 1);
  const last = Date.UTC(year, mi + 1, 0);
  const days = new Date(last).getUTCDate();
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const idx = monthIndex(when);
  const state = idx > nowIdx ? "future" : idx === nowIdx ? "now" : "past";
  const block = (year - start.getUTCFullYear()) * 12 + mi - start.getUTCMonth() + 1;
  const dayOfChain = Math.floor((first - start.getTime()) / DAY) + 1;

  return (
    <Popup label={`${LONG[mi]} ${year}`} origin={origin} onClose={onClose}>
      <p className="font-mono text-[10px] tracking-[0.3em] text-[var(--d-a)]">BLOCK #{block}</p>
      <h2 className="mt-1.5 font-display text-3xl font-semibold tracking-tight">
        {LONG[mi]} <span className="text-[var(--d-ink4)]">{year}</span>
      </h2>
      <p className="mt-1 font-mono text-[11px] tracking-[0.08em] text-[var(--d-ink5)]">
        {state === "future"
          ? `NOT MINED YET · ${Math.ceil((first - now.getTime()) / DAY)} DAYS AWAY`
          : state === "now"
            ? `BEING MINED · DAY ${now.getUTCDate()} OF ${days}`
            : `${days} DAYS · CHAIN DAYS ${dayOfChain}–${dayOfChain + days - 1}`}
      </p>

      <div className="mt-5 space-y-3">
        {entries.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[var(--d-line2)] px-4 py-5 text-center text-[13px] text-[var(--d-ink4)]">
            {state === "future" ? "This month hasn’t happened yet." : "A steady month in the chain. Nothing recorded."}
          </p>
        )}
        {entries.map((e, i) => (
          <Entry key={`${e.title}-${i}`} entry={e} index={i} edit={edit} />
        ))}
      </div>

      {edit && <Editor when={when} entries={entries} />}
    </Popup>
  );
}

function Entry({ entry, index, edit }: { entry: Milestone; index: number; edit: boolean }) {
  const meta = KIND_META[entry.kind];
  const color = `var(--d-${meta.role})`;
  const { unlocked, milestones, saveMilestones } = useDev();
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 12%, transparent), transparent 70%)`,
        animation: `devFadeUp .5s ${0.15 + index * 0.08}s ease-out both`,
      }}
    >
      <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em]" style={{ color }}>
        <span className="text-[13px]">{meta.glyph}</span> {meta.label.toUpperCase()}
      </p>
      <p className={`mt-1.5 text-[16px] font-semibold leading-snug ${entry.kind === "recognition" ? "dev-gold" : ""}`}>{entry.title}</p>
      {entry.promoted && (
        <p className="mt-1.5 inline-block rounded-full border border-[var(--d-b)]/35 px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] text-[var(--d-b2)]">
          PROMOTED · {entry.promoted.toUpperCase()}
        </p>
      )}
      {entry.note && <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--d-ink3)]">{entry.note}</p>}
      {edit && unlocked && (
        <button
          type="button"
          onClick={() => void saveMilestones(milestones.filter((m) => m !== entry))}
          className="absolute right-3 top-3 rounded-full border border-[var(--d-line2)] px-2 py-0.5 font-mono text-[10px] text-[var(--d-ink4)] transition hover:border-[#f0736a] hover:text-[#f0736a]"
        >
          REMOVE
        </button>
      )}
    </div>
  );
}

function Editor({ when, entries }: { when: string; entries: Milestone[] }) {
  const { unlocked, milestones, saveMilestones } = useDev();
  const close = usePopupClose();
  const [kind, setKind] = useState<MilestoneKind>(entries.length ? "note" : "recognition");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [promoted, setPromoted] = useState("");
  const [busy, setBusy] = useState(false);

  if (!unlocked) return null;

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const entry: Milestone = { when, kind, title: title.trim(), note: note.trim(), promoted: kind === "promotion" && promoted.trim() ? promoted.trim() : undefined };
    const ok = await saveMilestones([...milestones, entry]);
    setBusy(false);
    if (ok) {
      setTitle("");
      setNote("");
      setPromoted("");
      close?.();
    }
  };

  const field =
    "w-full rounded-xl border border-[var(--d-line2)] bg-[var(--d-shade)] px-3.5 py-2.5 text-[13.5px] text-[var(--d-ink)] outline-none transition placeholder:text-[var(--d-ink6)] focus:border-[var(--d-b)]";
  return (
    <div className="mt-6 border-t border-[var(--d-line)] pt-5">
      <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-b)]">ADD TO {when.toUpperCase()}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRIORITY.map((k) => {
          const meta = KIND_META[k];
          const on = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="rounded-full border px-3 py-1 text-[12px] font-semibold transition"
              style={{
                borderColor: `var(--d-${meta.role})`,
                background: on ? `var(--d-${meta.role})` : "transparent",
                color: on ? "var(--d-on)" : `var(--d-${meta.role})`,
              }}
            >
              {meta.glyph} {meta.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 space-y-2">
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Spot Award" maxLength={80} />
        {kind === "promotion" && (
          <input className={field} value={promoted} onChange={(e) => setPromoted(e.target.value)} placeholder="Grade change, e.g. Innovator → …" maxLength={60} />
        )}
        <textarea className={`${field} min-h-[70px] resize-y`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A line about it (optional)" maxLength={240} />
      </div>
      <button
        type="button"
        disabled={!title.trim() || busy}
        onClick={() => void add()}
        className="mt-3 w-full rounded-xl py-2.5 text-[13.5px] font-semibold text-[var(--d-on)] transition enabled:hover:brightness-110 disabled:opacity-45"
        style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}
      >
        {busy ? "Saving…" : "Save to the chain"}
      </button>
    </div>
  );
}
