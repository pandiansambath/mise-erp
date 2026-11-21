"use client";

// Design 6: Blueprint — "Drawn to scale."
//
//   "i love the new designs so i need more n more… think deeply"
//
// He is a System Engineer, so this design draws him the way engineers draw
// systems: as a set of drawing sheets on blueprint paper.
//   · a drawing frame with zone letters, a title block that is a live
//     record (today's date, revision = his day number), a dimension line
//     that measures his career to the second;
//   · his career as a system diagram: every station a component, orthogonal
//     pipes between them, plotted by a pen head as it comes into view, then
//     data packets flowing through it for as long as you look;
//   · his skills as a bill of materials, DineAI as a cross-section of its
//     layers, the honours as the drawing's general notes, contacts as the
//     approvals table, the album as the photographic record;
//   · on a desktop, CAD crosshairs follow the pointer with a live readout.
// Phones get the same sheets, stacked; the diagram turns into a single column.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CAREER_START, EMAIL, LINKS, elapsed, useDev } from "./context";
import { PORTRAITS, ResumeActions, kindGlyph, kindRole, stations, type Station } from "./designKit";
import { Wave } from "./flourish";
import { PROJECT, VOLUNTEERING, honours } from "./profile";
import { CLUSTERS, EDUCATION } from "./skills";

const MONO = "font-mono uppercase tracking-[0.16em]";
const LINE = "color-mix(in srgb, var(--d-b) 42%, transparent)";
const FAINT = "color-mix(in srgb, var(--d-b) 18%, transparent)";

function useInView<T extends Element>(margin = "-12% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen] as const;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// ── The paper and the pointer ───────────────────────────────────────────────

/** CAD crosshairs and a coordinate readout, desktop only. DOM writes, no re-render. */
function Crosshair() {
  const v = useRef<HTMLDivElement>(null);
  const h = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      raf = 0;
      if (v.current) v.current.style.transform = `translateX(${x}px)`;
      if (h.current) h.current.style.transform = `translateY(${y}px)`;
      if (tag.current) {
        tag.current.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
        tag.current.textContent = `X ${pad(Math.round(x), 4)}  Y ${pad(Math.round(y + window.scrollY), 5)}`;
      }
    };
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      for (const el of [v.current, h.current, tag.current]) if (el) el.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => {
      for (const el of [v.current, h.current, tag.current]) if (el) el.style.opacity = "0";
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);
  const line = "pointer-events-none absolute opacity-0 transition-opacity duration-300";
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden motion-reduce:hidden">
      <div ref={v} className={`${line} inset-y-0 left-0 w-px`} style={{ background: FAINT }} />
      <div ref={h} className={`${line} inset-x-0 top-0 h-px`} style={{ background: FAINT }} />
      <span ref={tag} className={`${line} left-0 top-0 whitespace-pre font-mono text-[9.5px] tracking-[0.12em] text-[var(--d-b2)]`} />
    </div>
  );
}

/** One drawing sheet: a frame that draws itself, zone letters, a sheet strip. */
function Sheet({ no, of, title, children, className = "" }: { no: number; of: number; title: string; children: ReactNode; className?: string }) {
  const [ref, seen] = useInView<HTMLElement>("-8% 0px");
  return (
    <section ref={ref} className={`relative mt-10 px-4 pb-6 pt-10 sm:mt-14 sm:px-10 sm:pb-10 sm:pt-12 ${className}`}>
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <rect
          x="0.5"
          y="0.5"
          width="99.6%"
          height="99.6%"
          fill="none"
          stroke={LINE}
          strokeWidth="1.2"
          pathLength={1}
          strokeDasharray="1"
          style={{ strokeDashoffset: seen ? 0 : 1, transition: "stroke-dashoffset 1.8s cubic-bezier(.6,.1,.2,1)" }}
        />
      </svg>
      {/* Zone letters along the top edge, as on every real drawing. */}
      <div aria-hidden className={`pointer-events-none absolute inset-x-6 top-1.5 flex justify-between ${MONO} text-[8.5px] text-[var(--d-ink6)]`}>
        {["A", "B", "C", "D", "E", "F"].map((z) => (
          <span key={z}>{z}</span>
        ))}
      </div>
      <header className={`absolute left-4 right-4 top-5 flex items-center justify-between gap-3 sm:left-10 sm:right-10 ${MONO} text-[9.5px] text-[var(--d-b2)]`}>
        <span className="truncate">
          SHEET {no}/{of} — <Wave text={title} />
        </span>
        <span className="shrink-0 text-[var(--d-ink5)]">DWG PS-{pad(no, 3)}</span>
      </header>
      <div className="relative">{children}</div>
    </section>
  );
}

