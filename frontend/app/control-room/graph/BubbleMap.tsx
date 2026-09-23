"use client";

/** The platform as bubbles inside bubbles, with the bill around the rim.
 *
 *     "the sahpes are not nice use bubbles instead please bubbule wil be
 *      imprssive to look like bubbuel inside that anothe bublles etcetc"
 *     "we can move...pull...zoon ni zoom out"
 *     "under the any hotel if we lcick i will show us zoominded view of its
 *      own pages as nodes"
 *
 *  ONE SCENE, ONE CAMERA. Drilling into a restaurant is not a different
 *  mechanism from zooming — it is the same camera flying to a computed
 *  target. That is why pan, zoom, rotate and click-to-open are one feature
 *  and not four, and why nothing opens in a popup: the old sheet is what
 *  made drilling in feel like leaving the map.
 *
 *  The bubble you click does not move relative to anything else. Its
 *  siblings fly off the edges because the CAMERA moved, and they are still
 *  there when you come back.
 *
 *  PERFORMANCE: the camera is a `setAttribute` on one `<g>`, never React
 *  state. A camera written through `setState` re-renders every bubble sixty
 *  times a second, and this project has already shipped that once — it was
 *  the phone "flickering while it answers" that survived two other fixes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type Camera,
  HOME,
  clampTheta,
  flyTo,
  frame,
  toTransform,
  zoomAt,
} from "./camera";
import type { GraphNode } from "./geometry";
import { type Packed, billArcs, overlaps, packInCircle } from "./pack";

type Props = {
  nodes: GraphNode[];
  bill: { service: string; label: string; usd: number; pool: string }[];
  totalUsd: number;
  onOpen?: (node: GraphNode) => void;
};

/** Load, for sizing. An AI call is weighted as roughly a dozen requests: it
 *  is the one call that costs real money per unit, and a restaurant with 240
 *  AI calls and little traffic should not look empty. */
function weigh(n: GraphNode): number {
  const req = Number(n.metrics?.requests ?? 0);
  const ai = Number(n.metrics?.ai_calls ?? 0);
  return req + ai * 12;
}

/** TWO HOTELS BOTH READ "NIRAI" on the live map — his real tenant with
 *  3,374 requests, and a separate one with 160 — and nothing on the bubble
 *  told them apart. An ambiguous label is worse than a long one, so where a
 *  name repeats the handle is appended. Computed per render set, because
 *  whether a name is ambiguous depends on what else is on screen. */
