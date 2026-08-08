"use client";

// A real clock on the wall.
//
// The kind of thing that makes somebody stop and look. A digital readout tells
// you the time; a clock face tells you the time AND that the screen is alive,
// from across a room, without being read. So this shows both — hands sweeping,
// and the digits in the middle for the glance that needs a number.
//
// Three details that separate a clock from a clip-art clock:
//
// **The second hand sweeps.** It moves continuously rather than stepping once
// a second, the way a good mechanical movement does. Stepping reads as cheap
// because it is what a battery clock does.
//
// **The hour hand drifts.** At half past, a real hour hand sits halfway
// between the numbers — it does not jump on the hour. Getting this wrong is
// the single most common tell in a hand-built clock.
//
// **It is drawn, not animated by JavaScript.** One rAF loop updates three
// numbers; the hands are SVG transforms. Nothing re-renders the markup.

import { useEffect, useRef } from "react";

/** The same instant, expressed as another zone's wall time. */
function zoned(at: Date, tz: string): Date {
  try {
    return new Date(at.toLocaleString("en-US", { timeZone: tz }));
  } catch {
    return at; // an unknown zone should not stop the clock
  }
}

export function AnalogClock({ size = 260, tz }: { size?: number; tz?: string }) {
  const hour = useRef<SVGLineElement>(null);
  const minute = useRef<SVGLineElement>(null);
  const second = useRef<SVGLineElement>(null);
  const digital = useRef<SVGTextElement>(null);
  const secs = useRef<SVGTextElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      // In the RESTAURANT's zone, not the browser's.
      //
      // A wall clock in London showing Chennai time is worse than no clock:
      // people read it, trust it, and clock in against it. Reading the parts
      // through Intl is the only way to get another zone's wall time without
      // pulling in a date library.
      const real = new Date();
      const now = tz ? zoned(real, tz) : real;
      const ms = now.getMilliseconds() / 1000;
      const s = now.getSeconds() + ms;
      const m = now.getMinutes() + s / 60;
      // The hour hand carries the minutes with it — that drift is what makes
      // a clock face look real rather than drawn.
      const h = (now.getHours() % 12) + m / 60;

      second.current?.setAttribute("transform", `rotate(${s * 6} 100 100)`);
      minute.current?.setAttribute("transform", `rotate(${m * 6} 100 100)`);
      hour.current?.setAttribute("transform", `rotate(${h * 30} 100 100)`);
      // Hours and minutes big; seconds and the meridiem small beside them.
      // One long string at one size either overflows the face or forces the
      // whole readout down to a size nobody can read from the door.
      if (digital.current) {
        digital.current.textContent = now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }).replace(/\s*[AaPp][Mm]\s*$/, "");
      }
      if (secs.current) {
        const ss = String(now.getSeconds()).padStart(2, "0");
        const half = now.getHours() < 12 ? "AM" : "PM";
        secs.current.textContent = `${ss} ${half}`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [tz]);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="clockFace" cx="50%" cy="38%">
            <stop offset="0%" stopColor="rgba(255,255,255,.09)" />
            <stop offset="100%" stopColor="rgba(255,255,255,.015)" />
          </radialGradient>
        </defs>

        <circle cx="100" cy="100" r="96" fill="url(#clockFace)" />
        <circle
          cx="100"
          cy="100"
          r="96"
          fill="none"
          stroke="currentColor"
          strokeOpacity=".14"
          strokeWidth="1.5"
        />

        {/* Sixty marks: the twelve that matter, longer and brighter. A face
            with only four marks reads as a logo, not a clock. */}
        {Array.from({ length: 60 }, (_, i) => {
          const big = i % 5 === 0;
          return (
            <line
              key={i}
              x1="100"
              y1={big ? 12 : 15}
              x2="100"
              y2={big ? 24 : 18}
              stroke="currentColor"
              strokeOpacity={big ? 0.55 : 0.2}
              strokeWidth={big ? 2.4 : 1}
              strokeLinecap="round"
              transform={`rotate(${i * 6} 100 100)`}
            />
          );
        })}

        {/* The printed face, drawn BEFORE the hands.
            A real clock has its numerals under the movement, and SVG paints in
            document order — so putting the readout here is what actually makes
            the hands sweep across it. My first attempt used a negative
            z-index on an HTML overlay, which did not put it under the hands at
            all: it put it behind the whole clock, where it could not be seen. */}
        <text
          ref={digital}
          x="100"
          y="132"
          textAnchor="middle"
          className="font-display"
          style={{ fontSize: 25, fontWeight: 600, fill: "currentColor", opacity: 0.92 }}
        />
        <text
          ref={secs}
          x="100"
          y="149"
          textAnchor="middle"
          className="font-mono"
          // `currentColor`, like the hour and minute. The brand accent is red on a
          // burgundy theme and it read as an alert rather than a time — his note:
          // "seconds and am should be in black text not red". Following the text
          // colour also means it stays legible on a light theme and a dark one.
          style={{ fontSize: 10, fill: "currentColor", opacity: 0.62, letterSpacing: "1.5px" }}
        />

        <line
          ref={hour}
          x1="100"
          y1="108"
          x2="100"
          y2="56"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          opacity=".92"
        />
        <line
          ref={minute}
          x1="100"
          y1="110"
          x2="100"
          y2="34"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".8"
        />
        <line
          ref={second}
          x1="100"
          y1="118"
          x2="100"
          y2="26"
          stroke="var(--color-brand-400)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="100" cy="100" r="4.5" fill="var(--color-brand-400)" />
        <circle cx="100" cy="100" r="1.6" fill="var(--color-shell, #0b1220)" />
      </svg>

    </div>
  );
}
