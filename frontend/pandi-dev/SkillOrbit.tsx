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

type Body = { label: string; ring: number };

// From the résumé, grouped by how close they are to the daily work. Ring 0 is
// what he writes every day; ring 2 is what he reaches for.
const BODIES: Body[] = [
  { label: "Python", ring: 0 },
  { label: "SQL", ring: 0 },
  { label: "AWS", ring: 0 },
  { label: "Django REST", ring: 1 },
  { label: "Docker", ring: 1 },
  { label: "Kubernetes", ring: 1 },
  { label: "Terraform", ring: 1 },
  { label: "Lambda", ring: 2 },
  { label: "ECS", ring: 2 },
  { label: "SQS", ring: 2 },
  { label: "DynamoDB", ring: 2 },
  { label: "Apache Camel", ring: 2 },
  { label: "GitHub Actions", ring: 2 },
];

// radius in px, seconds per revolution, direction
const RINGS = [
  { r: 96, period: 26, dir: 1 },
  { r: 148, period: 42, dir: -1 },
  { r: 205, period: 64, dir: 1 },
];

export function SkillOrbit({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Auto-swap the portrait. 65 seconds, as asked — long enough that it reads
  // as the page breathing rather than a slideshow demanding attention.
  useEffect(() => {
    if (photos.length < 2 || paused) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % photos.length), 65_000);
    return () => window.clearInterval(t);
  }, [photos.length, paused]);

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
      className="relative mx-auto grid aspect-square w-full max-w-[min(30rem,88vw)] place-items-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* The rings themselves — faint, so the chips read as the content */}
      {RINGS.map((ring, ri) => (
        <span
          key={ri}
          aria-hidden
          className="absolute rounded-full border border-white/[0.06]"
          style={{
            width: ring.r * 2,
            height: ring.r * 2,
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
        const onRing = BODIES.filter((b) => b.ring === ri);
        return (
          <div
            key={`o${ri}`}
            aria-hidden
            className="absolute inset-0 grid place-items-center"
            style={
              still
                ? undefined
                : {
                    animation: `devOrbit ${ring.period}s linear infinite${ring.dir < 0 ? " reverse" : ""}`,
                    animationPlayState: paused ? "paused" : "running",
                  }
            }
          >
            {onRing.map((b, bi) => {
              const angle = (360 / onRing.length) * bi;
              return (
                <span
                  key={b.label}
                  className="absolute"
                  style={{
                    transform: `rotate(${angle}deg) translateX(${ring.r}px) rotate(-${angle}deg)`,
                  }}
                >
                  <span
                    className="block whitespace-nowrap rounded-full border border-white/10 bg-[#0d1219]/85 px-2.5 py-1 font-mono text-[10px] tracking-wide text-[#a9bdd2] backdrop-blur-sm sm:text-[11px]"
                    style={
                      still
                        ? undefined
                        : {
                            // Undo the shell's rotation so the words stay level.
                            animation: `devOrbit ${ring.period}s linear infinite${ring.dir < 0 ? "" : " reverse"}`,
                            animationPlayState: paused ? "paused" : "running",
                          }
                    }
                  >
                    {b.label}
                  </span>
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
      <div className="relative z-10 h-40 w-40 sm:h-48 sm:w-48 lg:h-56 lg:w-56">
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
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow:
                "inset 0 0 26px -6px rgba(6,10,15,.95), inset 0 0 0 1px rgba(255,255,255,.10)",
            }}
          />
        </span>
      </div>
    </div>
  );
}
