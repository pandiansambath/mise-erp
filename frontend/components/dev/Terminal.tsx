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

type Line = { kind: "in" | "out" | "err"; text: string };

const BANNER = [
  "pandi-dev shell — type `help`",
];

export function Terminal({
  onAlbum,
  experience,
}: {
  onAlbum: () => void;
  experience: string;
}) {
  const [lines, setLines] = useState<Line[]>(BANNER.map((t) => ({ kind: "out", text: t })));
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const say = (text: string, kind: Line["kind"] = "out") =>
    setLines((l) => [...l, { kind, text }]);

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
        say("Pandian Sambath");
        say("System Engineer · Tata Consultancy Services");
        say("Chennai, India");
        say(`${experience} years in`);
      },
    },
    skills: {
      help: "what he works with",
      run: () => {
        say("languages   Python, SQL");
        say("cloud       AWS — ECS, Lambda, SQS, S3, RDS, DynamoDB, IAM, VPC");
        say("frameworks  Django REST Framework, Apache Camel");
        say("devops      Docker, Kubernetes, Terraform, GitHub Actions");
      },
    },
    contact: {
      help: "how to reach him",
      run: () => {
        say("email      pandian.s.sambath@gmail.com");
        say("linkedin   in/pandian-sambath-6b97601b3");
        say("github     pandiansambath");
        say("instagram  pandian.sambath");
        say("try `open linkedin` / `open github` / `open email`");
      },
    },
    open: {
      help: "open a link  (linkedin|github|email|instagram)",
      run: (arg) => {
        const targets: Record<string, string> = {
          linkedin: "https://linkedin.com/in/pandian-sambath-6b97601b3",
          github: "https://github.com/pandiansambath",
          instagram: "https://instagram.com/pandian.sambath",
          email: "mailto:pandian.s.sambath@gmail.com",
        };
        const url = targets[arg.trim().toLowerCase()];
        if (!url) return say(`open what? try: ${Object.keys(targets).join(", ")}`, "err");
        say(`opening ${arg}…`);
        window.open(url, arg === "email" ? "_self" : "_blank", "noopener");
      },
    },
    album: {
      help: "open the photo album",
      run: () => {
        say("decrypting album…");
        setTimeout(onAlbum, 260);
      },
    },
    education: {
      help: "where he studied",
      run: () => {
        say("B.Tech Information Technology — Anna University");
        say("Panimalar Institute of Technology, Chennai · 2023");
        say("Gold Medalist · 17th rank overall · 92%");
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

  return (
    <div
      onClick={() => input.current?.focus()}
      className="w-full max-w-md cursor-text overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-[10px] tracking-[0.15em] text-[#4a5c70]">
          pandian@dineai — zsh
        </span>
      </div>

      <div ref={scroller} className="h-44 overflow-y-auto px-3 py-2.5 font-mono text-[11.5px] leading-[1.75]">
        {lines.map((l, i) => (
          <p
            key={i}
            className={
              l.kind === "in" ? "text-[#e6edf5]" : l.kind === "err" ? "text-[#f0736a]" : "text-[#7d93ad]"
            }
          >
            {l.kind === "out" && l.text.startsWith("  ") ? (
              <span className="whitespace-pre">{l.text}</span>
            ) : (
              l.text
            )}
          </p>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="text-[#d97742]">$</span>
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal input"
            className="flex-1 bg-transparent font-mono text-[11.5px] text-[#e6edf5] outline-none placeholder:text-[#3f4f61]"
            placeholder="help"
          />
        </div>
      </div>
    </div>
  );
}
