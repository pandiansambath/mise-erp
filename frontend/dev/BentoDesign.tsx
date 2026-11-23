"use client";

// Design 5 of 5: Bento — "Everything, at a glance."
//
// One screen of living tiles, built from nothing for this design. Every part
// of him has a tile: his portrait, the live counter with the month chain,
// the résumé, the album, skills sliding past in rows, the gold medal, the
// honours flipping one after another, DineAI, volunteering. Tiles pop in one
// by one and lean towards the pointer with a moving glare. On a phone they
// stack into one column, every tile intact.

import { AwardLink } from "./AwardLink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { chennaiTime, elapsed, useDev, useNow, usePortraits, useData } from "./context";
import { ResumeActions } from "./designKit";
import { MonthChain } from "./MonthChain";
import { honours } from "./profile";
import { DOCS } from "./skills";

/** A tile that leans towards the pointer, with a glare that follows it. */
function Tile({ className = "", i, children, onClick, label }: { className?: string; i: number; children: ReactNode; onClick?: () => void; label?: string }) {
  const { entered } = useDev();
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    ref.current.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
    ref.current.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
    ref.current.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
    ref.current.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const leave = () => {
    ref.current?.style.setProperty("--rx", "0deg");
    ref.current?.style.setProperty("--ry", "0deg");
  };
  return (
    <div className={`[perspective:1200px] ${className}`} style={entered ? { animation: `devTileIn .7s ${0.08 + i * 0.07}s cubic-bezier(.2,1.2,.3,1) both` } : { opacity: 0 }}>
      <div
        ref={ref}
        onPointerMove={move}
        onPointerLeave={leave}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={label}
        onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
        className={`group relative h-full overflow-hidden rounded-3xl border border-[var(--d-line)] bg-[var(--d-glass)] p-5 backdrop-blur-sm transition-[transform,border-color] duration-300 ease-out hover:border-[var(--d-line2)] ${onClick ? "cursor-pointer" : ""}`}
        style={{ transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))", transformStyle: "preserve-3d" }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: "radial-gradient(420px circle at var(--gx, 50%) var(--gy, 50%), color-mix(in srgb, var(--d-ink) 9%, transparent), transparent 45%)" }}
        />
        <div className="relative h-full">{children}</div>
      </div>
    </div>
  );
}

const LABEL = "font-mono text-[10px] tracking-[0.28em]";

