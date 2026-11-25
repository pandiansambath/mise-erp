"use client";

// The quiet lines (§107.4).
//
//   "it's time for … guidance (don't reveal PS and [the] portrait hidden button)… we need [to]
//    guide [the] user: like scroll to see my skills and experience… touch [the] galaxy to burst…
//    touch [the] skeleton to burst… touch 17th rank…" (25 Nov)
//
// One voice. There is one line, never two; it speaks when a visitor is still, about something
// that is in front of them and can be touched now; a thread of light runs from the words to the
// thing. It goes the moment the thing is done (did.ts), or one scrolls on, or after some seconds;
// it says a thing twice at most in a visit. Every word is his (the Template); an empty one is
// never said. It is not read to a screen reader (the things themselves have names), and it takes
// no touch. Nothing of it lives in a card: cards are painted on the sheets they wind into.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { word } from "./copy";
import { useDev } from "./context";
import { did, DID_EVENT, hasDone, type Deed } from "./did";
import { canScatter } from "./scatter";
import { covered } from "./stage";

/** Where the thing is (screen px): the thread runs from the words to this point. */
type Spot = { x: number; y: number; from: "left" | "right" | "above" | "below"; line: number; wrap?: boolean; shade?: boolean };
type Hint = { id: Deed; key: string; late?: boolean; moves?: boolean; find: (wide: boolean) => Spot | null };

const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
const inView = (y: number, margin = 70) => y > margin && y < window.innerHeight - margin * 0.4;

/** The card that is being read, and the free ground over or under it. */
function reading(): { el: HTMLElement; r: DOMRect } | null {
  const mid = window.innerHeight / 2;
  for (const el of document.querySelectorAll<HTMLElement>(".dev-reborn[data-link]")) {
    if (el.dataset.rolled !== undefined) continue;
    const r = el.getBoundingClientRect();
    if (r.top < mid && r.bottom > mid) return { el, r };
  }
  return null;
}

const HINTS: Hint[] = [
  {
    id: "scroll",
    key: "hintScroll",
    find: (wide) => {
      if (window.scrollY > 24) return null;
      const r = wide ? box('[data-link="first"]') : null;
      return { x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: window.innerHeight - (wide ? 8 : 12), from: "above", line: 26, shade: !wide };
    },
  },
  {
    id: "galaxy",
    key: "hintGalaxy",
    moves: true,
    find: (wide) => {
      const r = box("[data-galaxy-heart]");
      if (!r) return null;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (!inView(y, 60)) return null;
      return wide ? { x: x - 108, y, from: "left", line: 36 } : { x: x + 66, y, from: "right", line: 18, wrap: true };
    },
  },
  {
    id: "months",
    key: "hintMonths",
    find: (wide) => {
      const c = box('[data-link="first"]');
      const b = [...document.querySelectorAll<HTMLElement>("[data-block][data-lit]")].pop()?.getBoundingClientRect();
      if (!c || !b || !inView(c.bottom + 24, 40) || b.top < 60) return null;
      return { x: wide ? c.left + 26 : Math.min(window.innerWidth - 150, window.innerWidth / 2 + 70), y: c.bottom + 22, from: "right", line: wide ? 22 : 12 };
    },
  },
  {
    id: "bones",
    key: "hintBones",
    moves: true,
    find: (wide) => {
      if (window.scrollY < window.innerHeight * 0.75) return null;
      const s = box("[data-spine]");
      const c = reading();
      if (!s || !c || s.bottom < window.innerHeight) return null;
      const x = s.left + s.width / 2;
      if (wide) return { x: x - 60, y: window.innerHeight - 34, from: "left", line: 34 };
      const y = c.r.bottom + 46;
      return y < window.innerHeight - 40 ? { x: x + 66, y, from: "right", line: 14, wrap: true } : null;
    },
  },
  {
    id: "ring",
    key: "hintRing",
    find: () => {
      const r = box("[data-ring]");
      return r && inView(r.top + 30, 40) && r.top + r.height * 0.6 < window.innerHeight ? { x: r.left + r.width / 2, y: r.top + 34, from: "above", line: 22 } : null;
    },
  },
  {
    id: "orbit",
    key: "hintOrbit",
    late: true,
    find: () => {
      const r = box("[data-orbit]");
      return r && inView(r.top, 60) ? { x: r.left + r.width / 2, y: r.top + 14, from: "above", line: 16 } : null;
    },
  },
  {
    id: "hand",
    key: "hintHand",
    late: true,
    moves: true,
    find: (wide) => {
      if (!canScatter()) return null;
      const r = box("[data-orbit]");
      return r && inView(r.bottom, 60) ? { x: r.left + r.width / 2, y: wide ? window.innerHeight - 22 : r.bottom + 30, from: "above", line: 14 } : null;
    },
  },
  {
    id: "resume",
    key: "hintResume",
    late: true,
    find: () => {
      const r = box("[data-resume-cover]");
      const c = reading();
      return r && c && c.r.top < r.top && c.r.bottom > r.bottom && c.r.bottom < window.innerHeight - 60 ? { x: r.left + r.width / 2, y: c.r.bottom + 8, from: "below", line: 18 } : null;
    },
  },
  {
    id: "chips",
    key: "hintChips",
    late: true,
    find: () => {
      const c = reading();
      const chips = c?.el.querySelectorAll<HTMLElement>(".dev-chip a");
      const last = chips?.[chips.length - 1]?.getBoundingClientRect();
      return c && last && c.r.bottom < window.innerHeight - 60 ? { x: last.left + last.width / 2, y: c.r.bottom + 8, from: "below", line: 14 } : null;
    },
  },
];

