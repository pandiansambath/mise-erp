"use client";

/** The platform, drawn as what it is.
 *
 *  TWO LAYERS, and the split is not arbitrary:
 *
 *    SVG    — structure, text, hit targets, `var()` colours, focus rings.
 *    CANVAS — pulses only. Forty animating SVG circles means forty style
 *             recalculations and a layout pass every frame; forty `arc()` calls
 *             is nothing. No WebGL: forty sprites do not need a GPU pipeline.
 *
 *  ⚠️ THE TRAP: CANVAS CANNOT READ `var(--color-brand-400)`. It takes resolved
 *  colour strings only. So the palette is resolved once with `getComputedStyle`
 *  and RE-RESOLVED when the theme changes — miss that and the pulses keep the
 *  old theme's colours forever while the SVG around them repaints correctly,
 *  which is the same family of bug as the `data-mode` and `mise_theme` entries
 *  already in this project's traps table.
 *
 *  AND "BRIGHT" IS A DIRECTION, NOT A COLOUR. Every lit state is a mix TOWARD
 *  `--color-fg` and away from `--color-shell`. `--color-fg` is near-white on
 *  dark themes and black on light ones, so one expression goes brighter on
 *  black and deeper on white with no branching. The Control Room is on a WHITE
 *  theme today, and every neural-network visual on the internet assumes black —
 *  built the obvious way with `mix-blend-mode: screen` and drop-shadow glows,
 *  this would be a beautiful screenshot and an invisible page.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  assertNoOverlap,
  curve,
  layout,
  pointOnCurve,
  type GraphEdge,
  type GraphNode,
  subtitleFor,
  type Placed,
  type Widths,
} from "./geometry";

/** Shape per kind. Colour alone never carries meaning — the accessibility floor
 *  and, more practically, it is what makes the picture readable in a
 *  screenshot. */
const SHAPE: Record<string, "circle" | "hex" | "diamond" | "square"> = {
  platform: "square",
  restaurant: "circle",
  anonymous: "circle",
  operator: "circle",
  orphan: "circle",
  service: "hex",
  model: "diamond",
};

const KIND_VAR: Record<string, string> = {
  platform: "--color-brand-500",
  restaurant: "--chart-1",
  anonymous: "--chart-8",
  operator: "--chart-4",
  orphan: "--chart-8",
  service: "--chart-3",
  model: "--chart-7",
};

type Palette = Record<string, string> & { fg: string; shell: string; faint: string };

function resolvePalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const get = (v: string, fallback: string) => cs.getPropertyValue(v).trim() || fallback;
  const fg = get("--color-fg", "#111111");
  const shell = get("--color-shell", "#ffffff");
  const out: Palette = { fg, shell, faint: get("--color-fg-faint", "#8a8a8a") };
  for (const [kind, v] of Object.entries(KIND_VAR)) {
    out[kind] = get(v, "#7c8aa5");
  }
  return out;
}

/** Mix toward the foreground — "lit". Canvas needs a resolved rgb string, and
 *  `color-mix()` in a canvas fillStyle is not reliable across browsers, so this
 *  does the interpolation in JS rather than handing CSS a string it may drop. */
