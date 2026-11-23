"use client";

// The name's area, nine other ways (§102.2; plates.ts names them). Each is the
// whole area, not a recoloured name: its own greeting, its own setting for the
// role and company, its own way of giving the place and the time. They hold
// about the classic's height, so the orbit under them stays where it was.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { chennaiTime, useDev, useNow } from "./context";
import { nameLook, word } from "./copy";
import { PlateBoard } from "./PlateBoard";
import { PlateName } from "./PlateName";
import { ARTS } from "./plateArt";
import { measure, type Geo } from "./plateKit";
import type { PlateId } from "./plates";
import { plateFade } from "./Nameplate";
import { THEME_EVENT } from "./theme";

const SIZE = "text-[clamp(2.4rem,6vw,3.9rem)] font-semibold leading-[1.06] tracking-tight";

function useWords() {
  const { copy } = useDev();
  return {
    font: nameLook(copy.style).fontClass,
    name: word(copy, "name"),
    hello: word(copy, "hello"),
    role: word(copy, "role"),
    at: word(copy, "at"),
    company: word(copy, "company"),
    place: word(copy, "place"),
  };
}
/** Only what shows the time re-renders each second. */
function Clock({ className = "", seconds = false }: { className?: string; seconds?: boolean }) {
  const now = useNow();
  return <span className={`tabular-nums ${className}`}>{now ? `${seconds ? timeParts(now).full : chennaiTime(now)} IST` : " "}</span>;
}
function timeParts(now: Date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).formatToParts(now);
  const of = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const h24 = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now);
  return { h24, m: of("minute"), s: of("second"), ap: of("dayPeriod"), full: `${of("hour")}:${of("minute")}:${of("second")} ${of("dayPeriod")}` };
}
const Row = ({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
  <p className={`flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 lg:justify-start ${className}`} style={style}>
    {children}
  </p>
);
type P = { entered: boolean };

/* ── The page's water ── */
function Water({ entered }: P) {
  const w = useWords();
  return (
    <>
      <p style={plateFade(entered, 0.05)}>
        <span className="plate-pill font-mono text-[10px] tracking-[0.3em] text-[var(--d-a2)]">{w.hello}</span>
      </p>
      <div className="mt-2.5" style={plateFade(entered, 0.1)}>
        <PlateName text={w.name} entered={entered} art={ARTS.water.art} pad={ARTS.water.pad} className={`${w.font} ${SIZE}`} hint="Let a drop fall" />
      </div>
      <Row className="mt-11 !gap-x-1.5 text-[12px] sm:!gap-x-2.5 sm:text-[13.5px]" style={plateFade(entered, 0.24)}>
        <span className="plate-pill font-semibold text-[var(--d-ink)]">{w.role}</span>
        <span className="text-[var(--d-ink5)]">{w.at}</span>
        <span className="plate-pill font-semibold text-[var(--d-a2)]">{w.company}</span>
      </Row>
      <Row className="mt-2.5 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)]" style={plateFade(entered, 0.32)}>
        <span>{w.place}</span>
        <span aria-hidden className="text-[var(--d-b)]">≈</span>
        <Clock className="text-[var(--d-ink4)]" />
      </Row>
    </>
  );
}

/* ── Stardust ── */
function Dust({ entered }: P) {
  const w = useWords();
  return (
    <>
      <p className="font-mono text-[11px] tracking-[0.34em] text-[var(--d-gold)]" style={plateFade(entered, 0.05)}>
        <span aria-hidden className="plate-twinkle mr-2">✦</span>
        {w.hello}
        <span aria-hidden className="plate-twinkle ml-2" style={{ animationDelay: "-1.3s" }}>✧</span>
      </p>
      <div className="mt-2">
        <PlateName text={w.name} entered={entered} art={ARTS.dust.art} pad={ARTS.dust.pad} className={`${w.font} ${SIZE}`} hint="Touch it: the dust scatters, and comes home" />
      </div>
      <Row className="mt-8 text-[15px]" style={plateFade(entered, 1.5)}>
        <span className="font-semibold text-[var(--d-ink)]">{w.role}</span>
        <span className="text-[var(--d-ink6)]">{w.at}</span>
        <span className="font-semibold text-[var(--d-a2)]">{w.company}</span>
      </Row>
      <Row className="mt-2 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)]" style={plateFade(entered, 1.8)}>
        <span>{w.place}</span>
        <span aria-hidden className="text-[var(--d-gold)]">·</span>
        <Clock className="text-[var(--d-ink4)]" />
      </Row>
    </>
  );
}

/* ── Forged ── */
function Forge({ entered }: P) {
  const w = useWords();
  return (
    <>
      <p className="font-mono text-[11px] tracking-[0.34em] text-[var(--d-a)]" style={plateFade(entered, 0.05)}>
        {w.hello}
      </p>
      <div className="mt-2">
        <PlateName text={w.name} entered={entered} art={ARTS.forge.art} pad={ARTS.forge.pad} className={`${w.font} ${SIZE}`} hint="Strike it while it is hot" />
      </div>
      <Row className="mt-7 text-[15px]" style={plateFade(entered, 1.3)}>
        <span className="plate-stamped font-semibold">{w.role}</span>
        <span className="text-[var(--d-ink6)]">{w.at}</span>
        <span className="plate-stamped font-semibold">{w.company}</span>
      </Row>
      <Row className="mt-2 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)]" style={plateFade(entered, 1.6)}>
        <span>{w.place}</span>
        <span aria-hidden className="plate-ember" />
        <Clock className="text-[var(--d-ink4)]" />
      </Row>
    </>
  );
}

/* ── Liquid chrome ── */
function Chrome({ entered }: P) {
  const w = useWords();
  return (
    <>
      <p className="font-sans text-[10px] font-medium uppercase tracking-[0.52em] text-[var(--d-ink3)]" style={plateFade(entered, 0.05)}>
        {w.hello}
      </p>
      <div className="mt-2">
        <PlateName text={w.name} entered={entered} art={ARTS.chrome.art} pad={ARTS.chrome.pad} className={`${w.font} ${SIZE}`} hint="Polished: it answers the cursor" />
      </div>
      <Row className="mt-7 text-[11.5px] uppercase tracking-[0.24em]" style={plateFade(entered, 0.8)}>
        <span className="font-semibold text-[var(--d-ink)]">{w.role}</span>
        <span aria-hidden className="h-px w-6 bg-gradient-to-r from-[var(--d-ink6)] to-[var(--d-ink3)]" />
        <span className="sr-only">{w.at}</span>
        <span className="font-semibold text-[var(--d-ink2)]">{w.company}</span>
      </Row>
      <Row className="mt-2.5 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)]" style={plateFade(entered, 1)}>
        <span>{w.place}</span>
        <span aria-hidden className="text-[var(--d-ink6)]">/</span>
        <Clock className="text-[var(--d-ink4)]" />
      </Row>
    </>
  );
}

/* ── Signal ── */
function SignalPlate({ entered }: P) {
  const w = useWords();
  const now = useNow();
  return (
    <>
      <Row className="font-mono text-[10px] tracking-[0.2em] text-[var(--d-ink4)]" style={plateFade(entered, 0.05)}>
        <span className="inline-flex items-center gap-1.5 text-[var(--d-a)]">
          <i aria-hidden className="plate-rec" /> LIVE
        </span>
        <span>{w.hello}</span>
        <span aria-hidden className="plate-bars">
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${-i * 0.37}s` }} />
          ))}
        </span>
      </Row>
      <div className="mt-2">
        <PlateName text={w.name} entered={entered} art={ARTS.signal.art} pad={ARTS.signal.pad} className={`${w.font} ${SIZE}`} hint="Shake the signal" />
      </div>
      <p className="mt-5" style={plateFade(entered, 0.9)}>
        <span className="plate-cc">
          <b>CC</b> {w.role} <em>{w.at}</em> {w.company}
        </span>
      </p>
      <Row className="mt-2.5 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)]" style={plateFade(entered, 1.1)}>
        <span>{w.place}</span>
        <span aria-hidden className="text-[var(--d-ink7)]">▸</span>
        <span className="tabular-nums text-[var(--d-b2)]">{now ? `${timeParts(now).full} IST` : " "}</span>
      </Row>
    </>
  );
}

/* ── Neon sign ── */
function Neon({ entered }: P) {
  const w = useWords();
  const [on, setOn] = useState(true);
  const letters = [...w.name];
  // One letter is never quite steady.
  const bad = Math.max(0, letters.findIndex((c, i) => i > letters.length * 0.55 && c.trim()));
  const words = [...w.name.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: [...w.name.slice(0, m.index)].length }));
  return (
    <div className="plate-neon" data-on={entered && on ? "" : undefined}>
      <span aria-hidden className="plate-neon-wall" />
      <p className="relative">
        <span className="plate-tube plate-tube-b font-mono text-[11px] tracking-[0.34em]">
          {w.hello}
          <i aria-hidden>{w.hello}</i>
        </span>
      </p>
      <h1 className={`relative mt-2 ${w.font} ${SIZE}`} aria-label={w.name}>
        {/* Word by word: a line may break between words, never inside one. */}
        {words.map(({ text, at: from }) => (
          <span key={from} aria-hidden>
            <span className="inline-block whitespace-nowrap">
              {[...text].map((ch, k) => (
                <span key={k} className={`plate-tube plate-tube-a${from + k === bad ? " plate-tube-bad" : ""}`} style={{ "--i": from + k } as CSSProperties}>
                  {ch}
                  <i>{ch}</i>
                </span>
              ))}
            </span>{" "}
          </span>
        ))}
      </h1>
      <span aria-hidden className="plate-neon-line mx-auto lg:mx-0" />
      <Row className="relative mt-4 text-[15px]">
        <span className="plate-tube plate-tube-ink font-semibold">
          {w.role}
          <i aria-hidden>{w.role}</i>
        </span>
        <span className="text-[var(--d-ink6)]">{w.at}</span>
        <span className="plate-tube plate-tube-a plate-tube-fine font-semibold">
          {w.company}
          <i aria-hidden>{w.company}</i>
        </span>
      </Row>
      <Row className="relative mt-2 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)]">
        <span>{w.place}</span>
        <span aria-hidden className="text-[var(--d-ink7)]">·</span>
        <Clock className="text-[var(--d-ink4)]" />
      </Row>
      {/* Its pull chain. */}
      <button type="button" onClick={() => setOn((v) => !v)} aria-pressed={on} aria-label={on ? "Switch the sign off" : "Switch the sign on"} className="plate-pull">
        <svg width="14" height="64" viewBox="0 0 14 64" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx="7" cy={3 + i * 5.4} r="1.6" />
          ))}
          <path d="M3.4 51h7.2l1.2 9.4a1.6 1.6 0 0 1-1.6 1.8H3.8a1.6 1.6 0 0 1-1.6-1.8z" />
        </svg>
      </button>
    </div>
  );
}

/* ── Drafted ── */
function Drafted({ entered }: P) {
  const w = useWords();
  const wrap = useRef<HTMLDivElement>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const head = useRef<SVGGElement>(null);
  const read = useRef<SVGTextElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  useEffect(() => {
    const box = wrap.current;
    const el = h1.current;
    if (!box || !el) return;
    let id = 0;
    const go = () => {
      const phone = window.matchMedia("(max-width: 767px)").matches;
      setGeo(measure(el, box, { x: phone ? 14 : 30, t: phone ? 20 : 26, b: phone ? 24 : 30 }));
    };
    const later = () => {
      window.clearTimeout(id);
      id = window.setTimeout(go, 120);
    };
    const ro = new ResizeObserver(later);
    ro.observe(box);
    window.addEventListener(THEME_EVENT, later);
    void document.fonts.ready.then(go);
    return () => {
      window.clearTimeout(id);
      ro.disconnect();
      window.removeEventListener(THEME_EVENT, later);
    };
  }, [w.name, w.font]);
  // The plotter's head: along the name as it draws, then wherever you point.
  useEffect(() => {
    if (!geo || !entered || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = wrap.current;
    const g = head.current;
    if (!box || !g) return;
    let raf = 0;
    const t0 = performance.now();
    let x = geo.x0;
    let y = geo.base;
    let target: { x: number; y: number } | null = null;
    let visible = true;
    let shown = "";
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = box.getBoundingClientRect();
      target = { x: e.clientX - r.left - geo.left, y: e.clientY - r.top - geo.top0 };
    };
    const onLeave = () => (target = null);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(box);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const t = (now - t0) / 1000;
      const u = Math.min(1, t / 2.6);
      const span = geo.x1 - geo.x0;
      const tx = target ? target.x : u < 1 ? geo.x0 + span * u : geo.x0 + span * (0.5 + 0.5 * Math.sin((t - 2.6) * 0.35 + Math.PI / 2));
      const ty = target ? target.y : u < 1 ? geo.base - geo.cap * (0.5 + 0.5 * Math.sin(t * 22)) : geo.top - 6;
      const k = u < 1 && !target ? 1 : 0.12;
      const nx = x + (tx - x) * k;
      const ny = y + (ty - y) * k;
      if (Math.abs(nx - x) + Math.abs(ny - y) < 0.02) return;
      x = nx;
      y = ny;
      g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      if (read.current) {
        const near = x > geo.W - 96;
        if ((read.current.getAttribute("text-anchor") === "end") !== near) {
          read.current.setAttribute("text-anchor", near ? "end" : "start");
          read.current.setAttribute("x", near ? "-9" : "9");
        }
      }
      const label = `X ${(x - geo.x0).toFixed(1)}  Y ${(geo.base - y).toFixed(1)}`;
      if (label !== shown && read.current) {
        shown = label;
        read.current.textContent = label;
      }
    };
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerleave", onLeave);
    };
  }, [geo, entered]);
  const rounds = geo ? geo.glyphs.filter((l) => /[aeodbpqgcPBDOQCG]/.test(l.ch)).slice(0, geo.phone ? 2 : 4) : [];
  return (
    <div className="plate-drafted" data-go={entered && geo ? "" : undefined}>
      <Row className="font-mono text-[10px] tracking-[0.26em] text-[var(--d-b2)]" style={plateFade(entered, 0.05)}>
        <span>{w.hello}</span>
        <span aria-hidden className="text-[9px] tracking-[0.12em] text-[var(--d-ink4)]">DWG PS-001 · SCALE 1:1</span>
      </Row>
      <div ref={wrap} className="relative mt-3 w-full">
        <h1 ref={h1} className={`${w.font} ${SIZE}`} style={geo ? { color: "transparent", WebkitTextFillColor: "transparent" } : { color: "var(--d-ink)" }}>
          {w.name}
        </h1>
        {geo && (
          <svg aria-hidden className="pointer-events-none absolute overflow-visible" style={{ left: geo.left, top: geo.top0 }} width={geo.W} height={geo.H}>
            <defs>
              <pattern id="plate-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--d-b2)" strokeWidth="1.3" strokeOpacity="0.9" />
              </pattern>
              <marker id="plate-arrow" viewBox="0 0 8 8" refX="7.4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 1.4 8 4 0 6.6z" fill="var(--d-a2)" />
              </marker>
            </defs>
            {/* Guides: the heights a letter is drawn between. */}
            <g className="plate-guides" stroke="var(--d-b)" strokeWidth="0.7" strokeDasharray="7 3 1.5 3" strokeOpacity="0.5">
              {geo.lines.flatMap((l, i) => [
                <line key={`b${i}`} x1={l.x0 - 12} x2={l.x1 + 12} y1={l.base} y2={l.base} />,
                <line key={`c${i}`} x1={l.x0 - 12} x2={l.x1 + 12} y1={l.base - geo.cap} y2={l.base - geo.cap} />,
                <line key={`x${i}`} x1={l.x0 - 6} x2={l.x1 + 6} y1={l.base - geo.cap * 0.69} y2={l.base - geo.cap * 0.69} strokeOpacity="0.28" />,
              ])}
              {rounds.map((l, i) => (
                <circle key={`r${i}`} cx={l.x + l.w / 2} cy={l.y - geo.cap * 0.34} r={Math.min(l.w, geo.cap) * 0.52} fill="none" strokeOpacity="0.42" strokeDasharray="none" />
              ))}
              {rounds.map((l, i) => (
                <path key={`m${i}`} d={`M${l.x + l.w / 2 - 3} ${l.y - geo.cap * 0.34}h6m-3 -3v6`} strokeDasharray="none" strokeOpacity="0.7" />
              ))}
            </g>
            {/* The letters: plotted, then hatched. */}
            <g style={{ font: geo.font }}>
              {geo.glyphs.map((l, i) => (
                <text key={i} x={l.x} y={l.y} className="plate-hatched" fill="url(#plate-hatch)" style={{ animationDelay: `${2.1 + i * 0.03}s` }}>
                  {l.ch}
                </text>
              ))}
              {geo.glyphs.map((l, i) => (
                <text key={i} x={l.x} y={l.y} className="plate-plotted" fill="none" stroke="var(--d-ink)" strokeWidth="1.15" strokeLinejoin="round" style={{ animationDelay: `${0.1 + ((l.x - geo.x0) / (geo.x1 - geo.x0)) * 1.9}s` }}>
                  {l.ch}
                </text>
              ))}
            </g>
            {/* True measurements. */}
            <g className="plate-dims" stroke="var(--d-a2)" strokeWidth="0.8" fill="none">
              <path d={`M${geo.x0} ${geo.base + 5}v15M${geo.x1} ${geo.base + 5}v15`} strokeOpacity="0.6" />
              <line x1={geo.x0 + 1} x2={geo.x1 - 1} y1={geo.base + 15} y2={geo.base + 15} markerStart="url(#plate-arrow)" markerEnd="url(#plate-arrow)" />
              <rect x={(geo.x0 + geo.x1) / 2 - 27} y={geo.base + 9} width="54" height="12" fill="var(--d-bg)" stroke="none" />
              <text x={(geo.x0 + geo.x1) / 2} y={geo.base + 18.5} textAnchor="middle" className="plate-dimtext">
                {(geo.x1 - geo.x0).toFixed(1)}
              </text>
              {!geo.phone && (
                <>
                  <path d={`M${geo.x1 + 3} ${geo.base}h13M${geo.x1 + 3} ${geo.base - geo.cap}h13`} strokeOpacity="0.6" />
                  <line x1={geo.x1 + 11} x2={geo.x1 + 11} y1={geo.base - 1} y2={geo.base - geo.cap + 1} markerStart="url(#plate-arrow)" markerEnd="url(#plate-arrow)" />
                  <text transform={`translate(${geo.x1 + 22} ${geo.base - geo.cap / 2}) rotate(-90)`} textAnchor="middle" className="plate-dimtext">
                    {geo.cap.toFixed(1)}
                  </text>
                </>
              )}
            </g>
            <g ref={head} transform={`translate(${geo.x0} ${geo.base})`} stroke="var(--d-a2)" strokeWidth="0.9">
              <path d="M-11 0h8M3 0h8M0 -11v8M0 3v8" />
              <circle r="2.6" fill="none" />
              <circle r="0.9" fill="var(--d-gold)" stroke="none" />
              <text ref={read} x="9" y="-8" className="plate-dimtext" />
            </g>
          </svg>
        )}
      </div>
      <dl className="plate-titleblock mt-8" style={plateFade(entered, 1.2)}>
        <div>
          <dt>ROLE</dt>
          <dd>{w.role}</dd>
        </div>
        <div className="plate-wide">
          <dt>{w.at.toUpperCase()}</dt>
          <dd className="!text-[var(--d-a2)]">{w.company}</dd>
        </div>
        <div>
          <dt>SITE</dt>
          <dd>{w.place}</dd>
        </div>
        <div>
          <dt>LOCAL TIME</dt>
          <dd>
            <Clock />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ── Departure board ── */
function Board({ entered }: P) {
  const w = useWords();
  const now = useNow();
  const time = now ? timeParts(now) : null;
  const clock = time ? `${time.h24}:${time.m}:${time.s}` : "00:00:00";
  const rows = useMemo(
    () => [
      { text: w.name, kind: "name" as const },
      { text: w.role, kind: "line" as const },
      { text: w.company, kind: "line" as const },
      { text: `${w.place.replace(/,/g, " ·")}  ${clock}`, kind: "small" as const },
    ],
    [w.name, w.role, w.company, w.place, clock],
  );
  return (
    <div style={plateFade(entered, 0.05)}>
      <Row className="mb-1.5 font-mono text-[10px] tracking-[0.3em] text-[var(--d-gold)]">
        <span>{w.hello}</span>
        <span aria-hidden className="plate-rec" />
      </Row>
      <h1 className="sr-only">{w.name}</h1>
      <p className="sr-only">
        {w.role} {w.at} {w.company}, {w.place}
      </p>
      <PlateBoard rows={rows} entered={entered} />
    </div>
  );
}

/* ── Console ── */
function Prompt({ children, live }: { children: ReactNode; live: boolean }) {
  return (
    <p>
      <span className="text-[var(--d-b)]">pandian@chain</span>
      <span className="text-[var(--d-ink5)]">:~$ </span>
      <span className="text-[var(--d-ink2)]">{children}</span>
      {live && <i aria-hidden className="plate-caret" />}
    </p>
  );
}
function Console({ entered }: P) {
  const w = useWords();
  const full = `${w.name}|${w.role}|${w.at}|${w.company}|${w.place}`;
  // Typed on the wall clock, a few letters a tick; whole at once for anyone
  // who asked for less motion, and for the page as it is sent.
  const [n, setN] = useState(9999);
  useEffect(() => {
    if (!entered || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    setN(0);
    const id = window.setInterval(() => {
      const k = Math.floor((performance.now() - t0 - 350) / 26);
      setN(Math.max(0, k));
      if (k > full.length + 90) {
        window.clearInterval(id);
        setN(9999);
      }
    }, 40);
    return () => window.clearInterval(id);
    // Only on entering: editing his words does not type them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered]);
  // Each piece's place in the typing: where it starts, and a pause after it.
  const pieces: [string, number][] = [
    ["whoami", 8],
    [w.name, 12],
    ["cat role.txt", 8],
    [`${w.role} ${w.at} ${w.company}`, 10],
    ["date", 8],
  ];
  const starts = pieces.map((_, i) => pieces.slice(0, i).reduce((sum, [text, after]) => sum + text.length + after, 0));
  const [c1, name, c2, line, c3] = pieces.map(([text], i) => text.slice(0, Math.max(0, n - starts[i])));
  const done = n >= starts[4] + 12;
  const roleLen = w.role.length;
  const atEnd = roleLen + 1 + w.at.length + 1;
  return (
    <div className="plate-console" style={plateFade(entered, 0.05)}>
      <div className="plate-console-bar">
        <i />
        <i />
        <i />
        <span>{w.hello}</span>
      </div>
      <div className="plate-console-body">
        <Prompt live={!done && name.length === 0}>{c1}</Prompt>
        <h1 aria-label={w.name} className="relative font-mono text-[clamp(1.5rem,4.2vw,2.5rem)] font-semibold leading-[1.2] tracking-tight text-[var(--d-ink)]">
          {/* Its full width from the start: nothing below moves as it types. */}
          <span aria-hidden className="invisible">{w.name}</span>
          <span aria-hidden className="absolute inset-0">
            {name}
            {!done && name.length > 0 && c2.length === 0 && <i className="plate-caret plate-caret-big" />}
          </span>
        </h1>
        <Prompt live={!done && name.length > 0 && c2.length > 0 && line.length === 0}>{c2}</Prompt>
        <p className="min-h-[1.35em]">
          <span className="font-semibold text-[var(--d-ink)]">{line.slice(0, roleLen)}</span>
          <span className="text-[var(--d-ink5)]">{line.slice(roleLen, atEnd)}</span>
          <span className="font-semibold text-[var(--d-a2)]">{line.slice(atEnd)}</span>
        </p>
        <Prompt live={!done && line.length > 0}>{c3}</Prompt>
        <p className="min-h-[1.35em] text-[var(--d-ink4)]">
          {done && (
            <>
              {w.place} · <Clock seconds />
              <i aria-hidden className="plate-caret" />
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const DESIGNS: Record<Exclude<PlateId, "classic">, (p: P) => ReactNode> = {
  water: Water,
  dust: Dust,
  forge: Forge,
  chrome: Chrome,
  neon: Neon,
  drafted: Drafted,
  signal: SignalPlate,
  board: Board,
  console: Console,
};

export function PlateDesign({ plate, entered }: { plate: Exclude<PlateId, "classic">; entered: boolean }) {
  const Design = DESIGNS[plate];
  return <Design entered={entered} />;
}
