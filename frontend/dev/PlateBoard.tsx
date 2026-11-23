"use client";

// The departure board (§102.2): split flaps on one 2D canvas. Every flap turns
// through the alphabet, as a real one does, until it reaches its letter; the
// clock's flaps turn every second; point at the board (or tap it) and a ripple
// of flaps goes round and comes back. It draws only while something turns.

import { useEffect, useRef } from "react";
import { box as roundBox, mixc, readPal, rgba, WHITE, type Pal } from "./plateKit";
import { THEME_EVENT } from "./theme";

const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:·.,&’'-/+";
const TURN = 0.062;

type Cell = { x: number; y: number; w: number; h: number; kind: number; row: number; col: number; cur: string; to: string; from: string; p: number; wait: number; steps: string[]; s: number };

function steps(from: string, to: string, n: number): string[] {
  if (from === to) return [];
  const i = Math.max(0, DRUM.indexOf(from));
  const j = DRUM.indexOf(to);
  if (j < 0) return [to];
  const out: string[] = [];
  for (let k = i; out.length < 60; ) {
    k = (k + 1) % DRUM.length;
    out.push(DRUM[k]);
    if (k === j) break;
  }
  // A long way round is shortened: the last few turns are what is seen.
  return out.length > n ? out.slice(out.length - n) : out;
}

