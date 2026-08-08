"use client";

// A line for the room.
//
// His idea, and it fills the one piece of dead space on the screen: the band
// beside the clock, which had nothing in it. A kitchen wall is read by
// everyone who walks past, dozens of times a shift — that is a rare amount of
// attention, and it was being spent on nothing.
//
// Two rules it lives by:
//
// **It changes once a day, not on every render.** A line that changes while
// you look at it is decoration; one that is the same all Tuesday and different
// on Wednesday is something people notice and mention. The day itself picks
// it, so every device in the building shows the same line — two tablets
// disagreeing would give the game away.
//
// **It never fails.** There is a written set that always works, and the AI is
// asked only for a fresher one in the background. A wall screen that shows an
// error where a kind sentence should be is worse than one that never tried.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const LINES: { text: string; by?: string }[] = [
  { text: "Cooking is a craft that has to be earned every service." },
  { text: "Mise en place — everything in its place, before it is needed." },
  { text: "The plate remembers who cared and who was in a hurry." },
  { text: "Nobody ever complained a kitchen was too clean." },
  { text: "A good shift is quiet. That quiet is somebody's preparation." },
  { text: "Taste it. Then taste it again before it leaves." },
  { text: "Waste is money you already spent and never served." },
  { text: "Look after the person beside you and the service looks after itself." },
  { text: "First in the pot, first out of it. Rotate everything." },
  { text: "Speed comes from practice. Rushing comes from panic. They are not the same." },
  { text: "Every plate that goes out has your name on it." },
  { text: "The best chefs are the ones who clean as they go." },
  { text: "Small savings, every day, are what a good year is made of." },
  { text: "If it is not right, it does not leave the pass." },
  { text: "Prep like tomorrow's you is watching." },
];

/** Which line today. The DATE chooses, so every device agrees. */
function todaysIndex(): number {
  const d = new Date();
  const key = Number(`${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}`);
  return key % LINES.length;
}

export function KioskQuote() {
  const [line, setLine] = useState<{ text: string; by?: string } | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    // Yesterday's fetched line is still in storage; showing it for a moment
    // beats showing nothing while a request is in flight.
    try {
      const raw = localStorage.getItem("mise.kiosk.quote");
      if (raw) {
        const saved = JSON.parse(raw) as { on: string; text: string; by?: string };
        if (saved.on === today && saved.text) {
          setLine({ text: saved.text, by: saved.by });
          return;
        }
      }
    } catch {
      /* fall through to the written set */
    }

    setLine(LINES[todaysIndex()]);

    // A fresher one, if the assistant is configured and feels like it. Failure
    // is silent by design — the written line is already on screen.
    api
      .post<{ text?: string }>("/assistant/kiosk-quote", { on: today })
      .then((r) => {
        if (!r?.text) return;
        setLine({ text: r.text });
        try {
          localStorage.setItem(
            "mise.kiosk.quote",
            JSON.stringify({ on: today, text: r.text }),
          );
        } catch {
          /* nothing to do */
        }
      })
      .catch(() => {});
  }, []);

  if (!line) return null;

  return (
    <figure className="relative mt-6 max-w-xl sm:mt-10">
      <span
        aria-hidden
        className="absolute -left-1 -top-6 select-none font-display text-6xl leading-none text-fg/10 sm:-top-8 sm:text-7xl"
      >
        &ldquo;
      </span>
      <blockquote className="relative font-display text-lg leading-snug text-fg-soft sm:text-2xl">
        {line.text}
      </blockquote>
      <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-[0.28em] text-fg-faint">
        {line.by ?? "today"}
      </figcaption>
    </figure>
  );
}