/** A dimension line: extension ticks, arrowheads, the measurement in the gap. */
function Dimension({ value, label }: { value: ReactNode; label: string }) {
  const arrow = "h-0 w-0 border-y-[4px] border-y-transparent";
  return (
    <div className="mt-6">
      <div className="flex items-center" style={{ color: "var(--d-b2)" }}>
        <span className="h-4 w-px" style={{ background: LINE }} />
        <span className={`${arrow} border-r-[9px]`} style={{ borderRightColor: "var(--d-b2)" }} />
        <span className="h-px flex-1" style={{ background: "var(--d-b2)" }} />
        <span className="px-3 font-mono text-[13px] tabular-nums tracking-[0.08em] text-[var(--d-ink)] sm:text-[15px]">{value}</span>
        <span className="h-px flex-1" style={{ background: "var(--d-b2)" }} />
        <span className={`${arrow} border-l-[9px]`} style={{ borderLeftColor: "var(--d-b2)" }} />
        <span className="h-4 w-px" style={{ background: LINE }} />
      </div>
      <p className={`mt-1.5 text-center ${MONO} text-[9px] text-[var(--d-ink5)]`}>{label}</p>
    </div>
  );
}

// ── Sheet 2: the system diagram ─────────────────────────────────────────────

type Geo = { d: string; w: number; h: number };

