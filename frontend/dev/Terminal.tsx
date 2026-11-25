"use client";

// A shell that actually works.
//
// Passive animation impresses for about four seconds. Something you can TYPE
// INTO holds people, because they start hunting for what else it knows — and
// hiding real content behind commands is the most honestly "developer" thing a
// developer's page can do.
//
// It is a toy, but not a fake one: real history with ↑/↓, tab-completion,
// unknown-command handling that suggests the nearest match, and commands that
// genuinely do things (`album` opens the album, `open linkedin` navigates).
//
// Deliberately NOT a real shell. It cannot touch anything, every command is a
// lookup in the table below, and there is nothing to inject into.

import { useEffect, useRef, useState } from "react";
import { honours } from "@/dev/profile";
import { useDev, useData, useWord } from "./context";

type Line = { kind: "in" | "out" | "err"; text: string };

const BANNER = [
  "pandi-dev shell — type `help`",
];

// Every name the résumé answers to. `ls` has listed a résumé file since the
// first version of this shell; until it was published, `cat`ing it failed.
const RESUME_FILES = new Set(["resume", "resume.pdf", "resume.txt"]);

/** The end of an address: "in/pandiansambath". */
const tail = (url: string) => url.replace(/^https?:\/\/[^/]+\//i, "").replace(/\/$/, "");

export function Terminal({
  onAlbum,
  onResume,
  experience,
}: {
  onAlbum: () => void;
  /** Absent until a résumé is published. */
  onResume?: () => void;
  experience: string;
}) {
  const { CLUSTERS, EDUCATION, EMAIL, LINKS, PROJECT } = useData();
  const w = useWord();
  const { milestones } = useDev();
  const [lines, setLines] = useState<Line[]>(BANNER.map((t) => ({ kind: "out", text: t })));
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const say = (text: string, kind: Line["kind"] = "out") =>
    setLines((l) => [...l, { kind, text }]);

  const openResume = () => {
    if (!onResume) return say("resume: not published yet", "err");
    say("opening résumé…");
    setTimeout(onResume, 260);
  };

  const COMMANDS: Record<string, { help: string; run: (arg: string) => void }> = {
    help: {
      help: "list the commands",
      run: () => {
        say("available:");
        Object.entries(COMMANDS).forEach(([name, c]) => say(`  ${name.padEnd(9)} ${c.help}`));
      },
    },
    whoami: {
      help: "who is this",
      run: () => {
        say(w("name"));
        say(`${w("role")} · ${w("company")}`);
        say(w("place"));
        say(`${experience} years in`);
      },
    },
    resume: {
      help: "his résumé, in place (PDF and Word inside)",
      run: () => openResume(),
    },
    skills: {
      help: "what he works with",
      run: () => {
        // Read from the one shared list, so this can never drift from the
        // orbit and the cards again — it was still claiming SQL long after
        // he said he does not work in it.
        for (const c of CLUSTERS) {
          say(`${c.label.toLowerCase().padEnd(11)} ${c.items.join(", ")}`);
        }
      },
    },
    contact: {
      help: "how to reach him",
      run: () => {
        say(`email      ${EMAIL}`);
        say(`linkedin   ${tail(LINKS.linkedin)}`);
        say(`github     ${tail(LINKS.github)}`);
        say(`instagram  ${tail(LINKS.instagram)}`);
        say("try `open linkedin` / `open github` / `open email`");
      },
    },
    open: {
      help: "open a link  (linkedin|github|email|instagram|dineai|resume)",
      run: (arg) => {
        if (RESUME_FILES.has(arg.trim().toLowerCase())) return openResume();
        const targets: Record<string, string> = {
          linkedin: LINKS.linkedin,
          github: LINKS.github,
          instagram: LINKS.instagram,
          email: LINKS.email,
          dineai: PROJECT.site,
        };
        const url = targets[arg.trim().toLowerCase()];
        if (!url) return say(`open what? try: ${Object.keys(targets).join(", ")}`, "err");
        say(`opening ${arg}…`);
        window.open(url, arg === "email" ? "_self" : "_blank", "noopener");
      },
    },
    // `touch` CREATES a file — the right verb for opening one on Linux is
    // `xdg-open` (hand it to the default viewer). `cat` and `less` read a
    // file, so they earn their place too. All three land on the album; a
    // shell that only accepts one spelling of an obvious idea is a puzzle,
    // not a shell.
    "xdg-open": {
      help: "open a file (try: xdg-open album, xdg-open resume.pdf)",
      run: (arg?: string) => {
        if (arg && RESUME_FILES.has(arg)) return openResume();
        if (arg && arg !== "album") return say(`xdg-open: no such file: ${arg}`, "err");
        say("xdg-open: album — decrypting…");
        setTimeout(onAlbum, 260);
      },
    },
    cat: {
      help: "read a file — cat album, cat resume.pdf",
      run: (arg?: string) => {
        if (arg && RESUME_FILES.has(arg)) return openResume();
        if (arg && arg !== "album") return say(`cat: ${arg}: No such file or directory`, "err");
        say("cat: album is a directory of images — opening viewer…");
        setTimeout(onAlbum, 260);
      },
    },
    ls: {
      help: "what is here",
      run: () => {
        say("album/    resume.pdf    skills/    contact/");
        say("try `xdg-open album` or `resume`");
      },
    },
    album: {
      help: "shortcut for xdg-open album",
      run: () => {
        say("decrypting album…");
        setTimeout(onAlbum, 260);
      },
    },
    education: {
      help: "where he studied",
      run: () => {
        // Same source as the card, so the terminal cannot contradict it.
        say(`${EDUCATION.degree} — ${EDUCATION.affiliation}`);
        say(`${EDUCATION.school} · ${EDUCATION.year}`);
        say(EDUCATION.honour);
        say(`verify: ${EDUCATION.verifyUrl}`);
      },
    },
    // After `album`, so "a" + Tab still completes to the album, as it always has.
    awards: {
      help: "what he has been recognised for",
      run: () => {
        // Same list as the Recognition card.
        for (const m of honours(milestones)) say(`${m.when.padEnd(9)} ${m.title}`);
        say("promoted twice in two years");
      },
    },
    projects: {
      help: "what he builds outside work",
      run: () => {
        say(`${PROJECT.name} — ${PROJECT.slogan}`);
        say(PROJECT.site);
        say("try `open dineai`");
      },
    },
    uptime: {
      help: "time in the industry",
      run: () => say(`${experience} years, and counting`),
    },
    clear: { help: "clear the screen", run: () => setLines([]) },
    sudo: {
      help: "don't",
      run: () => say("nice try.", "err"),
    },
  };

  const submit = (raw: string) => {
    const line = raw.trim();
    say(line ? `$ ${line}` : "$", "in");
    if (!line) return;
    setHistory((h) => [line, ...h]);
    setHIndex(-1);

    const [name, ...rest] = line.split(/\s+/);
    const cmd = COMMANDS[name.toLowerCase()];
    if (cmd) return cmd.run(rest.join(" "));

    // Unknown: suggest the closest command rather than just refusing. A shell
    // that only says "not found" teaches nothing.
    const guess = Object.keys(COMMANDS).find(
      (c) => c.startsWith(name.slice(0, 2).toLowerCase()) || name.toLowerCase().startsWith(c.slice(0, 2)),
    );
    say(`${name}: not found${guess ? ` — did you mean \`${guess}\`?` : " — try `help`"}`, "err");
  };

  // (A word of the line above it, touched: it runs.)
  const run = useRef(submit);
  useEffect(() => {
    run.current = submit;
  });
  useEffect(() => {
    const on = (e: Event) => run.current(String((e as CustomEvent<string>).detail));
    window.addEventListener("dev-shell", on);
    return () => window.removeEventListener("dev-shell", on);
  }, []);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      submit(value);
      setValue("");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(hIndex + 1, history.length - 1);
      if (next >= 0) { setHIndex(next); setValue(history[next]); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = hIndex - 1;
      setHIndex(next);
      setValue(next >= 0 ? history[next] : "");
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const match = Object.keys(COMMANDS).find((c) => c.startsWith(value.trim().toLowerCase()));
      if (match) setValue(match);
    }
  };

  // Follow the output.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lines]);

  // A full card now, not a box squeezed beside the portrait ("even i typed
  // help this screen looks so small"): a tall screen, readable type, and the
  // commands as chips for anyone who would rather tap than type.
  const CHIPS = ["help", "whoami", "skills", "awards", "projects", "education", "resume", "album", "contact"];
  return (
    // A solid screen (no backdrop blur): the card it sits in revolves, and
    // a blur inside a turning card was redone every frame — and the card's
    // crystal texture showed through behind the typed text.
    <div className="w-full overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[color-mix(in_srgb,var(--d-bg)_94%,black)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--d-line)] px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-[11px] tracking-[0.12em] text-[var(--d-ink5)]">pandian@chennai — zsh</span>
        <span className="ml-auto hidden font-mono text-[10px] tracking-[0.2em] text-[var(--d-ink6)] sm:inline">{w("shellBar")}</span>
      </div>

      <div
        ref={scroller}
        onClick={() => input.current?.focus({ preventScroll: true })}
        className="h-[19rem] cursor-text overflow-y-auto overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.8] sm:h-80 sm:text-[13px]"
      >
        {lines.map((l, i) => (
          <p
            key={i}
            className={
              l.kind === "in" ? "text-[var(--d-ink)]" : l.kind === "err" ? "text-[#f0736a]" : "text-[var(--d-ink3)]"
            }
          >
            {l.kind === "out" && l.text.startsWith("  ") ? (
              // The padded help columns keep their spacing and wrap when a
              // line is longer than the card — on every screen: "open a link
              // (linkedin|github|…|resume)" ran off the edge on a phone and
              // was cut off on a desktop too (QA, 22 Nov).
              <span className="whitespace-pre-wrap break-words">{l.text}</span>
            ) : (
              l.text
            )}
          </p>
        ))}
        <div className="flex items-center gap-2">
          <span className="text-[var(--d-b)]">pandian@chennai</span>
          <span className="text-[var(--d-a)]">$</span>
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal input"
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[var(--d-ink)] outline-none placeholder:text-[var(--d-ink6)] focus-visible:!shadow-none focus-visible:!outline-none"
            placeholder="type a command…"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-[var(--d-line)] px-4 py-3">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => submit(c)}
            className="rounded-lg border border-[var(--d-line2)] px-2.5 py-1 font-mono text-[11.5px] text-[var(--d-ink3)] transition hover:-translate-y-0.5 hover:border-[var(--d-b)] hover:text-[var(--d-ink)]"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
