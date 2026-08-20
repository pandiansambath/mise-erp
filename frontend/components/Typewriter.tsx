"use client";

// Reveal the assistant's reply as it "types".
//
// Not decoration: a wall of text appearing at once gives you no idea where to
// start reading, and after a two-second wait it feels like the machine did
// nothing and then shouted. Revealing it makes the wait feel like progress.
//
// Two rules keep it from becoming annoying:
//
// 1. **Only NEW replies animate.** Replayed history appears instantly — nobody
//    wants to watch yesterday's conversation retype itself on every page load.
// 2. **It can always be skipped.** Clicking finishes it immediately, and the
//    full text is in the DOM the moment the animation ends, so copying and
//    screen readers are unaffected.

import { useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/ChatMarkdown";

// Characters per tick. Fast enough to read along with, slow enough to feel
// alive — a long table would be tedious at true typing speed.
const CHARS_PER_TICK = 3;
const TICK_MS = 16;

/** Markdown characters, removed while typing so they are never seen. */
function stripSyntax(s: string): string {
  return s
    // DIVIDERS FIRST, while the pipes are still there to recognise them by.
    // The old order blanked the pipes into spaces and then looked for a line
    // that was ONLY dashes - but `| --- | --- |` had become `  ---   ---  `,
    // which is two groups of dashes with a space between and matched nothing.
    // So every table typed itself out with a row of stray dashes across it.
    .replace(/^[ \t|:-]*-{3,}[ \t|:-]*\r?\n/gm, "") // table dividers
    .replace(/\|/g, "  ")                       // table pipes
    .replace(/\*\*/g, "")                        // bold markers
    .replace(/`/g, "")                          // code ticks
    .replace(/\[([^\]]*)\]\([^)]*\)?/g, "$1");    // links -> their label
}

export function Typewriter({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  const done = shown >= text.length;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setShown(text.length);
      return;
    }
    setShown(0);
    timer.current = window.setInterval(() => {
      setShown((n) => {
        const next = n + CHARS_PER_TICK;
        if (next >= text.length && timer.current) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        return Math.min(next, text.length);
      });
    }, TICK_MS);

    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [text, animate]);

  // Mid-animation we type a SYNTAX-FREE version. Showing raw markdown while it
  // types — stray asterisks, half-built table pipes — then swapping to a
  // rendered block reads as if the app briefly broke and repaired itself. The
  // reader should never see our formatting characters at all.
  if (!done) {
    return (
      <div
        onClick={() => setShown(text.length)}
        title="Click to show it all"
        className="cursor-pointer whitespace-pre-wrap leading-[1.65]"
      >
        {stripSyntax(text.slice(0, shown))}
        <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-brand-400" />
      </div>
    );
  }

  return <ChatMarkdown text={text} />;
}