function disambiguate(nodes: GraphNode[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const n of nodes) seen.set(n.label, (seen.get(n.label) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const n of nodes) {
    const handle = String(n.detail?.handle ?? "");
    out.set(n.id, (seen.get(n.label) ?? 0) > 1 && handle ? `${n.label} · ${handle}` : n.label);
  }
  return out;
}

/** What a restaurant actually did, in the fewest words that are still true.
 *  "no AI yet" rather than "0 AI calls": a zero written as a digit reads as
 *  a score, and this is a state. */
function countLine(n: GraphNode): string {
  const req = Number(n.metrics?.requests ?? 0);
  const ai = Number(n.metrics?.ai_calls ?? 0);
  if (!req && !ai) return "nothing yet";
  const r = `${req.toLocaleString()} req`;
  return ai ? `${r} · ${ai.toLocaleString()} AI` : `${r} · no AI yet`;
}

const POOL_TONE: Record<string, string> = {
  shared: "var(--chart-3)",
  platform: "var(--chart-4)",
  use: "var(--chart-7)",
};

export function BubbleMap({ nodes, bill, totalUsd, onOpen }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const camRef = useRef<Camera>({ ...HOME });
  const tween = useRef<{ stop: () => void } | null>(null);

  const [size, setSize] = useState({ w: 960, h: 640 });
  const [into, setInto] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [hoverArc, setHoverArc] = useState<string | null>(null);
  /** A TAPPED arc, which is the only way to read a figure on a phone.
   *  The dollar amounts lived in an SVG `<title>` — hover-only — so on
   *  mobile the rim total was legible and not one line of it was. */
  const [pickedArc, setPickedArc] = useState<string | null>(null);
  /** The zoom the LABELS are drawn for. Updated when a fly or a zoom
   *  settles, never per frame: the camera is deliberately not React state,
   *  and re-rendering every bubble sixty times a second is the mistake this
   *  component was written to avoid. Settling is enough — you read a label
   *  after you stop moving, not during. */
  const [kView, setKView] = useState(1);
  const settle = useRef<number | null>(null);
  const noteZoom = useCallback(() => {
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setKView(camRef.current.k), 120);
  }, []);

  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(320, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The field's radius. The rim carries the bill band, so the pack sits
   *  inside it with room for the band's own thickness. */
  const R = Math.max(80, Math.min(size.w, size.h) / 2 - 34);

  const demand = useMemo(
    () => nodes.filter((n) => n.kind !== "service" && n.kind !== "model"),
    [nodes],
  );

  const packed = useMemo(
    () => packInCircle(demand.map((n) => ({ id: n.id, weight: weigh(n) })), R),
    [demand, R],
  );

  const byId = useMemo(() => new Map(demand.map((n) => [n.id, n])), [demand]);

  /** Children of the bubble we are inside: its AREAS, which sum to it.
   *  That summation is the whole justification for drawing them nested. */
  const kids = useMemo(() => {
    if (!into) return [];
    const parent = packed.find((p) => p.id === into);
    const node = byId.get(into);
    if (!parent || !node) return [];
    const areas = (node.detail?.areas as { area: string; requests: number }[]) ?? [];
    if (!areas.length) return [];
    return packInCircle(
      areas.map((a) => ({ id: `${into}::${a.area}`, weight: a.requests })),
      parent.r * 0.86,
    ).map((c) => ({
      ...c,
      x: c.x + parent.x,
      y: c.y + parent.y,
      label: `${into}::`.length ? c.id.split("::")[1] : c.id,
      requests: areas.find((a) => `${into}::${a.area}` === c.id)?.requests ?? 0,
    }));
  }, [into, packed, byId]);

  /** Asserted in PRODUCTION and published, because the previous map's only
   *  overlap check was compiled out of the shipping build — which is exactly
   *  why six superimposed labels survived to a screenshot. */
  const bad = useMemo(() => overlaps(packed).length, [packed]);

  const arcs = useMemo(() => billArcs(bill), [bill]);
  const names = useMemo(() => disambiguate(demand), [demand]);
  const idle = useMemo(
    // `"restaurant"`, not `"hotel"` — the backend's own constant. I guessed
    // and the filter would have matched nothing, silently: an idle-restaurant
    // line that never appears looks exactly like a platform with no idle
    // restaurants, which is the opposite of what it is for.
    () => demand.filter((n) => n.kind === "restaurant" && weigh(n) === 0),
    [demand],
  );
  const nameOf = useCallback(
    (n: GraphNode) => {
      const full = names.get(n.id) ?? n.label;
      return full.length > 18 ? `${full.slice(0, 17)}…` : full;
    },
    [names],
  );

  const apply = useCallback(
    (c: Camera) => {
      camRef.current = c;
      sceneRef.current?.setAttribute("transform", toTransform(c, size.w, size.h));
    },
    [size.w, size.h],
  );

  useEffect(() => {
    apply(camRef.current);
  }, [apply]);

  const fly = useCallback(
    (to: Camera, ms: number, done?: () => void) => {
      tween.current?.stop();
      tween.current = flyTo(camRef.current, to, ms, apply, done, !!reduce);
    },
    [apply, reduce],
  );

  const enter = useCallback(
    (p: Packed) => {
      setInto(p.id);
      setResolved(false);
      // Children RESOLVE rather than appear: the speckle is already in the
      // right places at the right relative sizes, so what changes is that
      // dots become things you can read. Without that continuity a zoom into
      // a plain disc is just a cut.
      window.setTimeout(() => setResolved(true), reduce ? 0 : 220);
      fly(frame(p, size.w, size.h), reduce ? 0 : 520, () => setKView(camRef.current.k));
    },
    [fly, size.w, size.h, reduce],
  );

  const out = useCallback(() => {
    setInto(null);
    setResolved(false);
    // Faster up than down: descending is a decision, retreating is a release.
    fly(HOME, reduce ? 0 : 380, () => setKView(camRef.current.k));
  }, [fly, reduce]);

  // ── gestures ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // Shift+wheel rotates, because he asked to be able to — and a map that
      // rotates on a plain wheel is one nobody can read by accident.
      if (e.shiftKey) {
        const c = camRef.current;
        apply({ ...c, theta: clampTheta(c.theta + e.deltaY * 0.0015) });
        return;
      }
      apply(
        zoomAt(
          camRef.current,
          Math.pow(0.999, e.deltaY),
          e.clientX - r.left,
          e.clientY - r.top,
          size.w,
          size.h,
        ),
      );
      noteZoom();
    };

    // ⚠️ CAPTURE ONLY ONCE IT IS ACTUALLY A DRAG.
    //
    // This called `setPointerCapture` on EVERY pointerdown, and Chromium
    // retargets the resulting `click` to the capturing element. So the
    // wrapper swallowed every click: no bubble ever opened, and the
    // "← all restaurants" button — inside the same wrapper — was dead too.
    // Escape was the only way in or out of a restaurant, which is not a
    // feature anybody can find.
    //
    // A press that never moves is a CLICK and must be left alone.
    let drag: {
      x: number;
      y: number;
      cx: number;
      cy: number;
      moved: boolean;
      id: number;
    } | null = null;
    const THRESHOLD = 4;

    const down = (e: PointerEvent) => {
      tween.current?.stop();
      drag = {
        x: e.clientX,
        y: e.clientY,
        cx: camRef.current.x,
        cy: camRef.current.y,
        moved: false,
        id: e.pointerId,
      };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        drag.moved = true;
        // NOW it is a drag, so take the pointer — this is also what stops
        // the gesture dying when the cursor leaves the element mid-pan.
        try {
          el.setPointerCapture(drag.id);
        } catch {
          /* some browsers refuse; panning still works without it */
        }
      }
      apply({ ...camRef.current, x: drag.cx + dx, y: drag.cy + dy });
    };
    const up = (e: PointerEvent) => {
      if (drag?.moved) {
        try {
          el.releasePointerCapture(drag.id);
        } catch {
          /* already gone */
        }
      }
      drag = null;
      void e;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [apply, size.w, size.h, noteZoom]);

  // Escape climbs one level. A map you can only leave with the mouse is one
  // somebody gets stuck inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && into) out();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [into, out]);

  const parent = into ? packed.find((p) => p.id === into) : null;

  return (
    <div
      ref={wrap}
      className="relative h-full w-full touch-none select-none overflow-hidden rounded-3xl"
    >
      <svg
        width={size.w}
        height={size.h}
        className="absolute inset-0"
        role="img"
        aria-label="The platform: restaurants by load, inside the AWS bill."
        data-map-overlap={bad}
      >
        <defs>
          {/* A SPHERE, NOT A DISC. An off-centre highlight is the whole
              difference between a diagram and something that looks alive —
              and it costs one gradient, not a light model. */}
          <radialGradient id="bub" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity="0.95" />
            <stop offset="60%" stopColor="var(--color-brand-600)" stopOpacity="0.72" />
            <stop offset="100%" stopColor="var(--color-brand-700)" stopOpacity="0.62" />
          </radialGradient>
        </defs>

        {/* ── the bill, as the rim ───────────────────────────────────────
            Not nine more bubbles. This band's whole circumference IS the
            total, so it says "these things ARE the bill" before anybody
            reads a digit — and it costs no interior space, which is the
            answer to the empty-rail complaint. */}
        <g transform={`translate(${size.w / 2} ${size.h / 2})`}>
          {arcs.map((a) => {
            const rr = R + 18;
            const x1 = Math.cos(a.from) * rr;
            const y1 = Math.sin(a.from) * rr;
            const x2 = Math.cos(a.to) * rr;
            const y2 = Math.sin(a.to) * rr;
            const big = a.to - a.from > Math.PI ? 1 : 0;
            return (
              <path
                key={a.id}
                d={`M ${x1} ${y1} A ${rr} ${rr} 0 ${big} 1 ${x2} ${y2}`}
                fill="none"
                stroke={POOL_TONE[a.pool] ?? "var(--chart-3)"}
                strokeWidth={hoverArc === a.id || pickedArc === a.id ? 18 : 12}
                strokeLinecap="butt"
                className="transition-[stroke-width] duration-150"
                onMouseEnter={() => setHoverArc(a.id)}
                onMouseLeave={() => setHoverArc(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickedArc((cur) => (cur === a.id ? null : a.id));
                }}
                style={{ cursor: "pointer" }}
              >
                <title>{`${a.label} — $${a.usd.toFixed(2)}`}</title>
              </path>
            );
          })}
        </g>

        {/* ── the scene. ONE transform, set imperatively. ─────────────── */}
        <g ref={sceneRef}>
          {packed.map((p) => {
            const n = byId.get(p.id);
            if (!n) return null;
            const inside = into === p.id;
            const dim = into && !inside;
            return (
              <g
                key={p.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer transition-opacity duration-300"
                opacity={dim ? 0.25 : 1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (inside) onOpen?.(n);
                  else enter(p);
                }}
                role="button"
                tabIndex={0}
                aria-label={n.label}
              >
                <circle r={p.r} fill="url(#bub)" />
                <circle
                  r={p.r}
                  fill="none"
                  stroke="var(--color-brand-300)"
                  strokeOpacity={inside ? 0.85 : 0.35}
                  strokeWidth={1.5}
                />
                {/* THE SPECKLE — the children, visible from outside at the
                    right relative sizes, so that zooming in RESOLVES them
                    rather than replacing the picture. */}
                {!inside &&
                  p.r > 26 &&
                  (((n.detail?.areas as { requests: number }[]) ?? []).slice(0, 6)).map(
                    (_a, i, all) => {
                      const t = (i / Math.max(1, all.length)) * Math.PI * 2;
                      const rr = p.r * 0.45;
                      return (
                        <circle
                          key={i}
                          cx={Math.cos(t) * rr}
                          cy={Math.sin(t) * rr}
                          r={Math.max(2, p.r * 0.09)}
                          fill="var(--color-brand-200)"
                          opacity={0.28}
                        />
                      );
                    },
                  )}
                {/* The label lives INSIDE its bubble, so label-vs-label
                    collision is not representable — which is the structural
                    answer to six names in a pile. */}
                {/* ON-SCREEN SIZE, not the pack radius. Gating on `p.r`
                    meant a small restaurant stayed an anonymous dot however
                    far you zoomed into it — eight of seventeen had no name
                    at all. `kView` follows the camera once it settles. */}
                {p.r * kView > 26 && (
                  <text
                    textAnchor="middle"
                    y={4}
                    className="pointer-events-none fill-white font-semibold"
                    style={{ fontSize: Math.max(9, Math.min(15, (p.r * kView) * 0.3)) / kView }}
                  >
                    {nameOf(n)}
                  </text>
                )}
                {/* THE NUMBER, under the name. The Columns view showed
                    "536 req · no AI yet" beside every restaurant and the
                    first bubble version showed nothing — so the prettier
                    view told you LESS, which is not a trade worth making.
                    Only where there is genuinely room for it. */}
                {p.r * kView > 52 && (
                  <text
                    textAnchor="middle"
                    y={4 + Math.max(10, Math.min(15, p.r * kView * 0.3)) / kView}
                    className="pointer-events-none fill-white/75"
                    style={{ fontSize: Math.max(8, Math.min(11, p.r * kView * 0.2)) / kView }}
                  >
                    {countLine(n)}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── inside a restaurant: its areas, which sum to it ────────── */}
          {parent &&
            resolved &&
            kids.map((k, i) => (
              // ⚠️ TWO GROUPS, AND THEY MUST STAY TWO.
              //
              // `.mise-tick-in` animates a CSS `transform`, and a CSS
              // transform on an SVG element OVERRIDES the XML
              // `transform="translate(x y)"` attribute. With both on one <g>
              // every child collapsed onto the parent's origin — twelve
              // bubbles, two distinct rectangles on screen.
              //
              // This exact trap is in the project's notes from 2026-08-11
              // and I walked into it again. Outer carries position, inner
              // carries animation; they cannot fight.
              <g key={k.id} transform={`translate(${k.x} ${k.y})`}>
                <g
                  className="mise-tick-in"
                  style={{ animationDelay: `${Math.min(12 * i, 140)}ms` }}
                >
                <circle r={k.r} fill="var(--color-brand-200)" opacity={0.9} />
                {k.r > 18 && (
                  <text
                    textAnchor="middle"
                    y={3}
                    className="pointer-events-none fill-brand-900 font-semibold"
                    style={{ fontSize: Math.max(8, Math.min(13, k.r * 0.32)) }}
                  >
                    {k.label}
                  </text>
                )}
                </g>
              </g>
            ))}
        </g>
      </svg>

      {/* ── the controls, and the way back ─────────────────────────────── */}
      {/* RESTAURANTS NOBODY IS USING, NAMED.
          With no traffic they pack as sub-pixel dots, so you would have to
          find and zoom each one before you could tell who it was. This
          page's own law is that an absent row and a zero row are different
          answers — Columns says "ready · nothing yet" in plain words, and
          that is why it was still the more USEFUL view. */}
      {!into && idle.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center sm:top-auto sm:bottom-3">
          <p className="mise-card-inset max-w-[92%] truncate rounded-full px-3 py-1.5 text-[0.6875rem] text-fg-faint">
            {idle.length} ready, nothing yet: {idle.map((n) => n.label).join(", ")}
          </p>
        </div>
      )}

      {/* ⚠️ BOTTOM AT 390, TOP ON A DESKTOP.
          The page already floats its own stats pill at the top, and at 390
          the two rendered ON TOP of each other — text bleeding through,
          both unreadable. Measured on the live site. There is nothing at the
          foot of the map on this route, so that is where it goes on a phone. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center sm:bottom-auto sm:top-3">
        <div className="mise-card-inset pointer-events-auto flex max-w-[92%] items-center gap-2 rounded-full px-3 py-1.5 text-[0.75rem]">
          {into ? (
            <>
              <button type="button" onClick={out} className="mise-press font-semibold text-brand-500">
                ← all restaurants
              </button>
              <span className="text-fg-faint">·</span>
              <span className="font-semibold text-fg">{byId.get(into)?.label}</span>
            </>
          ) : (
            <span className="truncate text-fg-soft">
              {pickedArc ? (
                // What the tapped arc costs, in words, because a phone has no
                // hover and the figure was only ever in a tooltip.
                <b className="text-fg">
                  {arcs.find((a) => a.id === pickedArc)?.label} $
                  {(arcs.find((a) => a.id === pickedArc)?.usd ?? 0).toFixed(2)}
                </b>
              ) : (
                <>${totalUsd.toFixed(2)} around the rim</>
              )}
              {/* No wheel and no shift key on a phone, and the full sentence
                  is wider than the screen. */}
              <span className="hidden sm:inline">
                {" "}
                · drag to move · scroll to zoom · shift-scroll to tilt
              </span>
              {pickedArc && (
                <button
                  type="button"
                  onClick={() => setPickedArc(null)}
                  className="mise-press ml-2 text-fg-faint underline"
                >
                  clear
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