type Shown = { hint: Hint; spot: Spot; text: string; wide: boolean; out: "" | "done" | "gone"; n: number };

export function Guide({ entered }: { entered: boolean }) {
  const { copy } = useDev();
  const [shown, setShown] = useState<Shown | null>(null);
  const now = useRef<Shown | null>(null);

  useEffect(() => {
    if (!entered) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = window.matchMedia("(min-width: 1024px)");
    const told = new Map<string, number>();
    let openAt = 0;
    let moved = performance.now();
    let quietSince = performance.now();
    let spokeAt = 0;
    let until = 0;
    let y0 = 0;
    let n = 0;
    let clear = 0;
    const put = (s: Shown | null) => {
      now.current = s;
      setShown(s);
    };
    const leave = (how: "done" | "gone") => {
      const s = now.current;
      if (!s || s.out) return;
      put({ ...s, out: how });
      spokeAt = performance.now();
      window.clearTimeout(clear);
      clear = window.setTimeout(() => put(null), how === "done" ? 420 : 220);
    };
    const look = () => {
      const t = performance.now();
      if (document.hidden) return;
      if (covered()) {
        openAt = 0;
        return;
      }
      openAt ||= t;
      const s = now.current;
      if (s) {
        if (!s.out && t > until) leave("gone");
        return;
      }
      const first = window.scrollY < 24;
      if (t - openAt < 6200 || t - moved < 1000 || t - spokeAt < (first ? 1500 : 5000)) return;
      if (document.querySelector('[role="dialog"]') || document.querySelector(".dev-root[data-shatter]")) return;
      for (const late of [false, true]) {
        if (late && t - quietSince < 9000) return;
        for (const h of HINTS) {
          if (!!h.late !== late || hasDone(h.id) || (told.get(h.id) ?? 0) >= 2 || (still && h.moves)) continue;
          const said = word(copy, h.key).trim();
          if (!said) continue;
          const spot = h.find(wide.matches);
          if (!spot) continue;
          const [a, b] = said.split("·").map((x) => x.trim());
          told.set(h.id, (told.get(h.id) ?? 0) + 1);
          until = t + 7600;
          y0 = window.scrollY;
          put({ hint: h, spot, text: wide.matches && b ? `${a} · ${b}` : a, wide: wide.matches, out: "", n: ++n });
          return;
        }
      }
    };
    const onScroll = () => {
      moved = quietSince = performance.now();
      if (window.scrollY > 60) did("scroll");
      if (now.current && Math.abs(window.scrollY - y0) > 24) leave("gone");
    };
    const onPress = () => {
      moved = performance.now();
    };
    const onDid = (e: Event) => {
      if ((e as CustomEvent<Deed>).detail === now.current?.hint.id) leave("done");
    };
    const onResize = () => leave("gone");
    const id = window.setInterval(look, 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onPress, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener(DID_EVENT, onDid);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(clear);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onPress);
      window.removeEventListener("resize", onResize);
      window.removeEventListener(DID_EVENT, onDid);
    };
  }, [entered, copy]);

  if (!shown) return null;
  const { spot, text, out } = shown;
  const [head, ...rest] = text.split(" ");
  const place: CSSProperties = { ["--line" as string]: `${spot.line}px` };
  if (spot.from === "left") Object.assign(place, { right: `calc(100vw - ${Math.round(spot.x)}px)`, top: Math.round(spot.y), maxWidth: Math.round(spot.x - 12) });
  else if (spot.from === "right") Object.assign(place, { left: Math.round(spot.x), top: Math.round(spot.y), maxWidth: Math.round(window.innerWidth - spot.x - 10) });
  else if (spot.from === "above") Object.assign(place, { left: Math.round(spot.x), bottom: Math.round(window.innerHeight - spot.y) });
  else Object.assign(place, { left: Math.round(spot.x), top: Math.round(spot.y) });
  return (
    <>
      {spot.shade && <span aria-hidden className={`dev-hint-shade ${out ? "is-out" : ""}`} />}
      <p key={shown.n} aria-hidden data-hint={shown.hint.id} data-from={spot.from} className={`dev-hint ${spot.wrap ? "is-wrap" : ""} ${out ? `is-${out}` : ""}`} style={place}>
        <span className="dev-hint-words">
          <b>{head}</b> {rest.join(" ")}
        </span>
        <i className="dev-hint-line" />
        <i className="dev-hint-dot" />
      </p>
    </>
  );
}
