"use client";

// His months, a chain to a year: loose links, each cut from the one stone (S2). A link is a month;
// what happened in it is told by what the link is made of, and said when it is touched.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useData, useDev, useNow, useWord } from "../context";
import { did } from "../did";
import { LONG_MONTHS, MONTH_NAMES, MonthCard } from "../MonthChain";
import { originOf, type Origin } from "../Popup";
import type { Milestone, MilestoneKind } from "../profile";
import { KalWorld } from "./context";
import { taNumber } from "./Hall";
import type { Laid } from "./stone";
import type { Scene } from "./world";

const ORDER: MilestoneKind[] = ["recognition", "promotion", "milestone", "note"];
const KIND_WORD: Record<MilestoneKind, string> = { recognition: "kindRecognition", promotion: "kindPromotion", milestone: "kindMilestone", note: "kindNote" };
/** What a link of each kind is made of: colour, and how much of it is metal. */
const METAL: Record<MilestoneKind, [number, number, number, number]> = {
  recognition: [0.9, 0.58, 0.16, 1],
  promotion: [0.2, 0.46, 0.38, 1],
  milestone: [0.075, 0.07, 0.08, 1],
  note: [0.72, 0.32, 0.17, 1],
};
/** Of one chain's carving: its size, where its first link's middle is, from one to the next, how far it
 *  hangs (dev/art/bake_kal.py: chain12, chain6). */
const CHAIN = {
  12: { piece: "chain12" as const, w: 1180, h: 136, x0: 62, pitch: 96, y0: 36, sag: 46 },
  6: { piece: "chain6" as const, w: 361, h: 92, x0: 40.5, pitch: 56, y0: 28, sag: 20 },
};
const sagAt = (i: number, n: 12 | 6) => {
  const c = CHAIN[n];
  const u = (i - (n - 1) / 2) / ((n - 1) / 2);
  return c.y0 + c.sag * (1 - u * u);
};

type Month = { when: string; mi: number; year: number; kind: MilestoneKind | null; state: "before" | "past" | "now" | "next"; fill: number; entries: Milestone[] };

function Row({ months, n, label, ta, onOpen, onEdit }: { months: Month[]; n: 12 | 6; label: string; ta: string; onOpen: (when: string, o: Origin) => void; onEdit: (when: string, o: Origin) => void }) {
  const world = useContext(KalWorld)!;
  const el = useRef<HTMLDivElement>(null);
  const hot = useRef({ i: -1, v: 0 });
  const links = useMemo(() => {
    const out = new Float32Array(48);
    months.forEach((m, i) => {
      const at = i * 4;
      if (m.state === "next" || m.state === "before") out.set([0, 0, 0, -1], at);
      else if (m.kind) out.set(METAL[m.kind], at);
      else if (m.state === "now") out.set([m.fill, 0, 0, -0.4], at);
      else out.set([0, 0, 0, 0], at);
    });
    for (let i = months.length; i < 12; i++) out.set([0, 0, 0, -1], i * 4);
    return out;
  }, [months]);
  const now = useRef(links);
  useEffect(() => {
    now.current = links;
    world.touch();
  }, [links, world]);

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const c = CHAIN[n];
    const scene: Scene = {
      el: root,
      laid: [],
      front: [],
      cuts: [],
      rows: [],
      lay(p, w) {
        void w.piece(c.piece).then((piece) => {
          const s = p.w / c.w;
          const l: Laid = { piece, x: p.x, y: p.y, s, z: 30, chain: { x0: c.x0, pitch: c.pitch, links: now.current, hot: hot.current } };
          Object.defineProperty(l.chain, "links", { get: () => now.current });
          scene.laid = [l];
          w.dirty = true;
        });
      },
      tick(_t, dt) {
        const h = hot.current;
        const to = h.i >= 0 ? 1 : 0;
        if (Math.abs(to - h.v) < 0.01) return false;
        h.v += (to - h.v) * Math.min(1, dt * 12);
        return true;
      },
    };
    return world.add(scene);
  }, [world, n]);

  const c = CHAIN[n];
  return (
    <div className={`kal-chain kal-chain-${n}`}>
      <span className="kal-label kal-chain-y">{label}</span>
      <div ref={el} className="kal-chain-links" style={{ aspectRatio: `${c.w} / ${c.h}` }}>
        {months.map((m, i) => (
          <button
            key={m.when}
            type="button"
            className="kal-link"
            data-state={m.state}
            disabled={m.state === "before"}
            style={{ left: `${((c.x0 + i * c.pitch) / c.w) * 100}%`, top: `${(sagAt(i, n) / c.h) * 100}%`, width: `${(c.pitch / c.w) * 100}%`, height: `${((n === 12 ? 72 : 46) / c.h) * 100}%` }}
            onPointerEnter={() => {
              hot.current.i = i;
              world.touch();
            }}
            onPointerLeave={() => {
              hot.current.i = -1;
              hot.current.v = 0;
              world.touch();
            }}
            onClick={(e) => onOpen(m.when, originOf(e.currentTarget))}
            onDoubleClick={(e) => onEdit(m.when, originOf(e.currentTarget))}
            aria-label={`${LONG_MONTHS[m.mi]} ${m.year}${m.entries.length ? `: ${m.entries.map((e) => e.title).join(", ")}` : ""}`}
          >
            <span>{MONTH_NAMES[m.mi].toUpperCase()}</span>
          </button>
        ))}
      </div>
      <span className="kal-label kal-chain-y kal-chain-ta" lang="ta">
        {ta}
      </span>
    </div>
  );
}

