"use client";

// The Control Room map — ordered orbits on a dark stage.
//
//     "i dont like the UI UX of map feature in controlroom.... IM expecting
//      something super cool GUI....but current one is not reaching my
//      expectations (its clumsy tight and not ordered arranged etc)"
//
// Rejected four times before this (§46, §47, §50f, 29 Sep). Every earlier
// version was built from a guess. This one follows a designer's review of the
// live screen — 41 screenshots at 1440, 1280 and 390 — whose diagnosis was
// structural, not cosmetic:
//
//   · TIGHT AND EMPTY AT ONCE. A 550px circle in a 1388px canvas, bubbles
//     packed 2px apart inside it, and a 180px white band underneath.
//   · NOBODY IS NAMED. Identical blue spheres; 8 of 17 unnamed at 1440, 14 of
//     17 at 390. The rejected column view told him MORE than the pretty one.
//   · NO ORDER. No axis, no rank, no grouping, and positions that moved
//     between loads.
//
// So the two things this map does, on every level, are the answers:
//   RING = STATE (busy · quiet · not started), CLOCKWISE FROM 12 = RANK.
// Every body is named with one number. The same pattern repeats when you
// drill in, so there is one thing to learn, not three.
//
// Three traps this file already knows about, each of which shipped once:
//   · A CSS transform on an SVG element OVERRIDES its `transform` attribute —
//     twelve children collapsed onto one point. Bodies are positioned by a
//     style transform on an OUTER group and animated on an INNER one.
//   · `setPointerCapture` on every pointerdown retargets the click, making
//     every body inert. Capture starts only after a 4px drag.
//   · A browser focus outline on an SVG group draws a thick black SQUARE
//     round a round bubble — the loudest thing on the old screen. It is
//     switched off and a circular ring is drawn for keyboard focus instead.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openSupportView } from "@/components/controlroom/viewAs";
import { AREA_PAGE } from "./areas";
import { type Camera, HOME, toTransform, zoomAt } from "./camera";
import type { GraphNode } from "./geometry";
import { type Body, layout, platformGroups, restaurantGroups } from "./orbits";
import { packInCircle } from "./pack";

const BAR = 52; // the top bar, px