function mix(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function parseColor(c: string): number[] | null {
  const s = c.trim();
  if (s.startsWith("#")) {
    const hex = s.length === 4
      ? s.slice(1).split("").map((ch) => ch + ch).join("")
      : s.slice(1);
    if (hex.length < 6) return null;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(",").slice(0, 3).map((n) => parseFloat(n));
  return null;
}

function shapePath(kind: string, x: number, y: number, r: number): string {
  const s = SHAPE[kind] ?? "circle";
  if (s === "hex") {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${i ? "L" : "M"} ${x + Math.cos(a) * r} ${y + Math.sin(a) * r}`;
    }).join(" ") + " Z";
  }
  if (s === "diamond") {
    return `M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`;
  }
  if (s === "square") {
    const k = r * 0.86;
    return `M ${x - k} ${y - k} h ${k * 2} a 12 12 0 0 1 12 12 v ${k * 2 - 24} a 12 12 0 0 1 -12 12 h ${-k * 2} a 12 12 0 0 1 -12 -12 v ${-(k * 2 - 24)} a 12 12 0 0 1 12 -12 Z`;
  }
  return `M ${x} ${y - r} a ${r} ${r} 0 1 0 0.01 0 Z`;
}

type Pulse = { edge: GraphEdge; a: Placed; b: Placed; t: number; speed: number };

/** The spines for one node: the areas it opened, normalised against its own
 *  busiest one so the ring shows SHAPE OF USE rather than size of restaurant —
 *  a small restaurant that uses everything should look busy, because it is. */
function areasOf(p: Placed): { area: string; share: number }[] {
  const raw = (p.detail?.areas as { area: string; requests: number }[]) ?? [];
  if (!raw.length) return [];
  const top = Math.max(1, ...raw.map((a) => a.requests));
  return raw.slice(0, 24).map((a) => ({ area: a.area, share: a.requests / top }));
}

export function NeuralMap({
  nodes,
  edges,
  onPick,
  selected,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onPick: (n: GraphNode) => void;
  selected: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const [hover, setHover] = useState<string | null>(null);
  const [pal, setPal] = useState<Palette | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-resolve on every theme change. `data-mode` lives on <html>, so an
  // observer on its attributes is the only signal that covers both the toggle
  // and the system-preference path.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const read = () => setPal(resolvePalette(el));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode", "class", "style"],
    });
    return () => mo.disconnect();
  }, []);

  /** MEASURED label widths, not estimated ones.
   *
   *  The column solve sizes each column from the widest label in it, so an
   *  estimate that is 10% low produces exactly the clipped text it was meant to
   *  prevent. Rendered into a hidden <text> in the real SVG, with the real
   *  fonts, and read back with getComputedTextLength(). */
  const [widths, setWidths] = useState<Widths>(new Map());
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !nodes.length) return;
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("visibility", "hidden");
    probe.setAttribute("font-size", "12");
    probe.setAttribute("font-weight", "600");
    svg.appendChild(probe);
    const next: Widths = new Map();
    for (const n of nodes) {
      for (const s of [n.label, subtitleFor(n)]) {
        if (!s || next.has(s)) continue;
        probe.textContent = s;
        next.set(s, probe.getComputedTextLength());
      }
    }
    svg.removeChild(probe);
    setWidths(next);
  }, [nodes]);

  const { placed, byId } = useMemo(
    () => layout(nodes, size.w, size.h, widths),
    [nodes, size.w, size.h, widths],
  );

  // A PROOF, in development. The previous layout drew one restaurant inside
  // another and shipped; nobody found it until a person looked at a picture.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !placed.length) return;
    const bad = assertNoOverlap(placed);
    if (bad.length) console.error(["[map] nodes overlap:", ...bad].join(" | "));
  }, [placed]);

  const drawn = useMemo(
    () =>
      edges
        .map((e) => ({ e, a: byId.get(e.source), b: byId.get(e.target) }))
        .filter((x): x is { e: GraphEdge; a: Placed; b: Placed } => !!x.a && !!x.b),
    [edges, byId],
  );

  const maxW = useMemo(
    () => Math.max(1, ...drawn.map((d) => Math.abs(d.e.weight || 0))),
    [drawn],
  );

  // ── the pulses ────────────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !pal) return;

    // Motion is INFORMATION here — pulse speed is the real call latency — but
    // information nobody asked for is not worth overriding a stated preference.
    // Everyone who turns this off gets the static counts on the edges instead.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // A pulse means THIS HAPPENED. Only measured edges emit one — nothing
    // modelled may ever fire a discrete packet, because that would dress an
    // apportionment up as an event.
    // A PULSE IS A PACKET, SO ONLY THINGS THAT COME IN PACKETS MAY PULSE.
    //
    // Nine of sixteen edges were cost edges, and a dollar is a RATE, not an
    // event — animating one dresses an accounting figure up as something that
    // happened at a moment. The original spec forbids exactly this and the
    // first build did it anyway. Requests and AI calls are discrete; money is
    // not, so cost edges carry their thickness and stay still.
    const live = drawn.filter(
      (d) => d.e.measured && d.e.weight > 0 && d.e.kind !== "cost",
    );
    if (!live.length) return;

    const pulses: Pulse[] = [];
    let raf = 0;
    let last = performance.now();

    const spawn = () => {
      if (pulses.length >= 40) return;
      // Weighted by traffic, so a busy edge visibly carries more.
      const pick = live[Math.floor(Math.random() * live.length)];
      const share = Math.abs(pick.e.weight) / maxW;
      if (Math.random() > 0.15 + share * 0.85) return;
      // LATENCY DRIVES SPEED — but it has to be REAL latency, and for HTTP
      // edges `latency_ms` is null, so thirteen of sixteen pulses were running
      // at a hardcoded 900ms: the one thing on this page that is supposed to be
      // measured, invented. The per-node average response time was already in
      // the payload and unused. Falling back to it means an HTTP packet crosses
      // at the speed that restaurant's requests actually take.
      //
      // And the floor is 0.18s, not 0.4s: real HTTP latencies here are 7-95ms,
      // so a 0.4s floor flattened every one of them to the same speed and threw
      // away the difference the animation exists to show. AI calls (857ms vs
      // 5,242ms) keep their six-fold spread either way.
      const ms =
        pick.e.latency_ms ??
        Number(pick.a.metrics?.avg_ms) ??
        Number(pick.a.metrics?.ai_avg_latency_ms) ??
        900;
      const seconds = Math.max(0.18, Math.min(6, (Number(ms) || 900) / 1000));
      pulses.push({ edge: pick.e, a: pick.a, b: pick.b, t: 0, speed: 1 / seconds });
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, size.w, size.h);
      if (Math.random() < 0.5) spawn();

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += dt * p.speed;
        if (p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const { x, y } = pointOnCurve(p.a, p.b, p.t);
        const base = pal[p.a.kind] ?? pal.restaurant;
        const c = mix(base, pal.fg, 0.2);
        const dim = hover && hover !== p.a.id && hover !== p.b.id;
        ctx.globalAlpha = dim ? 0.12 : 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        // A short trail, so direction is readable without an arrowhead.
        const tail = pointOnCurve(p.a, p.b, Math.max(0, p.t - 0.05));
        ctx.globalAlpha = dim ? 0.05 : 0.3;
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };

    // A page left open all day in a background tab should cost nothing.
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [drawn, size.w, size.h, pal, maxW, hover]);

  const dimmed = (id: string) =>
    !!hover && hover !== id && !drawn.some(
      (d) =>
        (d.e.source === hover && d.e.target === id) ||
        (d.e.target === hover && d.e.source === id),
    );

  return (
    <div ref={box} className="relative min-h-0 w-full flex-1">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="absolute inset-0"
        role="img"
        aria-label="A map of the platform: restaurants, what they use, and what it costs."
      >
        {/* A SPHERE, NOT A DISC. "im expecting more grapgical ui" — a flat
            circle with a label beside it is a diagram; an off-centre highlight
            falling to a darker rim is an object with a light on it, which is
            the whole difference between a chart and something that looks alive.
            Four lines of <defs> and no library.

            Both stops obey the direction-not-colour rule: the highlight mixes
            toward --color-fg and the rim toward --color-shell, so on a light
            theme it reads as a deepening and on a dark one as a glow, with no
            branching and no second palette. */}
        <defs>
          {pal &&
            Object.keys(KIND_VAR).map((kind) => {
              const base = pal[kind] ?? pal.restaurant;
              return (
                <radialGradient key={kind} id={`sphere-${kind}`} cx="34%" cy="28%" r="78%">
                  <stop offset="0%" stopColor={mix(base, pal.fg, 0.1)} />
                  <stop offset="55%" stopColor={mix(base, pal.shell, 0.45)} />
                  <stop offset="100%" stopColor={mix(base, pal.shell, 0.78)} />
                </radialGradient>
              );
            })}
        </defs>
        {/* ── edges ─────────────────────────────────────────────────── */}
        <g fill="none">
          {drawn.map(({ e, a, b }) => {
            const share = Math.abs(e.weight) / maxW;
            const faded = !!hover && hover !== e.source && hover !== e.target;
            const c = pal ? mix(pal[a.kind] ?? pal.restaurant, pal.fg, 0.25) : "#889";
            return (
              <path
                key={e.id}
                d={curve(a, b)}
                stroke={c}
                // MODELLED IS FIXED-WIDTH AND DASHED. Scaling a model's
                // thickness by its value implies a precision it has not got —
                // the shared box costs the same with one restaurant or fifty.
                strokeWidth={e.measured ? 1 + share * 5 : 1.5}
                strokeDasharray={e.measured ? undefined : "5 5"}
                strokeLinecap="round"
                opacity={faded ? 0.08 : e.measured ? 0.5 : 0.35}
                style={{ transition: "opacity .2s" }}
              />
            );
          })}
        </g>

        {/* ── nodes ─────────────────────────────────────────────────── */}
        {placed.map((p) => {
          const base = pal ? (pal[p.kind] ?? pal.restaurant) : "#7c8aa5";
          const lit = pal ? mix(base, pal.fg, 0.18) : base;
          const quiet = pal ? mix(base, pal.shell, 0.72) : base;
          const channels = Object.entries(p.channels ?? {});
          const anyFired = channels.some(([, c]) => c.fired);
          const faded = dimmed(p.id);
          const isSel = selected === p.id;

          return (
            <g
              key={p.id}
              opacity={faded ? 0.25 : 1}
              style={{ transition: "opacity .2s", cursor: "pointer" }}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(p)}
              tabIndex={0}
              role="button"
              aria-label={`${p.label}. ${anyFired ? "active" : "no activity recorded"}.`}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onPick(p);
                }
              }}
            >
              {/* The halo is a MIX toward the ground, never a drop-shadow or a
                  screen blend — both are black-background tricks that vanish on
                  the white theme this Control Room is actually using. */}
              {anyFired && (
                <path
                  d={shapePath(p.kind, p.x, p.y, p.r + 10)}
                  fill={pal ? mix(base, pal.shell, 0.86) : "none"}
                />
              )}
              <path
                d={shapePath(p.kind, p.x, p.y, p.r)}
                fill={pal ? (anyFired ? `url(#sphere-${p.kind})` : mix(base, pal.shell, 0.86)) : "none"}
                stroke={anyFired ? lit : quiet}
                // SEVERED: a GAP, not a dash. Usage whose restaurant no longer
                // exists — charge with nowhere to go. A gap reads as cut
                // instantly; a dashed ring reads as a style.
                strokeDasharray={
                  p.severed ? `${p.r * 4} ${p.r * 1.6}` : undefined
                }
                strokeWidth={isSel ? 3 : 1.6}
              />

              {/* CHANNEL ARCS — aliveness is per channel, not per node.
                  NIRAI.Reading has 60 AI calls and no measured HTTP at all, so
                  one "active" dot would have to call one of those a lie. A
                  channel that exists but has not fired keeps its FULL stroke at
                  low chroma: quiet must read as resting, never as broken. */}
              {channels.map(([name, c], i) => {
                const span = Math.PI / (channels.length + 0.4);
                const from = -Math.PI / 2 + i * (span + 0.18);
                const rr = p.r + 5;
                const x1 = p.x + Math.cos(from) * rr;
                const y1 = p.y + Math.sin(from) * rr;
                const x2 = p.x + Math.cos(from + span) * rr;
                const y2 = p.y + Math.sin(from + span) * rr;
                if (!c.measured && !c.fired) return null;
                return (
                  <path
                    key={name}
                    d={`M ${x1} ${y1} A ${rr} ${rr} 0 0 1 ${x2} ${y2}`}
                    fill="none"
                    stroke={c.fired ? lit : quiet}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                );
              })}

              {/* THE DENDRITE RING — specified in the first design and never
                  built, and it is the thing that makes thirteen nodes look
                  like a brain rather than a bubble chart.
                  ------------------------------------------------------------
                  One spine per AREA THE RESTAURANT ACTUALLY OPENED, lit in
                  proportion to how much. Measured, not configured: the features
                  map says what is switched ON, which is a far weaker claim than
                  what anybody used, and a ring of 33 identical toggles would
                  look the same for every restaurant on the platform.

                  It is also what stops a quiet restaurant looking broken.
                  NIRAI.Reading has no HTTP traffic at all, so it draws a
                  COMPLETE ring of unlit tracks: visibly whole, visibly idle —
                  a neuron at rest, not a dead one. */}
              {areasOf(p).length > 0 && (
                <g className="pointer-events-none">
                  {areasOf(p).map((a, i, arr) => {
                    const ang = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
                    const inner = p.r + 3;
                    const len = 4 + (a.share || 0) * 7;
                    return (
                      <line
                        key={a.area}
                        x1={p.x + Math.cos(ang) * inner}
                        y1={p.y + Math.sin(ang) * inner}
                        x2={p.x + Math.cos(ang) * (inner + len)}
                        y2={p.y + Math.sin(ang) * (inner + len)}
                        stroke={a.share > 0 ? lit : quiet}
                        strokeWidth={a.share > 0 ? 1.7 : 1}
                        strokeLinecap="round"
                        opacity={a.share > 0 ? 0.85 : 0.5}
                      />
                    );
                  })}
                </g>
              )}

              {/* LABELS SIT BESIDE THE NODE, NOT INSIDE IT.
                  The single highest-leverage change in this redesign. Inside,
                  a name has to fit a circle — so every long one was truncated
                  ("adras Ki…", "Virtual Pri…"), seven of sixteen of them, and
                  the AWS key that distinguishes one line from another was the
                  first thing lost. Outside, the column solve has already
                  reserved exactly the width the widest label needs, so nothing
                  truncates and the node interior is free for graphics.

                  One direction per column — A points left, C and D point right
                  — so a label can never wander into a neighbour's space. */}
              {p.col !== "B" && (
                <>
                  <text
                    x={p.x + (p.anchor === -1 ? -(p.r + 12) : p.r + 12)}
                    y={p.y - 1}
                    textAnchor={p.anchor === -1 ? "end" : "start"}
                    className="pointer-events-none fill-fg text-[12px] font-semibold"
                  >
                    {p.label}
                  </text>
                  <text
                    x={p.x + (p.anchor === -1 ? -(p.r + 12) : p.r + 12)}
                    y={p.y + 13}
                    textAnchor={p.anchor === -1 ? "end" : "start"}
                    /* TEXT NEVER DIMS. Luminance carries activity; opacity
                       carries nothing, and a dimmed label reads as disabled. */
                    className="pointer-events-none fill-fg-faint text-[10.5px] font-mono"
                  >
                    {p.sub}
                  </text>
                </>
              )}
              {p.col === "B" && (
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  className="pointer-events-none fill-fg text-[12px] font-bold"
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <canvas
        ref={canvas}
        className="pointer-events-none absolute inset-0"
        style={{ width: size.w, height: size.h }}
      />
    </div>
  );
}