function Node({ s, i, seen, setRef }: { s: Station; i: number; seen: boolean; setRef: (el: HTMLDivElement | null) => void }) {
  const role = kindRole(s.kind);
  return (
    <div
      ref={setRef}
      className="group relative z-10 rounded-lg border bg-[var(--d-bg)] p-3.5 transition duration-500 hover:-translate-y-1 hover:shadow-[0_18px_40px_-20px_var(--d-b)] sm:p-4"
      style={{
        borderColor: `color-mix(in srgb, var(--d-${role}) 55%, transparent)`,
        opacity: seen ? 1 : 0,
        transform: seen ? undefined : "translateY(10px)",
        transition: `opacity .6s ${0.25 + i * 0.12}s, transform .6s ${0.25 + i * 0.12}s, box-shadow .4s, translate .4s`,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md border text-[17px]"
          style={{ borderColor: `var(--d-${role})`, color: `var(--d-${role})`, background: `color-mix(in srgb, var(--d-${role}) 12%, transparent)` }}
        >
          {kindGlyph(s.kind)}
        </span>
        <div className="min-w-0">
          <p className={`${MONO} text-[9.5px]`} style={{ color: `var(--d-${role})` }}>
            C-{pad(i + 1)} · {s.when}
          </p>
          <p className={`mt-0.5 text-[14.5px] font-semibold leading-snug ${s.kind === "recognition" ? "dev-gold" : "text-[var(--d-ink)]"}`}>{s.title}</p>
        </div>
      </div>
      {s.promoted && <p className={`mt-2 inline-block rounded border px-1.5 py-0.5 ${MONO} text-[9px] text-[var(--d-b2)]`} style={{ borderColor: LINE }}>GRADE · {s.promoted}</p>}
      {s.note && <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--d-ink4)]">{s.note}</p>}
      {/* The component's ports, where the pipes connect. */}
      <span aria-hidden className="absolute -left-[5px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border bg-[var(--d-bg)]" style={{ borderColor: LINE }} />
      <span aria-hidden className="absolute -right-[5px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border bg-[var(--d-bg)]" style={{ borderColor: LINE }} />
    </div>
  );
}

function SystemDiagram({ list }: { list: Station[] }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const path = useRef<SVGPathElement>(null);
  const head = useRef<SVGAnimateMotionElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [len, setLen] = useState(0);
  const [seenRef, seen] = useInView<HTMLDivElement>("-18% 0px");
  const [flowing, setFlowing] = useState(false);

  // Route the pipes between the measured components: along a row, straight
  // across; to the next row, down to the gap, across, and down again.
  const route = useCallback(() => {
    const b = box.current;
    if (!b) return;
    const o = b.getBoundingClientRect();
    const r = nodes.current.filter(Boolean).map((n) => {
      const q = n!.getBoundingClientRect();
      return { l: q.left - o.left, r: q.right - o.left, t: q.top - o.top, b: q.bottom - o.top, cx: q.left - o.left + q.width / 2, cy: q.top - o.top + q.height / 2 };
    });
    if (r.length < 2) return;
    let d = `M ${r[0].l - 28} ${r[0].cy} H ${r[0].l}`;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const c = r[i + 1];
      if (Math.abs(a.t - c.t) < 6) d += ` M ${a.r} ${a.cy} H ${c.l}`;
      else {
        const gy = (a.b + c.t) / 2;
        d += ` M ${a.cx} ${a.b} V ${gy} H ${c.cx} V ${c.t}`;
      }
    }
    const z = r[r.length - 1];
    d += ` M ${z.r} ${z.cy} H ${z.r + 28}`;
    setGeo({ d, w: o.width, h: o.height });
  }, []);

  useEffect(() => {
    const b = box.current;
    if (!b) return;
    route();
    const ro = new ResizeObserver(route);
    ro.observe(b);
    return () => ro.disconnect();
  }, [route, list.length]);

  useEffect(() => {
    if (path.current && geo) setLen(path.current.getTotalLength());
  }, [geo]);

  // When it comes into view: the pen head plots the pipes, then data flows.
  useEffect(() => {
    if (!seen || !len) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFlowing(false);
      return;
    }
    head.current?.beginElement();
    const t = setTimeout(() => setFlowing(true), 2600);
    return () => clearTimeout(t);
  }, [seen, len]);

  return (
    <div ref={seenRef}>
      <div ref={box} className="relative grid grid-cols-[minmax(0,1fr)] gap-y-10 py-2 sm:grid-cols-2 sm:gap-x-16 sm:gap-y-12 lg:grid-cols-3">
        {geo && (
          <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={geo.w} height={geo.h}>
            <path d={geo.d} fill="none" stroke={FAINT} strokeWidth="6" strokeLinecap="round" />
            <path
              ref={path}
              d={geo.d}
              fill="none"
              stroke="var(--d-b2)"
              strokeWidth="1.6"
              strokeDasharray={len ? `${len}` : undefined}
              style={{ strokeDashoffset: seen ? 0 : len, transition: "stroke-dashoffset 2.4s cubic-bezier(.55,.1,.25,1)" }}
            />
            {/* The plotter's pen head, riding the line it draws. */}
            <g opacity={seen && !flowing ? 1 : 0} style={{ transition: "opacity .4s" }}>
              <circle r="7" fill="none" stroke="var(--d-a2)" strokeWidth="1.2" />
              <path d="M -12 0 H 12 M 0 -12 V 12" stroke="var(--d-a2)" strokeWidth="1" />
              <animateMotion ref={head} begin="indefinite" dur="2.4s" fill="freeze" path={geo.d} />
            </g>
            {flowing &&
              [0, 1, 2, 3].map((k) => (
                <circle key={k} r="3.2" fill={k % 2 ? "var(--d-a2)" : "var(--d-b2)"} style={{ filter: "drop-shadow(0 0 6px var(--d-b))" }}>
                  <animateMotion dur="9s" begin={`${k * 2.25}s`} repeatCount="indefinite" path={geo.d} />
                </circle>
              ))}
          </svg>
        )}
        {list.map((s, i) => (
          <Node key={`${s.when}-${s.title}`} s={s} i={i} seen={seen} setRef={(el) => {
            nodes.current[i] = el;
          }} />
        ))}
      </div>
    </div>
  );
}

