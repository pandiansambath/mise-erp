"use client";

// A hall of the temple: an eave with its lamps, a course of polished granite with the hall's name
// cut in it, and what stands in it. The page is laid out as ordinary HTML; each stone thing is
// declared on it (data-stone="rope", "band", "pic hall"…), and the stone is built round it. Words
// that are cut (data-cut) are drawn by the browser where the page has them, and cut there.

import { useContext, useEffect, useRef, type ReactNode } from "react";
import { KalWorld } from "./context";
import { Lamps } from "./lamps";
import type { Cut, Laid } from "./stone";
import type { CutLine, PieceName, Place, Scene, World } from "./world";

export const TA_DIGITS = "௦௧௨௩௪௫௬௭௮௯";
export const taNumber = (n: number) => String(n).replace(/\d/g, (d) => TA_DIGITS[+d]);

const FRAMES: Record<string, { piece: PieceName; margin: number }> = {
  rope: { piece: "f_rope", margin: 6 },
  bead: { piece: "f_bead", margin: 6 },
  petal: { piece: "f_petal", margin: 6 },
  plain: { piece: "f_plain", margin: 6 },
};

/** What the pictures' own material is, where it is not gold. */
export const BRONZE: [number, number, number] = [0.6, 0.38, 0.14];
const MADE: Partial<Record<PieceName, Partial<Laid>>> = {
  pic_kolam: { metal: [0.95, 0.92, 0.84], matte: 1 },
  pic_genai: { metal: [0.93, 0.9, 0.86] },
  pic_msg: { metal: [0.86, 0.36, 0.42], matte: 1 },
  pic_front: { metal: [0.1, 0.05, 0.02], emit: [1.05, 0.46, 0.13] },
  door: { metal: BRONZE },
};

/** The words of an element, each where the page has it. */
export function cutLines(el: HTMLElement, box: DOMRect): CutLine[] {
  const out: CutLine[] = [];
  const g = document.createElement("canvas").getContext("2d")! as CanvasRenderingContext2D & { letterSpacing: string };
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent ?? "";
    const cs = getComputedStyle(n.parentElement!);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const spacing = parseFloat(cs.letterSpacing) || 0;
    g.font = font;
    g.letterSpacing = `${spacing}px`;
    const m = g.measureText("Aேழ");
    const A = m.fontBoundingBoxAscent;
    const D = m.fontBoundingBoxDescent;
    for (const w of text.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, w.index);
      r.setEnd(n, w.index + w[0].length);
      const b = r.getClientRects()[0];
      if (!b) continue;
      out.push({ text: cs.textTransform === "uppercase" ? w[0].toUpperCase() : w[0], font, spacing, x: b.left - box.left, y: b.top - box.top + A + (b.height - A - D) / 2, align: "left" });
    }
  }
  return out;
}

const CUT_KEY = "pandi-dev:kal-cut";
export function cutBefore(id: string): boolean {
  try {
    return (JSON.parse(sessionStorage.getItem(CUT_KEY) ?? "[]") as string[]).includes(id);
  } catch {
    return false;
  }
}
export function rememberCut(id: string) {
  try {
    const all = new Set(JSON.parse(sessionStorage.getItem(CUT_KEY) ?? "[]") as string[]);
    all.add(id);
    sessionStorage.setItem(CUT_KEY, JSON.stringify([...all]));
  } catch {
    /* the next visit cuts it again */
  }
}

export type HallPaint = (p: Place, w: World, scene: HallScene) => void;
export type HallScene = Scene & { lamps: Lamps; awake: number; put: (l: Laid | (() => Laid | null)) => void; raw: Laid | null };

