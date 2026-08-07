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

import { useEffect } from "react";

export function MedalShowcase({ open, onClose }: { open: boolean; onClose: () => void }) {
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

        {/* The case, and the medal inside it.
            The lid swings first and the medal rises out after — the beat
            before the reveal is the whole reason a jewellery case feels like
            an occasion rather than a picture. */}
        <div className="relative mx-auto mt-7 h-64 w-64" style={{ perspective: "1100px" }}>
          {/* The lid, hinged along its back edge. */}
          <div
            aria-hidden
            className="dev-lid absolute inset-x-6 top-0 h-16 rounded-t-2xl border border-[#8a5a22]"
            style={{
              background:
                "linear-gradient(175deg, #2b1808 0%, #7c4f1d 38%, #c99544 62%, #4a2b0f 100%)",
              boxShadow: "0 10px 26px rgba(0,0,0,.55)",
            }}
          />

          {/* Light escaping as it opens. */}
          <div
            aria-hidden
            className="dev-case-burst pointer-events-none absolute inset-x-0 top-8 h-40 blur-[38px]"
            style={{ background: "radial-gradient(ellipse at 50% 60%, #ffd98a, transparent 70%)" }}
          />

          <div
            aria-hidden
            className="dev-case-glow absolute inset-6 rounded-full blur-[46px]"
            style={{ background: "radial-gradient(circle, #ffca6e 0%, transparent 68%)" }}
          />

          <div className="dev-medal-rise absolute inset-x-4 top-4 bottom-14">
          <div className="dev-medal-spin relative h-full w-full">
            <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-[0_18px_34px_rgba(0,0,0,.6)]">
              <defs>
                {/* Body colour. The bright stop sits narrow and off-centre —
                    that is the lit face, not the middle of the disc. */}
                <linearGradient id="mBody" x1="8%" y1="0%" x2="92%" y2="100%">
                  <stop offset="0%" stopColor="#6d3d12" />
                  <stop offset="22%" stopColor="#c88a35" />
                  <stop offset="38%" stopColor="#ffe6a8" />
                  <stop offset="46%" stopColor="#f0bd6a" />
                  <stop offset="62%" stopColor="#b8752e" />
                  <stop offset="82%" stopColor="#e8b45f" />
                  <stop offset="100%" stopColor="#5f340f" />
                </linearGradient>
                <linearGradient id="mRim" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffeec2" />
                  <stop offset="40%" stopColor="#c08432" />
                  <stop offset="70%" stopColor="#7c4a17" />
                  <stop offset="100%" stopColor="#ffdc94" />
                </linearGradient>
                <radialGradient id="mFace" cx="38%" cy="30%">
                  <stop offset="0%" stopColor="#fff3d0" stopOpacity=".85" />
                  <stop offset="55%" stopColor="#e3ab52" stopOpacity=".25" />
                  <stop offset="100%" stopColor="#6d3d12" stopOpacity=".45" />
                </radialGradient>
              </defs>

              <circle cx="100" cy="100" r="92" fill="url(#mRim)" />
              <circle cx="100" cy="100" r="83" fill="url(#mBody)" />
              <circle cx="100" cy="100" r="83" fill="url(#mFace)" />
              {/* Milled edge — the little notches around a struck coin. */}
              {Array.from({ length: 72 }, (_, i) => (
                <line
                  key={i}
                  x1="100" y1="9" x2="100" y2="17"
                  stroke="#3d2109"
                  strokeOpacity=".38"
                  strokeWidth="2"
                  transform={`rotate(${i * 5} 100 100)`}
                />
              ))}
              <circle cx="100" cy="100" r="71" fill="none" stroke="#facc7d" strokeOpacity=".55" strokeWidth="1.5" />
              <circle cx="100" cy="100" r="66" fill="none" stroke="#5f340f" strokeOpacity=".45" strokeWidth="1" />

              {/* Laurels, because a medal without them is a coin. */}
              {[-1, 1].map((side) => (
                <path
                  key={side}
                  d="M100 158 C 74 150, 58 128, 56 100 C 66 108, 74 112, 82 112 C 72 104, 66 92, 66 80 C 76 88, 84 92, 92 92"
                  fill="none"
                  stroke="#7c4a17"
                  strokeOpacity=".5"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  transform={side === -1 ? "scale(-1,1) translate(-200,0)" : undefined}
                />
              ))}

              <text
                x="100" y="88"
                textAnchor="middle"
                className="font-display"
                style={{ fontSize: 46, fontWeight: 700, fill: "#4a2708", letterSpacing: "-1px" }}
              >
                17
              </text>
              <text
                x="100" y="108"
                textAnchor="middle"
                style={{ fontSize: 11, fill: "#5f340f", letterSpacing: "3px" }}
              >
                RANK
              </text>
              <text
                x="100" y="130"
                textAnchor="middle"
                style={{ fontSize: 15, fontWeight: 700, fill: "#4a2708", letterSpacing: "1px" }}
              >
                92%
              </text>
            </svg>

            {/* The light in the room. Fixed while the medal turns beneath it —
                which is why it reads as a reflection and not a decal. */}
            <span
              aria-hidden
              className="dev-medal-sheen pointer-events-none absolute inset-0 rounded-full"
            />
          </div>
          </div>

          {/* The front of the case, in front of the medal — so the medal
              genuinely rises OUT of something rather than floating above a
              drawing of a box. */}
          <div
            aria-hidden
            className="absolute inset-x-2 bottom-0 h-16 rounded-b-2xl border border-[#8a5a22]"
            style={{
              background:
                "linear-gradient(185deg, #4a2b0f 0%, #7c4f1d 34%, #c99544 58%, #2b1808 100%)",
              boxShadow: "0 16px 34px rgba(0,0,0,.6), inset 0 2px 6px rgba(255,214,140,.28)",
            }}
          />
          {/* The velvet line where the two halves meet. */}
          <div
            aria-hidden
            className="absolute inset-x-3 bottom-[3.9rem] h-1 rounded-full"
            style={{ background: "linear-gradient(90deg, transparent, #1b0f05, transparent)" }}
          />
        </div>

        <p
          className="dev-gold mt-8 font-display text-2xl font-semibold"
          style={{ animation: "devFadeUp .7s .2s ease-out both" }}
        >
          Gold Medalist
        </p>

        <p
          className="mt-3 text-sm leading-relaxed text-[#c3d0dd]"
          style={{ animation: "devFadeUp .7s .28s ease-out both" }}
        >
          Awarded to <b className="text-[#f0e2c8]">Pandian Sambath</b> for placing{" "}
          <b className="text-[#f0e2c8]">17th in the university</b> — B.Tech Information
          Technology, 92%.
        </p>
        <p
          className="mt-2 font-mono text-[10px] tracking-[0.22em] text-[#7d6244]"
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