// ── Sheet 4: DineAI as a section through its layers ─────────────────────────

const LAYERS = [
  { name: "INTERFACE", parts: "Next.js", hatch: 45 },
  { name: "API", parts: "Python · FastAPI", hatch: -45 },
  { name: "INTELLIGENCE", parts: "Amazon Bedrock", hatch: 0 },
  { name: "DATA", parts: "PostgreSQL", hatch: 90 },
  { name: "FOUNDATION", parts: "AWS · Terraform", hatch: 30 },
];

function Section() {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
      <div className="relative">
        {LAYERS.map((l, i) => (
          <div key={l.name} className="flex items-center gap-3">
            <div
              className="h-11 flex-1 origin-left border sm:h-12"
              style={{
                borderColor: "var(--d-b2)",
                background: `repeating-linear-gradient(${l.hatch}deg, color-mix(in srgb, var(--d-b) 34%, transparent) 0 1px, transparent 1px 8px)`,
                transform: seen ? "scaleX(1)" : "scaleX(0)",
                // Built from the foundation up.
                transition: `transform .7s ${(LAYERS.length - 1 - i) * 0.16}s cubic-bezier(.2,.8,.2,1)`,
                marginTop: i ? -1 : 0,
              }}
            />
            <span className="h-px w-6 shrink-0 sm:w-10" style={{ background: LINE }} />
            <span className="w-32 shrink-0 sm:w-40">
              <span className={`block ${MONO} text-[9px] text-[var(--d-ink5)]`}>{l.name}</span>
              <span className="block text-[13px] font-semibold text-[var(--d-ink)]">{l.parts}</span>
            </span>
          </div>
        ))}
        <p className={`mt-3 ${MONO} text-[9px] text-[var(--d-ink5)]`}>SECTION B–B · NOT TO SCALE</p>
      </div>
      <div>
        <p className={`${MONO} text-[10px] text-[var(--d-a2)]`}>{PROJECT.slogan}</p>
        <h3 className="mt-2 font-display text-[clamp(1.8rem,4vw,2.8rem)] font-semibold leading-none tracking-tight">
          <Wave text={PROJECT.name} />
        </h3>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--d-ink3)]">{PROJECT.pitch}</p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--d-ink4)]">{PROJECT.honesty}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className={`rounded border px-3 py-2 ${MONO} text-[10px] text-[var(--d-ink)] transition hover:bg-[var(--d-b)]/10`} style={{ borderColor: "var(--d-b2)" }}>
            Live site ↗
          </a>
          <a href={PROJECT.inUse.href} target="_blank" rel="noopener noreferrer" className={`rounded border px-3 py-2 ${MONO} text-[10px] text-[var(--d-ink2)] transition hover:bg-[var(--d-b)]/10`} style={{ borderColor: LINE }}>
            In use · {PROJECT.inUse.label} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// ── The design ──────────────────────────────────────────────────────────────