export function Hall({
  id,
  num,
  title,
  ta,
  children,
  pics,
  onTick,
  className = "",
  eave = true,
}: {
  id: string;
  num?: number;
  title?: string;
  ta?: string;
  children?: ReactNode;
  /** Its own pictures and what else is laid in it, each time the page's measures change. */
  pics?: HallPaint;
  onTick?: (t: number, dt: number, w: World, scene: HallScene) => boolean;
  className?: string;
  eave?: boolean;
}) {
  const world = useContext(KalWorld)!;
  const el = useRef<HTMLElement>(null);
  const live = useRef({ pics, onTick });
  useEffect(() => {
    live.current = { pics, onTick };
  });

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const lamps = new Lamps(14);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let due: { el: HTMLElement; id: string }[] = [];
    let origin = { x: 0, y: 0 };
    const cutEls = new Map<HTMLElement, Cut>();
    const scene: HallScene = {
      el: root,
      laid: [],
      front: [],
      cuts: [],
      rows: [lamps.row],
      lamps,
      awake: -1,
      raw: null,
      put(l) {
        const v = typeof l === "function" ? l() : l;
        if (v) scene.laid.push(v);
      },
      lay(p, w) {
        const r0 = root.getBoundingClientRect();
        origin = { x: p.x - r0.left, y: p.y - r0.top };
        const k = parseFloat(getComputedStyle(root).getPropertyValue("--kn")) || 1;
        const todo: { z: number; name: PieceName; make: (piece: Laid["piece"]) => Laid[] }[] = [];
        const add = (z: number, name: PieceName, make: (piece: Laid["piece"]) => Laid[]) => todo.push({ z, name, make });
        add(0, "wall", (piece) => [{ piece, x: p.x, y: p.y, w: p.w, h: p.h, s: k }]);
        // What it is cut from, until it is cut (once a visit).
        const outlines = new Float32Array(64);
        let no = 0;
        root.querySelectorAll<HTMLElement>("[data-stone], [data-cut], .kal-slab, .kal-leaf, .kal-btns, .kal-chips, .kal-sand, .kal-chain-links").forEach((s) => {
          if (no >= 16) return;
          const b = s.getBoundingClientRect();
          if (b.width < 2) return;
          const words = !s.dataset.stone || /^(rope|bead|petal|plain|band)/.test(s.dataset.stone);
          if (s.closest("[data-cut]") && !s.hasAttribute("data-cut")) return;
          outlines.set([b.left + origin.x, b.top + origin.y, words ? -b.width : b.width, b.height], no * 4);
          no++;
        });
        const cutAlready = cutBefore(id) || still;
        if (!cutAlready)
          add(9, "rock", (piece) => {
            const l: Laid = { piece, x: p.x, y: p.y + 40 * k, w: p.w, h: p.h - 40 * k, s: k, z: 22, raw: { at: 1e9, x: p.x + p.w / 2, y: p.y + 120 * k, outlines } };
            scene.raw = l;
            return [l];
          });
        if (!p.phone) {
          const sw = 120 * k;
          add(1, "side", (piece) => [
            { piece, x: p.x, y: p.y, w: sw, h: p.h, s: k, z: 26 },
            { piece, x: p.x + p.w - sw, y: p.y, w: sw, h: p.h, s: k, z: 26, flip: true },
          ]);
        }
        lamps.row.n = 0;
        root.querySelectorAll<HTMLElement>("[data-stone]").forEach((s) => {
          const b = s.getBoundingClientRect();
          const x = b.left + origin.x;
          const y = b.top + origin.y;
          const [kind, name] = (s.dataset.stone ?? "").split(" ");
          if (kind === "eave") {
            add(2, "eave", (piece) => [{ piece, x, y, w: b.width, h: b.height, s: b.height / 104, z: 0 }]);
            const n = p.phone ? 7 : 14;
            const step = (Math.min(b.width, 1344 * k) - (p.phone ? 60 : 130) * k) / (n - 1);
            lamps.row.n = n;
            lamps.place(x + b.width / 2 - ((n - 1) * step) / 2, y + 2 * k, step, (p.phone ? 21 : 25) * k);
          } else if (kind === "band") add(3, "band", (piece) => [{ piece, x, y, w: b.width, h: b.height, s: b.height / 72 }]);
          else if (kind === "pic") {
            const pn = name as PieceName;
            add(3, pn, (piece) => [{ piece, x, y, s: b.width / piece.map.w, ...MADE[pn] }]);
          } else if (kind === "strip") {
            const pn = name as PieceName;
            add(3, pn, (piece) => [{ piece, x, y, w: b.width, h: b.height, s: b.height / piece.map.h, ...MADE[pn] }]);
          } else if (FRAMES[kind]) {
            const f = FRAMES[kind];
            const fs = k * (p.phone ? 0.8 : 1);
            const M = f.margin * fs;
            add(3, f.piece, (piece) => [{ piece, x: x - M, y: y - M, w: b.width + 2 * M, h: b.height + 2 * M, s: fs }]);
          }
        });
        const turn = {};
        (scene as { turn?: object }).turn = turn;
        void Promise.all(todo.map((t) => w.piece(t.name))).then((got) => {
          if ((scene as { turn?: object }).turn !== turn) return;
          scene.laid = todo
            .map((t, i) => ({ z: t.z, l: t.make(got[i]) }))
            .sort((a, b) => a.z - b.z)
            .flatMap((t) => t.l);
          live.current.pics?.(p, w, scene);
          w.dirty = true;
        });
        due = [...root.querySelectorAll<HTMLElement>("[data-cut]")].map((e, i) => ({ el: e, id: `${id}-${i}` }));
        if (still) lamps.all();
      },
      tick(t, dt, w) {
        let busy = false;
        // Its words are cut as one comes near it, one at a time.
        const d = due.shift();
        if (d && w.stone) {
          const b = d.el.getBoundingClientRect();
          if (b.width > 0) {
            // (Measured now, against the page as it is now: it may have scrolled since it was laid out.)
            const page = root.closest(".kal")?.getBoundingClientRect() ?? new DOMRect();
            const box = new DOMRect(b.left - 8, b.top - 6, b.width + 16, b.height + 12);
            const c = w.letters(d.id, cutLines(d.el, box), box.left - page.left, box.top - page.top, box.width, box.height);
            if (c) {
              cutEls.set(d.el, c);
              d.el.dataset.cut = "on";
              c.wake = scene.awake >= 0 ? 1 : 0.5;
              scene.cuts = [...cutEls.values()];
            }
          }
          busy = true;
        }
        const st = w.stone!;
        const at = scene.at!;
        // It wakes as its top passes three quarters of the view.
        if (scene.awake < 0 && at.y < st.view.y + at.vh * 0.74) {
          scene.awake = t;
          if (scene.raw?.raw) {
            scene.raw.raw.at = t + 0.15;
            rememberCut(id);
          }
          lamps.wake(t, 0.5, 0.09);
        }
        if (lamps.tick(t, st.torch.x, st.torch.y)) busy = true;
        const raw = scene.raw?.raw;
        if (raw && t - raw.at < 1.4) busy = true;
        if (raw && t - raw.at > 1.5) {
          scene.laid = scene.laid.filter((l) => l !== scene.raw);
          scene.raw = null;
        }
        if (scene.awake >= 0)
          for (const c of scene.cuts)
            if (c.wake < 1) {
              c.wake = Math.min(1, c.wake + dt * 0.9);
              busy = true;
            }
        if (live.current.onTick?.(t, dt, w, scene)) busy = true;
        return busy;
      },
    };
    const off = world.add(scene);
    const mo = new MutationObserver(world.again);
    root.querySelectorAll("[data-cut]").forEach((e) => mo.observe(e, { characterData: true, childList: true, subtree: true }));
    return () => {
      mo.disconnect();
      off();
    };
  }, [world, id]);

  return (
    <section ref={el} id={`kal-${id}`} className={`kal-hall ${className}`} data-hall={id}>
      {eave && <div className="kal-eave" data-stone="eave" aria-hidden />}
      {title && (
        <div className="kal-title" data-stone="band">
          <span className="kal-num" lang="ta" data-cut aria-hidden>
            {num ? taNumber(num) : ""}
          </span>
          <h2 className="kal-cut-l" data-cut>
            {title}
          </h2>
          <span className="kal-ta" lang="ta" data-cut>
            {ta}
          </span>
        </div>
      )}
      <div className="kal-field">{children}</div>
    </section>
  );
}

/** A couplet on its lintel: Tamil cut in the stone, what it says under it. */
export function Couplet({ rows, says }: { rows: [string, string]; says: string }) {
  return (
    <figure className="kal-lintel" data-stone="bead">
      <blockquote lang="ta" data-cut>
        <span>{rows[0]}</span> <span>{rows[1]}</span>
      </blockquote>
      <figcaption>{says}</figcaption>
    </figure>
  );
}
