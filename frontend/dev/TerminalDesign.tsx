"use client";

// Design 4 of 5: Terminal — "$ whoami"
//
// The whole site as one console, built from nothing for this design. It boots
// and types its own story: neofetch (his portrait on a CRT beside his stats),
// education, skills as a directory listing, his career as a git log — every
// milestone a commit, today as HEAD — DineAI's README, the volunteering log,
// the résumé. Then the prompt is his visitor's: type, or tap a command.
// `theme` and `design` change the whole site from inside the shell.
//
// Outputs are rendered from the command NAME at render time, so live values
// (uptime, the clock) keep ticking in output already printed.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CAREER_START, EMAIL, LINKS, chennaiTime, elapsed, useDev, useNow, usePortraits } from "./context";
import { kindGlyph, kindRole, stations } from "./designKit";
import { PROJECT, VOLUNTEERING } from "./profile";
import { resumeHref } from "./Resume";
import { CLUSTERS, DOCS, EDUCATION } from "./skills";
import { DESIGNS, THEMES, findTheme, isDesign } from "./theme";

const BOOT = ["neofetch", "cat ~/education.txt", "ls -la ~/skills/", "git log --reverse ~/career", "cat ~/projects/dineai/README.md", "cat ~/volunteering.log", "open ~/resume.pdf"];
const CHIPS = ["help", "neofetch", "skills", "career", "dineai", "resume", "album", "theme list", "design list"];

/** A short, stable, commit-like hash per line (32-bit maths via imul: plain
 *  multiplication overflows past 2^53 and every hash came out 0000000). */
function hash(n: number) {
  let x = Math.imul(n + 7, 2654435761);
  let h = "";
  for (let i = 0; i < 7; i++) {
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    h += "0123456789abcdef"[(x >>> 0) % 16];
  }
  return h;
}

type Block = { id: number; cmd: string };