export function BlueprintDesign() {
  const { entered, now, milestones, photos, openAlbum, toast } = useDev();
  const exp = now ? elapsed(CAREER_START, now) : null;
  const list = stations(milestones, now);
  const awards = honours(milestones);
  const today = now ? now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).toUpperCase() : "—";
  const [skillsRef, skillsSeen] = useInView<HTMLDivElement>();

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast(`Copied ${EMAIL}`);
    } catch {
      window.location.href = LINKS.email;
    }
  };

  const cell = "border p-2.5 sm:p-3";
  const cellStyle = { borderColor: LINE };
  const k = `block ${MONO} text-[8.5px] text-[var(--d-ink5)]`;

  return (
    <main
      className="relative z-10 min-h-screen overflow-x-clip pb-12 pt-[4.5rem] sm:pt-24"
      style={{
        // Blueprint paper: a fine grid, a major grid every five squares.
        backgroundImage: `linear-gradient(${FAINT} 1px, transparent 1px), linear-gradient(90deg, ${FAINT} 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--d-b) 7%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--d-b) 7%, transparent) 1px, transparent 1px)`,
        backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px",
        backgroundPosition: "-1px -1px",
      }}
    >
      <Crosshair />
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-6">
        {/* Sheet 1 — general arrangement: who, and how long, measured live. */}
        <Sheet no={1} of={4} title="GENERAL ARRANGEMENT" className="!mt-2">
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:gap-12">
            <button type="button" onClick={openAlbum} className="group relative mx-auto block w-48 sm:w-56" aria-label="Open the photo album">
              {/* Detail circle, with crosshair ticks and its label. */}
              <span className="absolute -inset-4 rounded-full border border-dashed transition duration-700 group-hover:rotate-45" style={{ borderColor: LINE }} />
              {[0, 90, 180, 270].map((deg) => (
                <span key={deg} aria-hidden className="absolute left-1/2 top-1/2 h-px w-[calc(50%+2rem)] origin-left" style={{ transform: `rotate(${deg}deg)`, background: `linear-gradient(90deg, transparent 82%, ${LINE} 82%)` }} />
              ))}
              <img
                src={PORTRAITS[0]}
                alt="Pandian Sambath"
                className="relative aspect-square w-full rounded-full object-cover grayscale-[35%] transition duration-700 group-hover:grayscale-0"
                style={{ opacity: entered ? 1 : 0, transition: "opacity .9s .2s, filter .7s" }}
              />
              <span className={`absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap ${MONO} text-[9px] text-[var(--d-b2)]`}>DETAIL A · TAP FOR THE ALBUM</span>
            </button>
            <div className="mt-6 min-w-0 md:mt-0">
              <p className={`${MONO} text-[10px] text-[var(--d-a2)]`}>Drawn to scale</p>
              <h1 className="mt-2 font-display text-[clamp(2.4rem,7vw,4.6rem)] font-semibold leading-[0.95] tracking-tight text-[var(--d-ink)]">
                <Wave text="Pandian Sambath" />
              </h1>
              <p className="mt-3 text-[15px] text-[var(--d-ink2)]">
                System Engineer <span className="text-[var(--d-ink5)]">at</span> <span className="text-[var(--d-a2)]">Tata Consultancy Services</span>
              </p>
              <p className="mt-1 text-[13px] text-[var(--d-ink4)]">Python, AWS and Generative AI · Chennai, India</p>
              <Dimension
                value={exp ? `${exp.years} YRS ${exp.months} MO ${exp.days} D` : "—"}
                label={exp ? `CAREER LENGTH · DAY ${exp.dayNumber.toLocaleString("en-US")} · ${pad(exp.hours)}:${pad(exp.minutes)}:${pad(exp.seconds)} UTC · MEASURED LIVE` : "CAREER LENGTH"}
              />
            </div>
          </div>

          {/* The title block: the drawing's own record, kept live. */}
          <div className="mt-12 grid grid-cols-2 text-[12px] sm:ml-auto sm:max-w-xl sm:grid-cols-4">
            <div className={`${cell} col-span-2 sm:col-span-4`} style={cellStyle}>
              <span className={k}>Project</span>
              <span className="font-display text-[20px] font-semibold text-[var(--d-ink)]">Pandian Sambath</span>
            </div>
            <div className={`${cell} col-span-2`} style={cellStyle}>
              <span className={k}>Discipline</span>System Engineer · TCS
            </div>
            <div className={cell} style={cellStyle}>
              <span className={k}>Drawn</span>Chennai
            </div>
            <div className={cell} style={cellStyle}>
              <span className={k}>Date</span>
              <span className="tabular-nums">{today}</span>
            </div>
            <div className={cell} style={cellStyle}>
              <span className={k}>Scale</span>1 : 1
            </div>
            <div className={cell} style={cellStyle}>
              <span className={k}>Sheets</span>4
            </div>
            <div className={cell} style={cellStyle}>
              <span className={k}>Rev</span>
              <span className="tabular-nums">{exp ? exp.dayNumber.toLocaleString("en-US") : "—"}</span>
            </div>
            <div className={cell} style={cellStyle}>
              <span className={k}>Status</span>
              <span className="inline-flex items-center gap-1.5 text-[var(--d-b2)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--d-b2)] motion-safe:animate-pulse" />
                In service
              </span>
            </div>
          </div>
        </Sheet>

        {/* Sheet 2 — the system: his path as components and pipes. */}
        <Sheet no={2} of={4} title="SYSTEM DIAGRAM">
          <p className="mb-8 max-w-xl text-[13.5px] leading-relaxed text-[var(--d-ink3)]">
            Every station is a component; every year, a pipe. Watch it plot, then watch the data move.
          </p>
          <SystemDiagram list={list} />
        </Sheet>

        {/* Sheet 3 — bill of materials. */}
        <Sheet no={3} of={4} title="BILL OF MATERIALS">
          <div ref={skillsRef} className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
            {CLUSTERS.map((c, ci) => (
              <div key={c.key} className="border" style={{ borderColor: LINE }}>
                <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: LINE }}>
                  <span className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: c.hue }}>
                    <span aria-hidden>{c.glyph}</span>
                    <Wave text={c.label} />
                  </span>
                  <span className={`${MONO} text-[9px] text-[var(--d-ink5)]`}>{c.items.length} parts</span>
                </div>
                <ul className="grid grid-cols-2">
                  {c.items.map((item, ii) => (
                    <li
                      key={item}
                      className="flex min-w-0 items-baseline gap-2 border-b border-r px-3 py-1.5 text-[12.5px] text-[var(--d-ink2)] transition-colors hover:bg-[var(--d-b)]/10 [&:nth-child(2n)]:border-r-0"
                      style={{
                        borderColor: FAINT,
                        opacity: skillsSeen ? 1 : 0,
                        transform: skillsSeen ? "none" : "translateX(-6px)",
                        transition: `opacity .4s ${ci * 0.1 + ii * 0.03}s, transform .4s ${ci * 0.1 + ii * 0.03}s`,
                      }}
                    >
                      <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--d-ink6)]">
                        {c.key.slice(0, 3).toUpperCase()}-{pad(ii + 1)}
                      </span>
                      <span className="truncate">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Sheet>

        {/* Sheet 4 — his own product, the notes, and the approvals. */}
        <Sheet no={4} of={4} title="SECTION B–B: DINEAI">
          <Section />

          <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
            <div>
              <p className={`${MONO} text-[10px] text-[var(--d-b2)]`}>General notes</p>
              <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-[var(--d-ink3)]">
                <li className="flex gap-3">
                  <span className="font-mono text-[var(--d-ink5)]">1.</span>
                  <span>
                    <span className="dev-gold font-semibold">{EDUCATION.honour}</span> — {EDUCATION.degree}, {EDUCATION.percentage}.{" "}
                    <a href={EDUCATION.verifyUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--d-b2)] underline decoration-dotted underline-offset-4">
                      Verify ↗
                    </a>
                  </span>
                </li>
                {awards.map((m, i) => (
                  <li key={`${m.when}-${m.title}`} className="flex gap-3">
                    <span className="font-mono text-[var(--d-ink5)]">{i + 2}.</span>
                    <span>
                      <span className="text-[var(--d-ink)]">{m.title}</span> <span className="font-mono text-[11px] text-[var(--d-ink5)]">· {m.when}</span>
                    </span>
                  </li>
                ))}
                <li className="flex gap-3">
                  <span className="font-mono text-[var(--d-ink5)]">{awards.length + 2}.</span>
                  <span>Volunteers with {VOLUNTEERING.map((v) => v.org).join(", ")}.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[var(--d-ink5)]">{awards.length + 3}.</span>
                  <span className={`${MONO} text-[11px] text-[var(--d-a2)]`}>All dimensions are live. Do not scale.</span>
                </li>
              </ol>
            </div>

            <div>
              <p className={`${MONO} text-[10px] text-[var(--d-b2)]`}>Approvals</p>
              <div className="mt-3 border text-[13px]" style={{ borderColor: LINE }}>
                {[
                  { k: "Email", node: <button type="button" onClick={copyEmail} className="text-left text-[var(--d-ink)] hover:text-[var(--d-b2)]">{EMAIL} <span className="text-[var(--d-ink5)]">· copy</span></button> },
                  { k: "LinkedIn", node: <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className="text-[var(--d-ink)] hover:text-[var(--d-b2)]">in/pandiansambath ↗</a> },
                  { k: "GitHub", node: <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className="text-[var(--d-ink)] hover:text-[var(--d-b2)]">pandiansambath ↗</a> },
                  { k: "Instagram", node: <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" className="text-[var(--d-ink)] hover:text-[var(--d-b2)]">pandian.sambath ↗</a> },
                ].map((row) => (
                  <div key={row.k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] border-b last:border-b-0" style={{ borderColor: LINE }}>
                    <span className={`border-r px-3 py-2.5 ${MONO} text-[9px] text-[var(--d-ink5)]`} style={{ borderColor: LINE }}>
                      {row.k}
                    </span>
                    <span className="min-w-0 truncate px-3 py-2.5">{row.node}</span>
                  </div>
                ))}
              </div>
              <ResumeActions
                className="mt-4"
                button={`rounded border px-3 py-2 ${MONO} text-[10px] text-[var(--d-ink)] transition hover:bg-[var(--d-b)]/10 [border-color:var(--d-b2)]`}
              />
            </div>
          </div>

          {/* The photographic record. */}
          {photos.length > 0 && (
            <div className="mt-12">
              <p className={`${MONO} text-[10px] text-[var(--d-b2)]`}>Photographic record · {photos.length} plates</p>
              <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
                {photos.slice(0, 6).map((p, i) => (
                  <button key={p.id} type="button" onClick={openAlbum} className="group relative block" aria-label="Open the photo album">
                    <img src={`/api/dev-site/thumb/${p.id}.webp`} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover grayscale-[50%] transition duration-500 group-hover:grayscale-0" style={{ background: `url(${p.lqip}) center/cover` }} />
                    {/* Crop marks. */}
                    <span aria-hidden className="absolute -left-1 -top-1 h-3 w-3 border-l border-t" style={{ borderColor: "var(--d-b2)" }} />
                    <span aria-hidden className="absolute -bottom-1 -right-1 h-3 w-3 border-b border-r" style={{ borderColor: "var(--d-b2)" }} />
                    <span className={`mt-1 block ${MONO} text-[8.5px] text-[var(--d-ink5)]`}>Plate {pad(i + 1)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Sheet>

        <p className={`mt-8 text-center ${MONO} text-[9px] text-[var(--d-ink6)]`}>
          © {now ? now.getFullYear() : ""} Pandian Sambath · Chennai, India · this page was built with AI-assisted development
        </p>
      </div>
    </main>
  );
}
