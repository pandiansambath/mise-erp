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
  loading: () => <div className="mx-auto h-[22rem] w-full max-w-md" />,
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
      // Covers everything, and scrolls if the case is taller than the screen.
      //
      // It was `place-items-center` on a fixed box: content taller than the
      // viewport then overflowed at BOTH ends and the top of the medal was
      // simply unreachable — the same centring trap as the main page. Items
      // start from the top and the whole thing scrolls instead.
      className="dev-case fixed inset-0 z-[200] overflow-y-auto overscroll-contain px-5 py-10"
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
      <div className="fixed inset-0 bg-[#05070b]/[0.97] backdrop-blur-2xl" />

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

      <div
        className="relative mx-auto flex min-h-full w-full max-w-lg flex-col justify-center text-center"
        // The case is the subject; clicking it must not dismiss it.
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="font-mono text-[10px] tracking-[0.4em] text-[#c08a4e]"
          style={{ animation: "devFadeUp .7s .05s ease-out both" }}
        >
          ANNA UNIVERSITY
        </p>

        {/* The chest. Break it open and the medal is inside.
            Real geometry under real lights — a moving specular highlight is
            the one thing a gradient cannot fake, and it is most of what makes
            gold look like gold. */}
        <div className="relative mt-4">
          <div
            aria-hidden
            className="dev-case-glow pointer-events-none absolute inset-x-8 top-10 h-56 rounded-full blur-[60px]"
            style={{ background: "radial-gradient(circle, #ffca6e 0%, transparent 68%)" }}
          />
          <ChestScene onOpened={() => setOpened(true)} />
        </div>

        <p
          className={`dev-gold mt-2 font-display text-2xl font-semibold transition-opacity duration-700 ${opened ? "opacity-100" : "opacity-0"}`}
          style={{ animation: "devFadeUp .7s .2s ease-out both" }}
        >
          Gold Medalist
        </p>

        <p
          className={`mt-3 text-sm leading-relaxed text-[#c3d0dd] transition-opacity duration-700 delay-150 ${opened ? "opacity-100" : "opacity-0"}`}
          style={{ animation: "devFadeUp .7s .28s ease-out both" }}
        >
          Awarded to <b className="text-[#f0e2c8]">Pandian Sambath</b> for placing{" "}
          <b className="text-[#f0e2c8]">17th in the university</b> — B.Tech Information
          Technology, 92%.
        </p>
        <p
          className={`mt-2 font-mono text-[10px] tracking-[0.22em] text-[#7d6244] transition-opacity duration-700 delay-300 ${opened ? "opacity-100" : "opacity-0"}`}
          style={{ animation: "devFadeUp .7s .34s ease-out both" }}
        >
          RANK LIST · APRIL / MAY 2023 EXAMINATIONS
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-8 rounded-full border border-[#c08a4e]/40 px-5 py-2 font-mono text-[10px] tracking-[0.24em] text-[#c08a4e] transition hover:bg-[#c08a4e]/10 hover:text-[#f0d5a8]"
          style={{ animation: "devFadeUp .7s .42s ease-out both" }}
        >
          CLOSE THE CASE
        </button>
      </div>
    </div>
  );
}