export function OrbitMap({
  nodes,
  right,
}: {
  nodes: GraphNode[];
  /** The period control and headline figures, drawn in the top bar. */
  right?: React.ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [into, setInto] = useState<string | null>(null);
  const [picked, setPicked] = useState<Body | null>(null);
  const [more, setMore] = useState<Body | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(0);
  const cam = useRef<Camera>(HOME);
  // A SNAPSHOT of the camera, as state, for placing the HTML cards. The live
  // camera is a ref (it moves sixty times a second and must not re-render
  // every body), and a ref cannot be read during render — so the cards are
  // placed from this copy, taken whenever a move finishes.
  const [camSnap, setCamSnap] = useState<Camera>(HOME);

  // ⚠️ THE BAR IS MEASURED, NOT ASSUMED. On a phone it wraps onto two lines,
  // and a fixed 52px put the ring legend underneath the period control.
  const barRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(BAR);

  useEffect(() => {
    const el = stageRef.current;
    const bar = barRef.current;
    if (!el || !bar) return;
    // ⚠️ THE DRAWING IS ABSOLUTELY POSITIONED, so it cannot push the stage.
    // It used to sit in the flow: the stage measured itself, sized the SVG to
    // fit, and the SVG then made the stage taller — a loop that settled at
    // 1,273px on an 844px phone and kept every body moving under the finger.
    const measure = () => {
      const b = bar.getBoundingClientRect().height;
      const s = el.getBoundingClientRect();
      setBarH(b);
      setSize({ w: Math.max(320, s.width), h: Math.max(320, s.height - b) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(bar);
    measure();
    return () => ro.disconnect();
  }, []);

  const W = size.w;
  const H = size.h;

  const restaurant = into ? nodes.find((n) => n.id === into) ?? null : null;
  const restaurantCount = nodes.filter((n) => n.kind === "restaurant").length;

  // ON A PHONE, THE TOP OF THE STAGE BELONGS TO THE LEGEND (and, inside a
  // restaurant, the door buttons). The layout is given the space BELOW that
  // band, so nothing is placed under it — the corner spheres were half hidden
  // behind the legend row, and "Background checks" behind the doors.
  const portrait = W < 640 || H > W * 1.05;
  const inset = portrait ? 38 + (restaurant ? 46 : 0) : 0;
  const LH = H - inset;

  const L = useMemo(() => {
    if (restaurant) {
      const { groups, satellites } = restaurantGroups(restaurant);
      const req = Number(restaurant.metrics?.requests) || 0;
      return layout(
        groups,
        satellites,
        { label: restaurant.label, sub: `${req.toLocaleString("en-GB")} requests` },
        W,
        LH,
        spin,
      );
    }
    const { groups, satellites } = platformGroups(nodes);
    return layout(groups, satellites, { label: "DineAI", sub: `${restaurantCount} restaurants` }, W, LH, spin);
  }, [nodes, restaurant, restaurantCount, W, LH, spin]);

  // ── the camera: pan, zoom, and "rotate" as orbital spin ────────────────
  const apply = useCallback(
    (c: Camera) => {
      cam.current = c;
      sceneRef.current?.setAttribute("transform", toTransform(c, W, LH));
    },
    [W, LH],
  );
  useEffect(() => apply(cam.current), [apply]);

  const fit = useCallback(() => {
    apply(HOME);
    setSpin(0);
    setCamSnap(HOME);
  }, [apply]);

  // A new level starts framed, not wherever the last one was panned to.
  useEffect(() => {
    apply(HOME);
    setPicked(null);
    setMore(null);
    setHover(null);
    setCamSnap(HOME);
  }, [into, apply]);

  const drag = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      (e.currentTarget as Element).setPointerCapture(d.id);
      setHover(null);
    }
    d.x = e.clientX;
    d.y = e.clientY;
    apply({ ...cam.current, x: cam.current.x + dx, y: cam.current.y + dy });
  };
  const onPointerUp = () => {
    if (drag.current?.moved) setCamSnap(cam.current);
    drag.current = null;
  };
  const wasDrag = () => Boolean(drag.current?.moved);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        // ROTATE MEANS SPIN THE ORBITS. Labels stay upright; a tilted camera
        // (the old rotate) turned every name on the screen sideways.
        setSpin((s) => s + (e.deltaY > 0 ? 0.08 : -0.08));
        return;
      }
      const rect = el.getBoundingClientRect();
      const next = zoomAt(cam.current, e.deltaY > 0 ? 0.9 : 1.1, e.clientX - rect.left, e.clientY - rect.top - barH - inset, W, LH);
      apply(next);
      setCamSnap(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, W, LH, barH, inset]);

  // Escape climbs one level — the popup first, then the restaurant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picked || more) {
        setPicked(null);
        setMore(null);
      } else if (into) setInto(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, more, into]);

  /** Scene → screen, for the HTML cards pinned beside a body. */
  const toScreen = (b: { x: number; y: number }) => {
    const c = camSnap;
    return { x: W / 2 + c.x + c.k * b.x, y: barH + inset + LH / 2 + c.y + c.k * b.y };
  };

  const open = (b: Body) => {
    if (wasDrag()) return;
    if (b.kind === "restaurant") setInto(b.id);
    else if (b.kind === "area") setPicked((cur) => (cur?.id === b.id ? null : b));
    else if (b.kind === "more") setMore(b);
  };

  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const hovered = hover ? L.bodies.find((b) => b.id === hover) ?? null : null;

  return (
    <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-shell">
      <style>{STYLES}</style>

      {/* ── one top bar: the way out, where you are, and the headline ───── */}
      <div
        ref={barRef}
        className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/60 bg-paper/70 px-3 py-1 backdrop-blur-md"
        style={{ minHeight: BAR }}
      >
        <Link
          href="/control-room"
          className="mise-press rounded-lg px-2 py-1 text-xs font-semibold text-fg-soft hover:text-fg"
        >
          ‹ Control Room
        </Link>
        <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => setInto(null)}
            className={`mise-press truncate font-semibold ${into ? "text-fg-soft hover:text-fg" : "text-fg"}`}
          >
            DineAI
          </button>
          {restaurant && (
            <>
              <span className="text-fg-faint">›</span>
              <span className="truncate font-semibold text-fg">{restaurant.label}</span>
            </>
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {right}
          <button
            type="button"
            onClick={fit}
            title="Fit everything back on screen"
            aria-label="Fit to screen"
            className="mise-press grid h-8 w-8 place-items-center rounded-lg border border-line text-sm text-fg-soft hover:text-fg"
          >
            ⤢
          </button>
        </div>
      </div>

      {/* On a phone the ring names live here, innermost first. */}
      {L.portrait && (
        <div
          className="pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 gap-3 whitespace-nowrap rounded-full bg-paper/80 px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-fg-faint backdrop-blur"
          style={{ top: barH + (restaurant ? 52 : 10) }}
        >
          {L.rings.map((r) => (
            <span key={r.key}>
              {r.label} {r.count}
            </span>
          ))}
        </div>
      )}

      {/* ── the doors out of a restaurant, when you are inside one ───────── */}
      {restaurant && (
        <div className="absolute right-3 z-10 flex flex-wrap justify-end gap-2" style={{ top: barH + 12 }}>
          {[
            ["Activity", `/control-room/hotels/${restaurant.id}/activity`],
            ["AI chats", `/control-room/hotels/${restaurant.id}/ai`],
            ["Access & settings", `/control-room/hotels/${restaurant.id}/settings`],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="mise-press rounded-full border border-line bg-paper/80 px-3 py-1.5 text-xs font-medium text-fg-soft backdrop-blur hover:text-fg"
            >
              {label} ↗
            </Link>
          ))}
        </div>
      )}

      <svg
        width={W}
        height={H}
        className="absolute left-0 block touch-none select-none"
        style={{ top: barH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={restaurant ? `${restaurant.label} and the parts of DineAI it uses` : "Every restaurant on DineAI"}
      >
        <defs>
          <radialGradient id="ob-glass" cx="35%" cy="30%" r="75%">
            <stop offset="0%" style={{ stopColor: "var(--color-brand-300)", stopOpacity: 0.95 }} />
            <stop offset="55%" style={{ stopColor: "var(--color-brand-600)", stopOpacity: 0.9 }} />
            <stop offset="100%" style={{ stopColor: "var(--color-brand-900)", stopOpacity: 0.95 }} />
          </radialGradient>
          <radialGradient id="ob-glass-grey" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#1e293b" stopOpacity={0.9} />
          </radialGradient>
          <radialGradient id="ob-core" cx="40%" cy="35%" r="70%">
            <stop offset="0%" style={{ stopColor: "var(--color-brand-200)" }} />
            <stop offset="60%" style={{ stopColor: "var(--color-brand-500)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-brand-800)" }} />
          </radialGradient>
          <filter id="ob-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="ob-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" strokeOpacity="0.25" strokeWidth="2" />
          </pattern>
        </defs>

        <g transform={`translate(0 ${inset})`}>
        <g ref={sceneRef} transform={toTransform(HOME, W, LH)}>
          {/* ── the orbits, labelled in words ─────────────────────────── */}
          {L.rings.map((ring, i) => (
            <g key={ring.key} className="ob-ring" style={{ animationDelay: `${i * 120}ms` }}>
              <ellipse
                rx={ring.rx}
                ry={ring.ry}
                fill="none"
                stroke="var(--color-fg-faint)"
                strokeOpacity={0.22}
                strokeDasharray="2 6"
              />
              {!L.portrait && (
                <text
                  y={-ring.ry - 9}
                  textAnchor="middle"
                  className="fill-fg-faint"
                  style={{ fontSize: 10.5, letterSpacing: "0.22em", fontWeight: 600 }}
                >
                  {ring.label} · {ring.count}
                </text>
              )}
            </g>
          ))}

          {/* ── spokes, and a pulse along each one that is alive ───────── */}
          {L.bodies
            .filter((b) => b.ring >= 0 && b.kind !== "more")
            .map((b) => {
              const lit = hover === b.id;
              const dim = hover && !lit;
              return (
                <g key={`spoke-${b.id}`} opacity={dim ? 0.25 : 1}>
                  <path
                    id={`ob-path-${cssId(b.id)}`}
                    d={`M0 0 L${b.x} ${b.y}`}
                    stroke={lit ? "var(--color-brand-300)" : "var(--color-brand-400)"}
                    strokeOpacity={lit ? 0.7 : b.idle ? 0.06 : 0.16}
                    strokeWidth={lit ? 1.6 : 1}
                  />
                  {!reduced && !b.idle && b.load > 0 && (
                    // A PULSE IS REAL TRAFFIC. It only runs on something that
                    // was used, and busier bodies pulse faster — the one kind
                    // of movement he praised in every earlier version.
                    <circle r={2.2} className="fill-brand-200">
                      <animateMotion
                        dur={`${Math.max(1.4, 4.2 - Math.log10(b.load + 1))}s`}
                        repeatCount="indefinite"
                        rotate="auto"
                      >
                        <mpath href={`#ob-path-${cssId(b.id)}`} />
                      </animateMotion>
                    </circle>
                  )}
                </g>
              );
            })}

          {/* ── the core ─────────────────────────────────────────────── */}
          <g className="ob-pop">
            <circle r={L.core.r + 14} fill="var(--color-brand-500)" opacity={0.08} />
            <circle r={L.core.r} fill="url(#ob-core)" filter="url(#ob-glow)" />
            <text textAnchor="middle" y={-2} className="fill-white" style={{ fontSize: 15, fontWeight: 700 }}>
              {clip(L.core.label, 16)}
            </text>
            <text
              textAnchor="middle"
              y={14}
              className="fill-white"
              style={{ fontSize: 10.5, opacity: 0.85, fontFamily: "var(--font-mono, ui-monospace)" }}
            >
              {L.core.sub}
            </text>
          </g>

          {/* ── the bodies ───────────────────────────────────────────── */}
          {L.bodies.map((b, i) => {
            const lit = hover === b.id;
            const dim = hover && !lit;
            // Same rule as the layout's `inside` — the two must agree, or the
            // overlap check reserves room for a plate that is not drawn.
            const nameInside = b.r >= 44 && (b.kind === "restaurant" || b.kind === "area");
            const tone =
              b.kind === "public" || b.kind === "operator" || b.kind === "polling"
                ? "grey"
                : b.kind === "more"
                  ? "grey"
                  : "brand";
            return (
              // OUTER carries position (style transform, animatable).
              <g
                key={b.id}
                style={{
                  transform: `translate(${b.x}px, ${b.y}px)`,
                  transition: reduced ? undefined : "transform 650ms cubic-bezier(0.22,1,0.36,1), opacity 250ms",
                  opacity: dim ? 0.45 : 1,
                }}
              >
                {/* INNER carries the arrival animation. Never on the same
                    element as the position — see the note at the top. */}
                <g
                  className="ob-pop ob-body"
                  style={{ animationDelay: `${Math.min(900, 60 + i * 45)}ms`, cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${b.label}, ${b.sub}`}
                  // ⚠️ HOVER FOLLOWS A MOUSE ONLY. A phone fires "enter" on a
                  // tap and never "leave", so the last restaurant touched
                  // stayed lit, dimmed everything else, and left its card
                  // hanging off the edge — found in the live screenshots.
                  // A finger drills in instead, which is what it wants.
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setHover(b.id);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setHover((h) => (h === b.id ? null : h));
                  }}
                  onClick={() => open(b)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(b);
                    }
                  }}
                >
                  <circle className="ob-focus" r={b.r + 6} fill="none" stroke="var(--color-brand-300)" strokeWidth={2} />
                  {b.idle ? (
                    // Signed up and never used: a hollow dashed ring, never a
                    // big empty sphere pretending to be a restaurant.
                    <circle r={b.r} fill="none" stroke="var(--color-fg-faint)" strokeOpacity={0.6} strokeDasharray="3 4" />
                  ) : (
                    <>
                      {tone === "brand" && lit && (
                        <circle r={b.r + 8} fill="var(--color-brand-400)" opacity={0.18} />
                      )}
                      <circle
                        r={b.r * (lit ? 1.06 : 1)}
                        fill={tone === "brand" ? "url(#ob-glass)" : "url(#ob-glass-grey)"}
                        stroke={tone === "brand" ? "var(--color-brand-300)" : "#94a3b8"}
                        strokeOpacity={0.35}
                      />
                      {(b.kind === "public" || b.kind === "operator" || b.kind === "polling") && (
                        <circle r={b.r} fill="url(#ob-hatch)" />
                      )}
                      {/* WHAT IS REALLY INSIDE IT — its own areas, packed to
                          scale. The old six dots were the same on every
                          bubble; these are not. */}
                      {b.inner.length > 1 &&
                        b.r >= 22 &&
                        packInCircle(b.inner, b.r * 0.78).map((p) => (
                          <circle key={p.id} cx={p.x} cy={p.y} r={Math.max(1.2, p.r - 0.8)} fill="#fff" opacity={0.13} />
                        ))}
                      {/* the specular highlight that makes it glass */}
                      <ellipse cx={-b.r * 0.32} cy={-b.r * 0.42} rx={b.r * 0.36} ry={b.r * 0.2} fill="#fff" opacity={0.28} />
                      {/* AI share, as a violet arc round the rim */}
                      {b.ai > 0 && b.load > 0 && (
                        <circle
                          r={b.r + 3}
                          fill="none"
                          stroke="#a78bfa"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeDasharray={`${Math.max(4, Math.min(1, (b.ai * 8) / b.load) * 2 * Math.PI * (b.r + 3))} 9999`}
                          transform="rotate(-90)"
                        />
                      )}
                      {b.errors > 0 && <circle cx={b.r * 0.72} cy={-b.r * 0.72} r={4.5} fill="#fb7185" stroke="#0a0c10" strokeWidth={1.5} />}
                    </>
                  )}

                  {/* THE NAME, ALWAYS. Inside when it fits, on a plate under
                      it when it does not — never clipped, never missing. */}
                  {nameInside ? (
                    <>
                      <text
                        textAnchor="middle"
                        y={-2}
                        className="pointer-events-none fill-white"
                        // Sized to the sphere, so the biggest name on the map
                        // is not the one that gets clipped ("NIRAI · n…").
                        style={{ fontSize: Math.min(14, Math.max(11, b.r / 4.2)), fontWeight: 650 }}
                      >
                        {clip(b.label, Math.floor(b.r / 3.3))}
                      </text>
                      <text
                        textAnchor="middle"
                        y={13}
                        className="pointer-events-none fill-white"
                        style={{ fontSize: 10.5, opacity: 0.8, fontFamily: "var(--font-mono, ui-monospace)" }}
                      >
                        {b.sub}
                      </text>
                    </>
                  ) : (
                    <>
                      {b.kind === "more" && (
                        <text textAnchor="middle" y={4} className="pointer-events-none fill-fg" style={{ fontSize: 11, fontWeight: 700 }}>
                          {b.label}
                        </text>
                      )}
                      {b.kind !== "more" && (
                        <>
                          <text textAnchor="middle" x={b.dx ?? 0} y={b.r + 14} className="pointer-events-none fill-fg" style={{ fontSize: 12.5, fontWeight: 600 }}>
                            {clip(b.label, 22)}
                          </text>
                          {/* The number, unless the stage is too tight for
                              a second line — then it lives on the hover card
                              and the name keeps its room. */}
                          {!L.compact && (
                            <text
                              textAnchor="middle"
                              x={b.dx ?? 0}
                              y={b.r + 27}
                              className="pointer-events-none fill-fg-faint"
                              style={{ fontSize: 10, fontFamily: "var(--font-mono, ui-monospace)" }}
                            >
                              {b.sub}
                            </text>
                          )}
                        </>
                      )}
                    </>
                  )}
                </g>
              </g>
            );
          })}
        </g>
        </g>
      </svg>

      {/* ── hover card: the numbers that do not fit on the name plate ────── */}
      {hovered && hovered.node && !picked && (
        <HoverCard
          at={toScreen({ x: hovered.x + hovered.r, y: hovered.y - hovered.r })}
          node={hovered.node}
          stageW={W}
        />
      )}

      {/* ── an area, opened: a card pinned beside it, not a modal ───────── */}
      {picked && restaurant && (
        <DoorCard
          at={toScreen({ x: picked.x + picked.r, y: picked.y - picked.r })}
          body={picked}
          restaurant={restaurant}
          onClose={() => setPicked(null)}
          stageW={W}
        />
      )}

      {/* ── "+N more", listed ─────────────────────────────────────────────── */}
      {more && (
        <div className="absolute left-1/2 z-30 w-[min(22rem,92vw)] -translate-x-1/2 rounded-2xl border border-line bg-paper/95 p-3 shadow-2xl backdrop-blur-md" style={{ top: barH + 24 }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">{more.hidden?.length} more on this ring</p>
            <button type="button" onClick={() => setMore(null)} className="mise-press px-2 text-fg-faint hover:text-fg">
              ✕
            </button>
          </div>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {more.hidden?.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMore(null);
                    if (h.kind === "restaurant") setInto(h.id);
                  }}
                  className="mise-press flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-glass/[0.06]"
                >
                  <span className="truncate text-sm text-fg">{h.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-fg-faint">{h.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The four-second hint, once — instead of an instruction pill sitting
          on top of the map for good. */}
      <FirstVisitHint />
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

function HoverCard({
  at,
  node,
  stageW,
}: {
  at: { x: number; y: number };
  node: GraphNode;
  stageW: number;
}) {
  const m = node.metrics ?? {};
  const rows: [string, string][] = [];
  const num = (k: string) => Number(m[k]) || 0;
  if (num("requests")) rows.push(["Requests", num("requests").toLocaleString("en-GB")]);
  if (num("ai_calls")) rows.push(["AI calls", num("ai_calls").toLocaleString("en-GB")]);
  const tokens = num("ai_tokens_in") + num("ai_tokens_out");
  if (tokens) rows.push(["AI tokens", tokens.toLocaleString("en-GB")]);
  if (num("ai_cost_usd")) rows.push(["AI cost", `$${num("ai_cost_usd").toFixed(2)}`]);
  if (num("db_selects") || num("db_writes"))
    rows.push(["Reads · writes", `${num("db_selects").toLocaleString("en-GB")} · ${num("db_writes").toLocaleString("en-GB")}`]);
  if (num("avg_ms")) rows.push(["Average response", `${Math.round(num("avg_ms"))} ms`]);
  if (num("errors_5xx")) rows.push(["Server errors", String(num("errors_5xx"))]);
  if (!rows.length) rows.push(["Activity", "nothing yet"]);
  return (
    <div
      className="pointer-events-none absolute z-20 w-56 rounded-xl border border-line bg-paper/95 p-3 shadow-2xl backdrop-blur-md"
      // Kept ON the stage: beside a body near the right edge it flips to the
      // body's left rather than being cut off by the screen.
      style={{
        left: at.x + 10 + 224 > stageW - 8 ? Math.max(8, at.x - 224 - 70) : Math.max(8, at.x + 10),
        top: Math.max(8, at.y - 8),
      }}
    >
      <p className="truncate text-sm font-semibold text-fg">{node.label}</p>
      <dl className="mt-1.5 space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-xs">
            <dt className="text-fg-faint">{k}</dt>
            <dd className="font-mono tabular-nums text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DoorCard({
  at,
  body,
  restaurant,
  onClose,
  stageW,
}: {
  at: { x: number; y: number };
  body: Body;
  restaurant: GraphNode;
  onClose: () => void;
  stageW: number;
}) {
  const [going, setGoing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const page = body.area ? AREA_PAGE[body.area] : undefined;
  const left = Math.min(stageW - 296, Math.max(8, at.x + 12));
  return (
    <div
      className="absolute z-30 w-72 rounded-2xl border border-line bg-paper/95 p-4 shadow-2xl backdrop-blur-md"
      style={{ left, top: Math.max(60, at.y - 10) }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-faint">{restaurant.label}</p>
          <p className="mt-0.5 truncate font-display text-lg font-semibold text-fg">{body.label}</p>
          <p className="text-xs text-fg-faint">{body.sub} in this period</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="mise-press px-1 text-fg-faint hover:text-fg">
          ✕
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {/* The primary door is the Control Room's OWN view of them — reading
            about a restaurant should not start a session inside it. */}
        <Link
          href={`/control-room/hotels/${restaurant.id}/activity`}
          className="mise-press block w-full rounded-xl bg-brand-600 px-3 py-2.5 text-center text-sm font-semibold text-white"
        >
          Their activity in the Control Room
        </Link>
        {page ? (
          <button
            type="button"
            disabled={going}
            onClick={async () => {
              setGoing(true);
              setErr(null);
              try {
                await openSupportView(restaurant.id, page);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not open their page.");
              } finally {
                setGoing(false);
              }
            }}
            className="mise-press w-full rounded-xl border border-line px-3 py-2 text-left text-xs text-fg-soft hover:text-fg disabled:opacity-40"
          >
            {going ? "Opening…" : `Open their ${body.label} as them`}
            <span className="block text-[10.5px] text-fg-faint">starts a 15-minute, read-only support session</span>
          </button>
        ) : (
          <p className="rounded-xl border border-line px-3 py-2 text-xs text-fg-faint">
            Background traffic with no screen of its own.
          </p>
        )}
        {err && <p className="text-xs text-rose-400">{err}</p>}
      </div>
    </div>
  );
}

function FirstVisitHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("mise.orbit.hint")) return;
      localStorage.setItem("mise.orbit.hint", "1");
    } catch {
      return;
    }
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 4500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-paper/90 px-4 py-1.5 text-xs text-fg-soft shadow-lg backdrop-blur">
      tap a restaurant to go inside · drag to move · scroll to zoom · shift-scroll to spin
    </p>
  );
}

function clip(s: string, n: number): string {
  const max = Math.max(4, n);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** An id safe inside a CSS/SVG `#id` reference. */
function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const STYLES = `
.ob-pop { animation: ob-pop 620ms cubic-bezier(0.2, 0.9, 0.3, 1.25) both; transform-box: fill-box; transform-origin: center; }
@keyframes ob-pop { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
.ob-ring { animation: ob-ring 900ms ease-out both; }
@keyframes ob-ring { from { opacity: 0; } to { opacity: 1; } }
.ob-body { outline: none; }
.ob-body .ob-focus { opacity: 0; transition: opacity 120ms; }
.ob-body:focus-visible .ob-focus { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .ob-pop, .ob-ring { animation: none; } }
`;