export function Months() {
  const { CAREER_START: start } = useData();
  const { milestones, requestUnlock } = useDev();
  const w = useWord();
  const now = useNow();
  const day = now ? Math.floor(now.getTime() / 86_400_000) : 0;
  const [open, setOpen] = useState<{ when: string; origin: Origin; edit: boolean } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);

  const years = useMemo(() => {
    if (!day) return [];
    const at = new Date(day * 86_400_000 + 3_600_000 * 12);
    const sy = start.getUTCFullYear();
    const sm = start.getUTCMonth();
    const current = (at.getUTCFullYear() - sy) * 12 + at.getUTCMonth() - sm;
    const days = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
    const lastYear = Math.max(at.getUTCFullYear(), ...milestones.map((m) => Number(m.when.slice(4)) || 0));
    const out: { year: number; months: Month[] }[] = [];
    for (let year = sy; year <= lastYear; year++)
      out.push({
        year,
        months: MONTH_NAMES.map((name, mi) => {
          const when = `${name} ${year}`;
          const entries = milestones.filter((m) => m.when === when);
          const idx = (year - sy) * 12 + mi - sm;
          return { when, mi, year, entries, kind: ORDER.find((k) => entries.some((e) => e.kind === k)) ?? null, state: idx < 0 ? "before" : idx > current ? "next" : idx === current ? "now" : "past", fill: at.getUTCDate() / days };
        }),
      });
    return out;
  }, [day, start, milestones]);

  const onOpen = (when: string, origin: Origin) => {
    did("months");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => setOpen({ when, origin, edit: false }), 230);
  };
  const onEdit = async (when: string, origin: Origin) => {
    if (pending.current) clearTimeout(pending.current);
    if (await requestUnlock()) setOpen({ when, origin, edit: true });
  };
  let total = 0;
  let done = 0;
  if (day) {
    const at = new Date(day * 86_400_000);
    total = (at.getUTCFullYear() - start.getUTCFullYear()) * 12 + at.getUTCMonth() - start.getUTCMonth() + 1;
    done = Math.floor((total - (at.getUTCDate() >= start.getUTCDate() ? 0 : 1)) / 12);
  }

  return (
    <div className="kal-months">
      {years.map(({ year, months }) => (
        <div key={year}>
          <div className="kal-wide">
            <Row months={months} n={12} label={String(year)} ta={taNumber(year)} onOpen={onOpen} onEdit={(a, o) => void onEdit(a, o)} />
          </div>
          <div className="kal-narrow">
            <Row months={months.slice(0, 6)} n={6} label={String(year)} ta="" onOpen={onOpen} onEdit={(a, o) => void onEdit(a, o)} />
            <Row months={months.slice(6)} n={6} label="" ta={taNumber(year)} onOpen={onOpen} onEdit={(a, o) => void onEdit(a, o)} />
          </div>
        </div>
      ))}
      <p className="kal-legend">
        <span className="kal-label">
          {total || " "} {w("chainBlocks")} · {done + 1} {w("chainYears")}
        </span>
        {ORDER.map((k) => (
          <span key={k} className="kal-label" data-kind={k}>
            <i aria-hidden /> {w(KIND_WORD[k])}
          </span>
        ))}
      </p>
      {open && now && (
        <MonthCard when={open.when} origin={open.origin} now={now} start={start} entries={milestones.filter((m) => m.when === open.when)} edit={open.edit} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
