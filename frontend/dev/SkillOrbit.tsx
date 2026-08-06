"use client";

// A solar system where the planets are the things he actually works with.
//
// The ask, verbatim: *"any solar system (but instead of planet I need my useful
// real skills to revolve me)"*. So the portrait is the star, and every skill
// from the résumé is a body in orbit around it — the ones used daily on the
// tightest, fastest rings, the specialist ones further out and slower, exactly
// as gravity would have it.
//
// Three things that keep it from looking like a gimmick:
//
// **Real orbital mechanics, cheaply.** Inner rings are faster. That is Kepler,
// and eyes know it even when the person watching could not name it — a system
// where everything moves at one speed reads as a spinning graphic, not a
// system.
//
// **The labels never rotate.** A counter-rotation on each chip keeps text
// upright while its orbit carries it round. Text that tumbles is unreadable
// and instantly cheap-looking.
//
// **It is CSS, not a render loop.** Thirty-odd elements animated on the
// compositor cost nothing; the same thing in JavaScript would drop frames on
// the phone this is most likely to be opened on.

import { useEffect, useRef, useState } from "react";

import { DOCS, HUE_OF, ORBIT_RINGS } from "@/dev/skills";

// Radii are a FRACTION of the container, not pixels. The old fixed 96/148/205
// meant the outer ring was off-screen on a phone — the device most likely to
// open this page. Everything scales with the box now.
// Kept comfortably inside the box: a chip sits ON its ring, so a radius of
// exactly half the container would hang the outer labels over the edge and
// give a phone a horizontal scrollbar.
const RINGS = ORBIT_RINGS.map((r, i) => ({ ...r, frac: [0.245, 0.335, 0.425][i] }));