export function PlateBoard({ rows, entered }: { rows: { text: string; kind: "name" | "line" | "small" }[]; entered: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const data = useRef(rows);
  const poke = useRef<() => void>(() => {});
  useEffect(() => {
    data.current = rows;
    poke.current();
  }, [rows]);

  useEffect(() => {
    const el = box.current;
    const canvas = cv.current;
    const g = canvas?.getContext("2d");
    if (!el || !canvas || !g || !entered) return;
    const root = el.closest<HTMLElement>(".dev-root") ?? document.querySelector<HTMLElement>(".dev-root") ?? document.documentElement;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mono = `${getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono") || "ui-monospace"}, ui-monospace, monospace`;
    let pal: Pal = readPal(root);
    let W = 0;
    let H = 0;
    let dpr = 1;
    let cells: Cell[] = [];
    let shape = "";
    let raf = 0;
    let last = performance.now();
    let visible = true;
    const faces = new Map<string, HTMLCanvasElement>();

    /** A flap with its letter, drawn once per size and letter. */
    const face = (ch: string, w: number, h: number, kind: number) => {
      const key = `${ch}|${w.toFixed(1)}|${h.toFixed(1)}|${kind}`;
      const had = faces.get(key);
      if (had) return had;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      const f = c.getContext("2d")!;
      f.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = "#2a303b";
      const bot = "#191e27";
      const gr = f.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, top);
      gr.addColorStop(0.49, "#222833");
      gr.addColorStop(0.5, "#262c37");
      gr.addColorStop(1, bot);
      f.fillStyle = gr;
      roundBox(f, 0.5, 0.5, w - 1, h - 1, Math.min(4, w * 0.16));
      f.fill();
      f.fillStyle = "rgba(255,255,255,.07)";
      f.fillRect(1.5, 1, w - 3, 1);
      if (ch !== " ") {
        f.font = `${kind === 0 ? 600 : 500} ${(kind === 0 ? Math.min(h * 0.72, w * 1.25) : Math.min(h * 0.7, w * 1.35)).toFixed(1)}px ${mono}`;
        f.textAlign = "center";
        f.textBaseline = "middle";
        const lift = pal.light ? 0.62 : 0.4;
        f.fillStyle = kind === 0 ? rgba(mixc(pal.gold, WHITE, lift)) : kind === 1 ? "#eef2f7" : rgba(mixc(pal.b2, WHITE, lift));
        f.fillText(ch, w / 2, h / 2 + h * 0.035);
      }
      // The split, and the hinge's shadow under it.
      f.fillStyle = "rgba(0,0,0,.75)";
      f.fillRect(0, h / 2 - 0.5, w, 1);
      f.fillStyle = "rgba(255,255,255,.05)";
      f.fillRect(0, h / 2 + 0.5, w, 0.7);
      f.fillStyle = "rgba(0,0,0,.6)";
      f.fillRect(0, h / 2 - 2, 1.4, 4);
      f.fillRect(w - 1.4, h / 2 - 2, 1.4, 4);
      faces.set(key, c);
      return c;
    };

    /** Rows to lines of cells: a row too long for the board breaks at a space. */
    const lay = () => {
      W = el.clientWidth;
      if (W < 40) return;
      const phone = W < 520;
      dpr = Math.min(window.devicePixelRatio || 1, phone ? 2.25 : 2);
      const inset = phone ? 8 : 12;
      const room = W - inset * 2;
      const lines: { text: string; kind: number; w: number; h: number; gap: number }[] = [];
      for (const r of data.current) {
        const kind = r.kind === "name" ? 0 : r.kind === "line" ? 1 : 2;
        const want = kind === 0 ? 42 : kind === 1 ? 19 : 16.5;
        const min = kind === 0 ? 17 : phone ? 11.4 : 13;
        const gap = kind === 0 ? (phone ? 2 : 3) : 1.6;
        const text = r.text.toUpperCase();
        const fit = (n: number) => Math.min(want, (room + gap) / n - gap);
        let parts = [text];
        if (fit(text.length) < min) {
          const cols = Math.max(4, Math.floor((room + gap) / (min + gap)));
          parts = [];
          let cur = "";
          for (const word of text.split(" ")) {
            if (cur && cur.length + 1 + word.length > cols) {
              parts.push(cur);
              cur = word;
            } else cur = cur ? `${cur} ${word}` : word;
          }
          if (cur) parts.push(cur);
        }
        const w = Math.max(6, Math.min(...parts.map((p) => fit(p.length))));
        for (const p of parts) lines.push({ text: p, kind, w, h: Math.round(w * (kind === 0 ? 1.36 : 1.5)), gap });
      }
      const key = lines.map((l) => `${l.text.length}:${l.kind}:${l.w.toFixed(1)}`).join("|") + W;
      let y = inset;
      const next: Cell[] = [];
      lines.forEach((l, row) => {
        const total = l.text.length * (l.w + l.gap) - l.gap;
        const x0 = phone ? (W - total) / 2 : inset;
        [...l.text].forEach((ch, col) => {
          next.push({ x: x0 + col * (l.w + l.gap), y, w: l.w, h: l.h, kind: l.kind, row, col, cur: " ", to: ch, from: " ", p: 1, wait: 0, steps: [], s: 1 });
        });
        y += l.h + (l.kind === 0 ? (phone ? 6 : 8) : 5);
      });
      H = y - 5 + inset;
      if (key === shape) {
        // The same board: only what changed turns.
        next.forEach((c, i) => {
          const o = cells[i];
          if (o.to === c.to) return;
          o.to = c.to;
          o.steps = still ? [] : steps(o.steps.length ? o.steps[o.steps.length - 1] : o.cur, c.to, 5);
          if (still) o.cur = c.to;
        });
        return;
      }
      const fresh = shape === "";
      shape = key;
      faces.clear();
      cells = next;
      for (const c of cells) {
        if (still || !fresh) c.cur = c.to;
        else {
          c.steps = steps(" ", c.to, 7 + Math.floor(Math.random() * 6));
          c.wait = 0.15 + c.row * 0.12 + c.col * 0.035 + Math.random() * 0.08;
        }
      }
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = `${H}px`;
      paint();
    };

    const paint = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const order = cells.some((c) => c.s > 1.002) ? [...cells].sort((p, q) => p.s - q.s) : cells;
      for (const c of order) {
        // (Standing out, a flap is drawn at its own size: its letter stays sharp.)
        const out = c.s > 1.002;
        const k = out ? 1.26 : 1;
        const a = face(c.cur, c.w * k, c.h * k, c.kind);
        if (out) {
          const cx = c.x + c.w / 2;
          const cy = c.y + c.h / 2;
          g.setTransform(dpr * c.s, 0, 0, dpr * c.s, dpr * cx * (1 - c.s), dpr * cy * (1 - c.s));
          g.shadowColor = "rgba(0,0,0,.6)";
          g.shadowBlur = 80 * (c.s - 1) * dpr;
          g.drawImage(a, c.x, c.y, c.w, c.h);
          g.shadowColor = "transparent";
          g.shadowBlur = 0;
        } else {
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        if (c.p >= 1) {
          if (!out) g.drawImage(a, c.x, c.y, c.w, c.h);
          continue;
        }
        const b = face(c.from, c.w * k, c.h * k, c.kind);
        const half = c.h / 2;
        const sh = a.height / 2;
        // The next letter's top is behind; the old one's bottom still there.
        g.drawImage(a, 0, 0, a.width, sh, c.x, c.y, c.w, half);
        g.drawImage(b, 0, sh, b.width, sh, c.x, c.y + half, c.w, half);
        if (c.p < 0.5) {
          const s = Math.cos(c.p * Math.PI);
          g.drawImage(b, 0, 0, b.width, sh, c.x, c.y + half * (1 - s), c.w, half * s);
          g.fillStyle = `rgba(0,0,0,${(0.5 * (1 - s)).toFixed(3)})`;
          g.fillRect(c.x, c.y + half * (1 - s), c.w, half * s);
        } else {
          const s = -Math.cos(c.p * Math.PI);
          g.drawImage(a, 0, sh, a.width, sh, c.x, c.y + half, c.w, half * s);
          g.fillStyle = `rgba(255,255,255,${(0.1 * (1 - s)).toFixed(3)})`;
          g.fillRect(c.x, c.y + half, c.w, half * s);
        }
      }
    };
    let over: { x: number; y: number } | null = null;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden) return;
      let turning = false;
      for (const c of cells) {
        const want = over ? 1 + 0.26 * Math.exp(-((Math.hypot(c.x + c.w / 2 - over.x, c.y + c.h / 2 - over.y) / (c.w * 1.15)) ** 2)) : 1;
        const s = Math.abs(want - c.s) < 0.002 ? want : c.s + (want - c.s) * Math.min(1, dt * 13);
        if (s !== c.s) {
          c.s = s;
          turning = true;
        }
        if (c.wait > 0) {
          c.wait -= dt;
          turning = true;
          continue;
        }
        if (c.p < 1) {
          c.p = Math.min(1, c.p + dt / TURN);
          turning = true;
        }
        if (c.p >= 1 && c.steps.length) {
          c.from = c.cur;
          c.cur = c.steps.shift()!;
          c.p = 0;
          turning = true;
        }
      }
      if (turning) paint();
    };
    const shuffle = (x: number, y: number) => {
      for (const c of cells) {
        if (c.steps.length || c.p < 1 || c.to === " ") continue;
        const d = Math.hypot(c.x + c.w / 2 - x, c.y + c.h / 2 - y);
        const seq: string[] = [];
        for (let i = 0; i < 4; i++) seq.push(DRUM[1 + Math.floor(Math.random() * 36)]);
        c.steps = [...seq, c.to];
        c.wait = d / 700;
      }
    };
    const onTap = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      shuffle(e.clientX - r.left, e.clientY - r.top);
    };
    // Where a mouse is over it: those flaps stand out (as letters swell
    // everywhere on the site, §103.8). A click sends a ripple of turns round.
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = canvas.getBoundingClientRect();
      over = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onOut = () => {
      over = null;
    };
    const all = () => {
      lay();
      if (cells.length) paint();
    };
    poke.current = all;
    const ro = new ResizeObserver(all);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(el);
    const onTheme = () =>
      window.setTimeout(() => {
        pal = readPal(root);
        faces.clear();
        paint();
      }, 160);
    window.addEventListener(THEME_EVENT, onTheme);
    void document.fonts.ready.then(() => {
      faces.clear();
      all();
    });
    if (!still) {
      raf = requestAnimationFrame(loop);
      canvas.addEventListener("click", onTap);
      canvas.addEventListener("pointermove", onOver);
      canvas.addEventListener("pointerleave", onOut);
    }
    return () => {
      poke.current = () => {};
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener(THEME_EVENT, onTheme);
      canvas.removeEventListener("click", onTap);
      canvas.removeEventListener("pointermove", onOver);
      canvas.removeEventListener("pointerleave", onOut);
    };
  }, [entered]);

  return (
    <div className="plate-board">
      <i aria-hidden className="plate-screw" style={{ left: 5, top: 5 }} />
      <i aria-hidden className="plate-screw" style={{ right: 5, top: 5 }} />
      <i aria-hidden className="plate-screw" style={{ left: 5, bottom: 5 }} />
      <i aria-hidden className="plate-screw" style={{ right: 5, bottom: 5 }} />
      <div ref={box} className="w-full">
        <canvas ref={cv} aria-hidden className="block w-full" />
      </div>
    </div>
  );
}
