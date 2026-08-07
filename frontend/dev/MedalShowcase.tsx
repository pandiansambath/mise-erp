"use client";

// The medal, in a case.
//
// His idea, and a good one: touch the medal and it goes into a display — the
// room falls away behind glass, and the thing itself turns slowly under a
// light, the way a jeweller shows an ornament.
//
// Three things make it read as metal rather than a yellow circle:
//
// **It turns on Y, not on Z.** Spinning flat is a loading spinner. Rotating
// about the vertical axis is an OBJECT being shown to you, and it is what
// gives the rim its width as it comes round.
//
// **The highlight does not turn with it.** The light is fixed in the room, so
// the sheen sweeps ACROSS the face as the face moves underneath — that
// counter-motion is most of the illusion. A highlight painted onto the disc
// would rotate with it and read as a sticker.
//
// **The gradient has hard steps.** Polished metal is dark, then abruptly
// bright, then dark again; a smooth ramp between two browns reads as plastic.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Code-split, and client-only: a WebGL scene cannot be server-rendered,
// and the ~150KB should only arrive if somebody actually opens the case.
const ChestScene = dynamic(() => import("./ChestScene").then((m) => m.ChestScene), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

export function MedalShowcase({ open, onClose }: { open: boolean; onClose: () => void }) {
  // The citation waits until the chest has actually been broken open —
  // reading the award before you have earned it spoils the whole gesture.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!open) setOpened(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // It FITS. There is no scrolling here at all.
      //
      // He said this five times and I kept answering it by making the scroll
      // better, which was the wrong answer: "no need for scroll and all, make
      // it fit — as you are opening as popup you can take over the entire
      // page". So the case is exactly one viewport, laid out as a column. The
      // chest gets whatever height is left after the words, and the canvas
      // sizes itself to that — which is why it can no longer end up off the
      // top of the screen however far the page behind was scrolled.
      className="dev-case fixed inset-0 z-[200] overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Award"
      onClick={onClose}
    >
      {/* The room, put away.
          Nearly opaque rather than merely tinted: `backdrop-blur` is ignored
          in a few situations (and by some privacy settings), and when it was,
          the page behind stayed legible right through the award. The blur is
          a bonus on top of a background that already does the job alone. */}
      <div
        className="fixed inset-0 backdrop-blur-2xl"
        style={{
          // Flat black reads as "the page failed to load". A gallery is dark
          // but LIT — warmer near the plinth, cooler and deeper at the edges,
          // so the case sits in a room rather than in a void.
          background:
            "radial-gradient(70% 55% at 50% 34%, #1b1408 0%, #0c0a08 45%, #05060a 100%)",
        }}
      />

      {/* A shaft of light falling on the case from above. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(46% 34% at 50% 30%, rgba(255,209,128,.20), transparent 70%)," +
            "radial-gradient(80% 50% at 50% 108%, rgba(217,119,66,.14), transparent 70%)",
        }}
      />

      {/* One screen, used fully.
          Not a dialog with margins around it — "just take 1 screen fully and
          use that screen fully, just have an x close button at corner". So
          the stage IS the screen and the words float over the bottom of it,
          where there is nothing to cover. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()}>
        <ChestScene onOpened={() => setOpened(true)} />
      </div>

      <p
        className="pointer-events-none absolute inset-x-0 top-6 text-center font-mono text-[10px] tracking-[0.4em] text-[#c08a4e]"
        style={{ animation: "devFadeUp .7s .05s ease-out both" }}
      >
        ANNA UNIVERSITY
      </p>

      {/* The citation, over the foot of the screen. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-8 pt-16 text-center transition-opacity duration-700 ${
          opened ? "opacity-100" : "opacity-0"
        }`}
        style={{
          background: "linear-gradient(to top, rgba(5,6,10,.92) 30%, transparent)",
        }}
      >
        <p className="dev-gold font-display text-3xl font-semibold">Gold Medalist</p>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-[#c3d0dd]">
          Awarded to <b className="text-[#f0e2c8]">Pandian Sambath</b> for placing{" "}
          <b className="text-[#f0e2c8]">17th in the university</b> — B.Tech Information
          Technology, 92%.
        </p>
        <p className="mt-2 font-mono text-[10px] tracking-[0.22em] text-[#7d6244]">
          RANK LIST · APRIL / MAY 2023 EXAMINATIONS
        </p>
      </div>

      {/* The way out. A corner, like every full-screen thing anybody has
          closed before — nothing to explain. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-10 grid h-11 w-11 place-items-center rounded-full border border-[#c08a4e]/35 text-lg text-[#c08a4e] transition hover:border-[#c08a4e]/70 hover:bg-[#c08a4e]/10 hover:text-[#f0d5a8]"
      >
        ✕
      </button>
    </div>
  );
}