export function TerminalDesign() {
  // His portrait photos and their pace, set in the owner panel (22 Nov).
  const PORTRAITS = usePortraits();
  const dev = useDev();
  const { entered, milestones, resume, openResume, openAlbum, setTheme, setDesign, themeId } = dev;
  const now = useNow();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const screen = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);
  const exp = now ? elapsed(CAREER_START, now) : null;

  const push = useCallback((cmd: string) => setBlocks((b) => [...b, { id: nextId.current++, cmd }]), []);

  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Boot: type each command, then print its output.
  const boot = useCallback(() => {
    stop();
    setBlocks([]);
    setBooting(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      BOOT.forEach(push);
      setBooting(false);
      return;
    }
    let t = 400;
    for (const cmd of BOOT) {
      for (let i = 1; i <= cmd.length; i++) {
        const part = cmd.slice(0, i);
        timers.current.push(setTimeout(() => setTyping(part), t));
        t += 26 + (i % 5 === 0 ? 40 : 0);
      }
      timers.current.push(
        setTimeout(() => {
          setTyping(null);
          push(cmd);
        }, (t += 180)),
      );
      t += 900;
    }
    timers.current.push(setTimeout(() => setBooting(false), t));
  }, [push]);

  useEffect(() => {
    if (entered) boot();
    return stop;
  }, [entered, boot]);

  const skip = () => {
    stop();
    setTyping(null);
    setBlocks(BOOT.map((cmd) => ({ id: nextId.current++, cmd })));
    setBooting(false);
  };

  // Follow the output.
  useEffect(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks, typing, booting]);

  const run = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    setHistory((h) => [line, ...h]);
    setHIdx(-1);
    const [name, arg = ""] = line.split(/\s+/, 2);
    if (name === "clear") return setBlocks([]);
    if (name === "replay" || name === "reboot") return boot();
    if (name === "resume" || line === "open ~/resume.pdf" || line === "open resume.pdf") openResume();
    if (name === "album") openAlbum();
    if (name === "theme" && THEMES.some((t) => t.id === arg)) setTheme(arg);
    if (name === "design" && isDesign(arg) && arg !== "terminal") setTimeout(() => setDesign(arg), 400);
    push(line);
  };

  const link = "text-[var(--d-b2)] underline decoration-dotted underline-offset-2 hover:text-[var(--d-ink)]";
  const dim = "text-[var(--d-ink5)]";

  /** What a command prints. Unknown commands get a helpful nudge. */
  const output = (line: string): ReactNode => {
    const [name, arg = ""] = line.split(/\s+/, 2);
    switch (name) {
      case "neofetch":
      case "whoami":
        return (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <button type="button" onClick={openAlbum} className="relative w-40 shrink-0 overflow-hidden rounded-md sm:w-48" aria-label="Open the photo album">
              {/* eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend */}
              <img src={PORTRAITS[0]} alt="Pandian Sambath" className="aspect-square w-full object-cover" style={{ objectPosition: "50% 30%", filter: "grayscale(1) contrast(1.35) brightness(1.05)" }} />
              <span aria-hidden className="absolute inset-0 mix-blend-color" style={{ background: "var(--d-b)" }} />
              <span aria-hidden className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,.35) 0 1px, transparent 1px 3px)" }} />
            </button>
            <div className="min-w-0 leading-[1.7]">
              <p>
                <span className="font-bold text-[var(--d-a2)]">pandian</span>@<span className="font-bold text-[var(--d-b)]">chennai</span>
              </p>
              <p className={dim}>----------------</p>
              {(
                [
                  ["Name", "Pandian Sambath"],
                  ["Role", "System Engineer"],
                  ["Company", "Tata Consultancy Services"],
                  ["Uptime", exp ? `${exp.years}y ${exp.months}m ${exp.days}d (day ${exp.dayNumber.toLocaleString("en-US")})` : "…"],
                  ["Location", `Chennai, India · ${now ? chennaiTime(now) : ""} IST`],
                  ["Stack", "Python, AWS, Generative AI"],
                  ["Theme", findTheme(themeId).name],
                ] as const
              ).map(([k, v]) => (
                <p key={k}>
                  <span className="font-bold text-[var(--d-a2)]">{k}</span>: {v}
                </p>
              ))}
              <p className="mt-2 flex gap-1">
                {["a", "a2", "gold", "b", "b2", "c", "d", "ink"].map((r) => (
                  <span key={r} className="h-4 w-6" style={{ background: `var(--d-${r})` }} />
                ))}
              </p>
            </div>
          </div>
        );
      case "cat":
        if (arg.includes("education"))
          return (
            <div className="leading-[1.75]">
              <p>{EDUCATION.degree}</p>
              <p className={dim}>{EDUCATION.school} · {EDUCATION.affiliation}</p>
              <p className={dim}>{EDUCATION.year} · {EDUCATION.percentage}</p>
              <p className="dev-gold font-bold">★ {EDUCATION.honour}</p>
              <a className={link} href={EDUCATION.verifyUrl} target="_blank" rel="noreferrer noopener">
                → verify: Anna University rank list, page 35
              </a>
            </div>
          );
        if (arg.includes("dineai"))
          return (
            <div className="leading-[1.75]">
              <p className="font-bold text-[var(--d-a2)]"># {PROJECT.name}</p>
              <p className="text-[var(--d-b2)]">&gt; {PROJECT.slogan}</p>
              <p className="max-w-2xl">{PROJECT.pitch}</p>
              <p className={dim}>In use at {PROJECT.inUse.label}.</p>
              <p className="flex flex-wrap gap-x-4">
                <a className={link} href={PROJECT.site} target="_blank" rel="noopener noreferrer">[site] dineai.cloud</a>
                <a className={link} href={PROJECT.code} target="_blank" rel="noopener noreferrer">[code] github</a>
              </p>
              <p className={`${dim} max-w-2xl`}>{PROJECT.honesty}</p>
            </div>
          );
        if (arg.includes("volunteering"))
          return (
            <div className="leading-[1.75]">
              {VOLUNTEERING.map((v) => (
                <p key={v.org}>
                  <span className="text-[var(--d-c)]">[ok]</span> <span className="font-bold">{v.org}</span> <span className={dim}>— {v.what}</span>
                </p>
              ))}
            </div>
          );
        return <p className="text-[#f0736a]">cat: {arg || "?"}: No such file. Try `ls` or `help`.</p>;
      case "ls":
      case "skills":
        return (
          <div className="space-y-2 leading-[1.7]">
            {CLUSTERS.map((c) => (
              <div key={c.key}>
                <p>
                  <span className={dim}>drwxr-xr-x </span>
                  <span className="font-bold" style={{ color: c.hue }}>{c.key}/</span>
                  <span className={dim}> · {c.items.length} entries</span>
                </p>
                <p className="flex flex-wrap gap-x-4 pl-4">
                  {c.items.map((i) => (
                    <a key={i} href={DOCS[i]} target="_blank" rel="noreferrer noopener" className="hover:underline" style={{ color: c.hue }}>
                      {i.replace(/\s+/g, "_")}
                    </a>
                  ))}
                </p>
              </div>
            ))}
          </div>
        );
      case "git":
      case "career":
      case "log": {
        const list = stations(milestones, now);
        return (
          <div className="leading-[1.75]">
            {list.map((s, i) => {
              const head = i === list.length - 1;
              return (
                <p key={`${s.when}-${s.title}`}>
                  <span className="text-[var(--d-gold)]">{hash(i)}</span>{" "}
                  {head && <span className="font-bold text-[var(--d-b)]">(HEAD → today) </span>}
                  <span className={dim}>{s.when.padEnd(8, " ")}</span>{" "}
                  <span style={{ color: `var(--d-${kindRole(s.kind)})` }}>{kindGlyph(s.kind)}</span> {s.title}
                  {s.promoted && <span className="text-[var(--d-b2)]"> [{s.promoted}]</span>}
                </p>
              );
            })}
          </div>
        );
      }
      case "dineai":
      case "projects":
        return output("cat ~/projects/dineai/README.md");
      case "volunteering":
        return output("cat ~/volunteering.log");
      case "education":
        return output("cat ~/education.txt");
      case "open":
      case "resume":
        return resume ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className={dim}>opening résumé…</span>
            <button type="button" onClick={openResume} className="rounded border border-[var(--d-b)] px-2 py-0.5 text-[var(--d-b2)] hover:bg-[var(--d-b)] hover:text-[var(--d-on)]">[ view ]</button>
            <a href={resumeHref(resume, resume.pdf, true)} download className="rounded border border-[var(--d-line2)] px-2 py-0.5 hover:border-[var(--d-b)]">[ pdf ]</a>
            {resume.docx && (
              <a href={resumeHref(resume, resume.docx, true)} download className="rounded border border-[var(--d-line2)] px-2 py-0.5 hover:border-[var(--d-b)]">[ word ]</a>
            )}
          </p>
        ) : (
          <p className={dim}>résumé not published yet</p>
        );
      case "album":
        return <p className={dim}>decrypting album…</p>;
      case "contact":
        return (
          <div className="leading-[1.75]">
            <p>email&nbsp;&nbsp;&nbsp;&nbsp;<a className={link} href={LINKS.email}>{EMAIL}</a></p>
            <p>linkedin&nbsp;<a className={link} href={LINKS.linkedin} target="_blank" rel="noopener noreferrer">in/pandiansambath</a></p>
            <p>github&nbsp;&nbsp;&nbsp;<a className={link} href={LINKS.github} target="_blank" rel="noopener noreferrer">pandiansambath</a></p>
          </div>
        );
      case "theme":
        if (arg === "list" || !arg)
          return (
            <p className="flex flex-wrap gap-x-4">
              {THEMES.map((t) => (
                <button key={t.id} type="button" onClick={() => run(`theme ${t.id}`)} className="hover:underline" style={{ color: t.a }}>
                  {t.id}
                </button>
              ))}
            </p>
          );
        return THEMES.some((t) => t.id === arg) ? <p className={dim}>theme → {findTheme(arg).name}</p> : <p className="text-[#f0736a]">no theme “{arg}”. try `theme list`</p>;
      case "design":
        if (arg === "list" || !arg)
          return (
            <div>
              {DESIGNS.map((d) => (
                <p key={d.id}>
                  <button type="button" onClick={() => run(`design ${d.id}`)} className="font-bold text-[var(--d-a2)] hover:underline">{d.id.padEnd(10, " ")}</button>
                  <span className={dim}>{d.slogan}</span>
                </p>
              ))}
            </div>
          );
        return arg === "terminal" ? <p className={dim}>you are already here.</p> : isDesign(arg) ? <p className={dim}>switching to {arg}…</p> : <p className="text-[#f0736a]">no design “{arg}”. try `design list`</p>;
      case "date":
        return <p>{now ? now.toString() : ""}</p>;
      case "sudo":
        return <p className="text-[#f0736a]">nice try.</p>;
      case "help":
        return (
          <div className="grid gap-x-6 sm:grid-cols-2">
            {[
              ["neofetch", "who he is, live"],
              ["skills", "the skills directory"],
              ["career", "milestones as a git log"],
              ["education", "degree and the gold medal"],
              ["dineai", "what he builds outside work"],
              ["volunteering", "how he recharges"],
              ["resume", "view or download"],
              ["album", "the photo album"],
              ["contact", "how to reach him"],
              ["theme <name|list>", "repaint the whole site"],
              ["design <name|list>", "rebuild it as another design"],
              ["replay · clear", "boot again · clean screen"],
            ].map(([c, d]) => (
              <p key={c}>
                <span className="text-[var(--d-a2)]">{c.padEnd(19, " ")}</span>
                <span className={dim}>{d}</span>
              </p>
            ))}
          </div>
        );
      default:
        return <p className="text-[#f0736a]">{name}: command not found — try `help`</p>;
    }
  };

  // A plain function, not a component: a component declared in render would
  // remount every second (the clock ticks) and steal the input's focus.
  const prompt = (children: ReactNode) => (
    <p className="break-all">
      <span className="text-[var(--d-b)]">pandian@chennai</span>
      <span className={dim}>:</span>
      <span className="text-[var(--d-a2)]">~</span>
      <span className={dim}>$ </span>
      {children}
    </p>
  );

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-2 pb-4 pt-[4.5rem] sm:px-6 sm:pt-24">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background: "radial-gradient(80% 60% at 50% 30%, color-mix(in srgb, var(--d-b) 12%, transparent), transparent 70%)" }} />
      <div
        className="flex h-[calc(100dvh-5.5rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-[var(--d-line2)] shadow-[0_40px_120px_-30px_rgba(0,0,0,.8)] sm:h-[calc(100dvh-8rem)] sm:rounded-2xl"
        style={{ background: "color-mix(in srgb, var(--d-bg) 55%, #000)", animation: entered ? "devCrtOn .7s ease-out both" : undefined }}
      >
        <div className="flex items-center gap-2 border-b border-[var(--d-line)] px-3 py-2.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-2 truncate font-mono text-[11px] text-[var(--d-ink5)]">pandian@chennai: ~ — zsh</span>
          <span className="ml-auto flex gap-2">
            {booting ? (
              <button type="button" onClick={skip} className="rounded-md border border-[var(--d-line2)] px-2 py-0.5 font-mono text-[11px] text-[var(--d-ink3)] hover:text-[var(--d-ink)]">
                skip ⏭
              </button>
            ) : (
              <button type="button" onClick={boot} className="rounded-md border border-[var(--d-line2)] px-2 py-0.5 font-mono text-[11px] text-[var(--d-ink3)] hover:text-[var(--d-ink)]">
                ↻ replay
              </button>
            )}
          </span>
        </div>

        <div
          ref={screen}
          onClick={() => input.current?.focus({ preventScroll: true })}
          className="relative flex-1 overflow-y-auto overscroll-contain px-3 py-3 font-mono text-[12px] leading-relaxed text-[var(--d-ink2)] sm:px-5 sm:text-[13.5px]"
          style={{ textShadow: "0 0 6px color-mix(in srgb, var(--d-b) 35%, transparent)" }}
        >
          <p className={dim}>Last login: {now ? now.toDateString() : ""} on ttys001 · Chennai</p>
          {blocks.map((b) => (
            <div key={b.id} className="mt-3" style={{ animation: "devFadeUp .35s ease-out both" }}>
              {prompt(b.cmd)}
              <div className="mt-1.5">{output(b.cmd)}</div>
            </div>
          ))}
          {typing !== null && (
            <div className="mt-3">
              {prompt(
                <>
                  {typing}
                  <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[var(--d-b)]" />
                </>,
              )}
            </div>
          )}
          {!booting && (
            <div className="mt-3">
              {prompt(
                <input
                  ref={input}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      run(value);
                      setValue("");
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      const n = Math.min(hIdx + 1, history.length - 1);
                      if (n >= 0) {
                        setHIdx(n);
                        setValue(history[n]);
                      }
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      const n = hIdx - 1;
                      setHIdx(n);
                      setValue(n >= 0 ? history[n] : "");
                    } else if (e.key === "Tab") {
                      e.preventDefault();
                      const m = CHIPS.concat(["contact", "education", "volunteering", "clear", "replay"]).find((c) => c.startsWith(value.trim()));
                      if (m) setValue(m);
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Terminal input"
                  placeholder="type help"
                  className="w-[60%] bg-transparent text-[var(--d-ink)] outline-none placeholder:text-[var(--d-ink6)]"
                />
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => run(c)}
                    className="rounded-md border border-[var(--d-line2)] px-2 py-1 text-[11px] text-[var(--d-ink3)] transition hover:border-[var(--d-b)] hover:text-[var(--d-ink)]"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* The CRT: scanlines over everything in the window, fading at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[5]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px)",
          maskImage: "radial-gradient(90% 80% at 50% 50%, #000 60%, transparent)",
        }}
      />
    </main>
  );
}