export function SkillOrbit({
  photos,
  onOpenAlbum,
}: {
  photos: string[];
  /** Clicking the portrait opens the album. A separate button underneath
   *  was one more thing on a page that is already busy, and the photo is
   *  the obvious thing to press. */
  onOpenAlbum?: () => void;
}) {
  const [i, setI] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Nothing pauses this. Hover-to-pause was tried and removed twice: on a
  // phone `onMouseEnter` fires on tap and `onMouseLeave` never does, and on a
  // desktop the orbit fills half the screen so the pointer is inside it nearly
  // always. Either way it stood still. He asked for infinite revolution, and a
  // system that stops when you look at it is not a system.

  // Auto-swap the portrait every 5 seconds.
  //
  // Independent of `paused` on purpose: pausing is about not yanking the
  // orbit out from under a pointer, and it must never be able to stop the
  // photographs — the last version tied the two together, so a stuck pause
  // froze the portrait as well.
  useEffect(() => {
    if (photos.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % photos.length), 5_000);
    return () => window.clearInterval(t);
  }, [photos.length]);

  // Respect a reader who has asked the OS for less motion. Thirteen orbiting
  // chips is exactly the kind of thing that setting exists for.
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(mq.matches);
    const on = () => setStill(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <div
      ref={wrap}
      className="relative mx-auto grid aspect-square w-full max-w-[min(34rem,92vw)] place-items-center [container-type:size]"
    >
      {/* The rings themselves — faint, so the chips read as the content */}
      {RINGS.map((ring, ri) => (
        <span
          key={ri}
          aria-hidden
          className="absolute rounded-full border border-white/[0.06]"
          style={{
            width: `${ring.frac * 200}%`,
            height: `${ring.frac * 200}%`,
            // A whisper of the two brand strands, so the rings belong to the
            // same system as the chain background rather than sitting on top.
            boxShadow:
              ri === 0
                ? "0 0 40px -12px rgba(217,119,66,.5), inset 0 0 30px -18px rgba(45,212,191,.6)"
                : "none",
          }}
        />
      ))}

      {/* Orbiting skills. One rotating shell per ring, each chip pinned to its
          own angle inside it, each chip counter-rotating so it stays upright. */}
      {RINGS.map((ring, ri) => {
        const onRing = ring.items;
        return (
          <div
            key={`o${ri}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center"
            style={
              still
                ? undefined
                : {
                    animation: `devOrbit ${ring.period}s linear infinite${ring.dir < 0 ? " reverse" : ""}`,
                  }
            }
          >
            {onRing.map((label, bi) => {
              const angle = (360 / onRing.length) * bi;
              const hue = HUE_OF[label] ?? "#8aa0b6";
              return (
                <span
                  key={label}
                  className="absolute"
                  style={{
                    // translateX in % of the CHIP is meaningless, so the offset
                    // rides on a wrapper sized to the ring instead.
                    transform: `rotate(${angle}deg) translateX(${ring.frac * 100}cqw) rotate(-${angle}deg)`,
                  }}
                >
                  <a
                    href={DOCS[label] ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`${label} — official docs`}
                    // The orbit is decoration until you can click it. Now every
                    // body in the system opens its own documentation.
                    className="pointer-events-auto block whitespace-nowrap rounded-full border bg-[#0d1219]/85 px-2 py-[3px] font-mono text-[9px] tracking-wide backdrop-blur-sm transition hover:brightness-150 sm:px-2.5 sm:py-1 sm:text-[11px]"
                    style={{
                      // Coloured by family, so the orbit says WHICH world each
                      // skill belongs to without a legend.
                      borderColor: `${hue}44`,
                      color: hue,
                      ...(still
                        ? {}
                        : {
                            // Undo the shell's rotation so the words stay level.
                            animation: `devOrbit ${ring.period}s linear infinite${ring.dir < 0 ? "" : " reverse"}`,
                                  }),
                    }}
                  >
                    {label}
                  </a>
                </span>
              );
            })}
          </div>
        );
      })}

      {/* The star: him.
          Bigger than it was — on a desktop the portrait was a 128px square in
          the middle of a 6xl layout, which read as an afterthought on the page
          that is about him.

          And GRADED into the page. A bright daylight photo dropped on a near
          black UI reads as two things on one screen — his words: "I can see UI
          separate and my photo sitting separate". Four passes fix it, and all
          four matter:

            1. tone      — pull brightness and saturation toward the page
            2. duotone   — a soft-light wash of the same copper/teal the whole
                           site runs on, so his photo is lit by this room
            3. feather   — a radial mask dissolving the edge into the
                           background instead of a hard cut-out circle
            4. shadow    — an inset dark rim, so he sits IN the page, not ON it
      */}
      <button
        type="button"
        onClick={onOpenAlbum}
        aria-label="Open the photo album"
        title="Open the album"
        className="group relative z-10 h-40 w-40 rounded-full sm:h-48 sm:w-48 lg:h-56 lg:w-56"
      >
        <span
          aria-hidden
          className="absolute -inset-4 rounded-full opacity-70 blur-2xl"
          style={{
            background: "conic-gradient(from 0deg, #d97742, #2dd4bf, transparent, #d97742)",
            animation: still ? undefined : "devSpin 8s linear infinite",
          }}
        />
        <span
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{
            // 3 — the edge dissolves rather than stopping. This is the single
            // biggest reason a portrait stops looking pasted on.
            WebkitMaskImage:
              "radial-gradient(circle at 50% 45%, #000 58%, rgba(0,0,0,.85) 76%, transparent 97%)",
            maskImage:
              "radial-gradient(circle at 50% 45%, #000 58%, rgba(0,0,0,.85) 76%, transparent 97%)",
          }}
        >
          {photos.map((src, n) => (
            <img
              key={src}
              src={src}
              alt={n === 0 ? "Pandian Sambath" : ""}
              aria-hidden={n !== 0}
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                // Cross-fade AND a slow drift, so a swap is a move rather than
                // a cut. "Don't swap like a raw" was the whole note.
                opacity: n === i ? 1 : 0,
                transform: n === i ? "scale(1)" : "scale(1.08)",
                transition: "opacity 1.6s ease, transform 2.4s ease",
                // 1 — meet the page's exposure. Left alone the photo is the
                // brightest thing on a near-black screen and wins every time.
                filter: "brightness(.86) contrast(1.06) saturate(.82)",
              }}
            />
          ))}

          {/* 2 — lit by this room. soft-light tints without flattening, so he
              still looks like a photograph and not a coloured shape. */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(150deg, rgba(217,119,66,.30), transparent 45%, rgba(45,212,191,.24))",
              mixBlendMode: "soft-light",
            }}
          />
          {/* The page's own darkness, pulled across the bottom of the frame so
              the portrait grounds into the background instead of floating. */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(6,10,15,.55), transparent 52%)",
            }}
          />
          {/* 4 — an inset rim. Sitting IN the page rather than on it. */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full transition-shadow duration-500 group-hover:shadow-[inset_0_0_26px_-6px_rgba(6,10,15,.95),inset_0_0_0_1px_rgba(240,160,100,.55)]"
            style={{
              boxShadow:
                "inset 0 0 26px -6px rgba(6,10,15,.95), inset 0 0 0 1px rgba(255,255,255,.10)",
            }}
          />
        </span>
        {/* Says what the photo does, without a button taking up room. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-6 text-center font-mono text-[10px] tracking-wide text-[#5b6e85] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        >
          ⌗ open the album
        </span>
      </button>
    </div>
  );
}