export function BentoDesign() {
  const { CAREER_START, CLUSTERS, EDUCATION, EMAIL, LINKS, PROJECT, VOLUNTEERING } = useData();
  // His portrait photos and their pace, set in the owner panel (22 Nov).
  const PORTRAITS = usePortraits();
  const { interval } = useDev().portraits;
  const { entered, milestones, photos, openAlbum, toast } = useDev();
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  const list = honours(milestones);
  const [count, setCount] = useState(0);
  const [honour, setHonour] = useState(0);
  const [portrait, setPortrait] = useState(0);

  // The headline number counts up once, the first time the page opens.
  useEffect(() => {
    if (!entered || !exp) return;
    const target = Number(exp.decimal);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1400);
      setCount(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per entry, not every clock tick
  }, [entered, exp?.decimal]);

  useEffect(() => {
    if (list.length < 2) return;
    const id = setInterval(() => setHonour((n) => (n + 1) % list.length), 3800);
    return () => clearInterval(id);
  }, [list.length]);
  useEffect(() => {
    if (PORTRAITS.length < 2) return;
    const id = setInterval(() => setPortrait((n) => (n + 1) % PORTRAITS.length), Math.max(3, interval) * 1000);
    return () => clearInterval(id);
  }, [PORTRAITS.length, interval]);

  const h = list[honour % Math.max(1, list.length)];

  return (
    <main className="relative z-10 mx-auto w-full max-w-7xl px-3 pb-10 pt-[4.5rem] sm:px-6 sm:pt-24">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background: "radial-gradient(60% 50% at 15% 10%, color-mix(in srgb, var(--d-a) 16%, transparent), transparent 70%), radial-gradient(60% 50% at 90% 90%, color-mix(in srgb, var(--d-b) 14%, transparent), transparent 70%)" }} />

      <div className="grid auto-rows-[minmax(150px,auto)] grid-cols-1 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-12">
        {/* Who */}
        <Tile i={0} className="md:col-span-6 lg:col-span-5 lg:row-span-2" onClick={openAlbum} label="Open the photo album">
          <div className="absolute -inset-5 overflow-hidden">
            {PORTRAITS.map((src, n) => (
              // eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend
              <img
                key={src}
                src={src}
                alt={n === 0 ? "Pandian Sambath" : ""}
                className="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-[1500ms] group-hover:scale-105"
                style={{ objectPosition: "50% 28%", opacity: n === portrait ? 1 : 0 }}
              />
            ))}
            <span aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--d-bg) 8%, color-mix(in srgb, var(--d-bg) 40%, transparent) 45%, transparent 75%)" }} />
          </div>
          <div className="relative flex h-full min-h-[340px] flex-col justify-end">
            <p className={`${LABEL} text-[var(--d-a2)]`}>HELLO, I’M</p>
            <h1 className="dev-sheen mt-1 font-display text-[clamp(2.4rem,5vw,3.8rem)] font-semibold leading-[1]">Pandian Sambath</h1>
            <p className="mt-2 text-[15px]">
              <span className="font-semibold">System Engineer</span> <span className="text-[var(--d-ink5)]">at</span>{" "}
              <span className="font-semibold text-[var(--d-a2)]">Tata Consultancy Services</span>
            </p>
            <p className="mt-1.5 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink4)]">CHENNAI · {now ? `${chennaiTime(now)} IST` : "—"} · TAP FOR THE ALBUM</p>
          </div>
        </Tile>

        {/* Time */}
        <Tile i={1} className="md:col-span-6 lg:col-span-4 lg:row-span-2">
          <p className={`${LABEL} text-[var(--d-a)]`}>TIME IN THE CHAIN</p>
          <p className="mt-2 font-display text-[clamp(3.6rem,7vw,5.4rem)] font-semibold leading-none tabular-nums">
            {count.toFixed(1)}
            <span className="ml-2 font-sans text-base font-normal text-[var(--d-ink5)]">years</span>
          </p>
          <p className="mt-2 font-mono text-[11px] tracking-[0.12em] text-[var(--d-ink4)]">
            {exp ? `${exp.years}Y ${exp.months}M ${exp.days}D · DAY ${exp.dayNumber.toLocaleString("en-US")}` : ""}
          </p>
          {now && <MonthChain start={CAREER_START} now={now} play={entered} />}
          {/* What the chain holds, counted live from the same list. */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(
              [
                ["recognition", "AWARDS", "var(--d-gold)"],
                ["promotion", "PROMOTIONS", "var(--d-b)"],
                ["milestone", "MILESTONES", "var(--d-c)"],
              ] as const
            ).map(([k, label, color]) => (
              <div key={k} className="rounded-2xl border border-[var(--d-line)] bg-[var(--d-shade)] px-3 py-2.5">
                <p className="font-display text-[26px] font-semibold leading-none" style={{ color }}>
                  {milestones.filter((m) => m.kind === k).length}
                </p>
                <p className="mt-1 font-mono text-[9px] tracking-[0.18em] text-[var(--d-ink5)]">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] tabular-nums tracking-[0.18em] text-[var(--d-ink6)]">
            {exp ? `+ ${String(exp.hours).padStart(2, "0")}:${String(exp.minutes).padStart(2, "0")}:${String(exp.seconds).padStart(2, "0")} AND COUNTING` : ""}
          </p>
        </Tile>

        {/* Résumé */}
        <Tile i={2} className="md:col-span-3 lg:col-span-3">
          <p className={`${LABEL} text-[var(--d-b2)]`}>RÉSUMÉ</p>
          <p className="mt-2 text-[20px] font-semibold leading-tight">Two pages, ready to read.</p>
          <ResumeActions className="mt-4" button="rounded-full border border-[var(--d-line2)] px-3 py-1.5 text-[12px] font-semibold text-[var(--d-ink2)] transition hover:border-[var(--d-b)] hover:text-[var(--d-ink)]" />
        </Tile>

        {/* Album */}
        <Tile i={3} className="md:col-span-3 lg:col-span-3" onClick={openAlbum} label="Open the photo album">
          <div className="grid h-full grid-cols-3 grid-rows-2 gap-1.5">
            {photos.slice(0, 5).map((p, n) => (
              // eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend
              <img
                key={p.id}
                src={`/api/dev-site/thumb/${p.id}.webp`}
                alt=""
                className={`h-full w-full rounded-xl object-cover transition duration-500 group-hover:scale-[1.04] ${n === 0 ? "col-span-2 row-span-2" : ""}`}
              />
            ))}
          </div>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[10px] text-white backdrop-blur">{photos.length} PHOTOS →</span>
        </Tile>

        {/* Skills */}
        <Tile i={4} className="md:col-span-6 lg:col-span-6">
          <p className={`${LABEL} text-[var(--d-c)]`}>WHAT HE WORKS WITH</p>
          <div className="mt-3 space-y-2.5 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            {CLUSTERS.map((c, ri) => (
              <div key={c.key} className="overflow-hidden">
                <div
                  className="flex w-max gap-2 hover:[animation-play-state:paused]"
                  style={{ animation: `devMarquee ${26 + ri * 7}s linear infinite ${ri % 2 ? "reverse" : ""}` }}
                >
                  {[...c.items, ...c.items, ...c.items].map((item, k) => (
                    <a
                      key={k}
                      href={DOCS[item]}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11.5px] transition hover:brightness-150"
                      style={{ color: c.hue, borderColor: `color-mix(in srgb, ${c.hue} 35%, transparent)`, background: `color-mix(in srgb, ${c.hue} 8%, transparent)` }}
                    >
                      {item}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Tile>

        {/* Education */}
        <Tile i={5} className="md:col-span-3 lg:col-span-3">
          <p className={`${LABEL} text-[var(--d-gold)]`}>EDUCATION</p>
          <p className="mt-2 flex items-start gap-2 text-[18px] font-semibold leading-snug">
            <span className="dev-medal">🏅</span>
            <span className="dev-gold">{EDUCATION.honour}</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-[var(--d-ink3)]">
            {EDUCATION.degree} · {EDUCATION.year} · {EDUCATION.percentage}
          </p>
          <p className="text-[12px] text-[var(--d-ink5)]">{EDUCATION.school}</p>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
            <a href={EDUCATION.verifyUrl} target="_blank" rel="noreferrer noopener" className="rounded-full border border-[var(--d-gold)]/50 px-2.5 py-1 text-[var(--d-gold)] hover:bg-[var(--d-gold)]/10">
              ✓ verify
            </a>
            <AwardLink className="rounded-full border border-[var(--d-line2)] px-2.5 py-1 text-[var(--d-ink3)] hover:text-[var(--d-ink)]">
              open the award ✦
            </AwardLink>
          </div>
        </Tile>

        {/* Honours, flipping */}
        <Tile i={6} className="md:col-span-3 lg:col-span-3">
          <p className={`${LABEL} text-[var(--d-gold)]`}>RECOGNITION · {list.length}</p>
          {h && (
            <div key={honour} className="mt-3" style={{ animation: "devFlipIn .6s cubic-bezier(.2,1,.3,1) both" }}>
              <p className="font-mono text-[10px] tracking-[0.2em] text-[var(--d-ink5)]">{h.when.toUpperCase()}</p>
              <p className={`mt-1 text-[19px] font-semibold leading-snug ${h.kind === "recognition" ? "dev-gold" : ""}`}>
                {h.kind === "recognition" ? "★ " : "↑ "}
                {h.title}
              </p>
              {h.promoted && <p className="mt-1 font-mono text-[10.5px] text-[var(--d-b2)]">PROMOTED · {h.promoted.toUpperCase()}</p>}
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--d-ink4)]">{h.note}</p>
            </div>
          )}
          <p className="absolute bottom-0 left-0 flex gap-1">
            {list.map((_, n) => (
              <span key={n} className={`h-1 rounded-full transition-all duration-500 ${n === honour ? "w-5 bg-[var(--d-gold)]" : "w-1.5 bg-[var(--d-line2)]"}`} />
            ))}
          </p>
        </Tile>

        {/* DineAI */}
        <Tile i={7} className="md:col-span-6 lg:col-span-5">
          <p className={`${LABEL} flex items-center gap-2 text-[var(--d-b)]`}>
            BUILT OUTSIDE WORK
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--d-b)] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--d-b)]" />
            </span>
          </p>
          <p className="mt-2 text-[26px] font-semibold">{PROJECT.name}</p>
          <p
            className="text-[20px] font-semibold"
            style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
          >
            “{PROJECT.slogan}”
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--d-ink3)]">{PROJECT.pitch}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-semibold">
            <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-1.5 text-[var(--d-on)]" style={{ background: "linear-gradient(90deg, var(--d-b2), var(--d-b))" }}>
              dineai.cloud ↗
            </a>
            <a href={PROJECT.code} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[var(--d-line2)] px-3 py-1.5 text-[var(--d-ink2)]">
              Code ↗
            </a>
          </div>
          <p className="mt-2 text-[11px] text-[var(--d-ink6)]">{PROJECT.honesty}</p>
        </Tile>

        {/* Volunteering */}
        <Tile i={8} className="md:col-span-3 lg:col-span-4">
          <p className={`${LABEL} text-[var(--d-c)]`}>HOW HE RECHARGES</p>
          <ul className="mt-3 space-y-2.5">
            {VOLUNTEERING.map((v) => (
              <li key={v.org} className="text-[12.5px] leading-relaxed text-[var(--d-ink3)]">
                <span className="font-semibold text-[var(--d-ink)]">{v.org}</span> — {v.what}
              </li>
            ))}
          </ul>
        </Tile>

        {/* Say hello */}
        <Tile i={9} className="md:col-span-3 lg:col-span-3">
          <p className={`${LABEL} text-[var(--d-a)]`}>EVERYTHING, AT A GLANCE</p>
          <p className="mt-2 text-[20px] font-semibold leading-tight">Say hello.</p>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(EMAIL);
                toast(`Copied ${EMAIL}`);
              } catch {
                window.location.href = LINKS.email;
              }
            }}
            className="mt-3 w-full truncate rounded-xl border border-[var(--d-line2)] px-3 py-2 text-left font-mono text-[11.5px] text-[var(--d-ink2)] transition hover:border-[var(--d-b)]"
          >
            {EMAIL} <span className="text-[var(--d-ink5)]">· copy</span>
          </button>
          <p className="mt-2 flex gap-3 font-mono text-[11px]">
            <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className="text-[var(--d-b2)] hover:underline">LinkedIn ↗</a>
            <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className="text-[var(--d-b2)] hover:underline">GitHub ↗</a>
          </p>
        </Tile>
      </div>
    </main>
  );
}
