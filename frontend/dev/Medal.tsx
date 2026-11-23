"use client";

import { useEffect } from "react";

/** The medal, without WebGL: struck gold with an engraved rank, hung on a
 *  ribbon in the page's copper and teal, and a light crossing it the way it
 *  crosses metal you turn in your hand (the same sweep as the gold text). */
export function Medal() {
  return (
    <div data-medal className="absolute inset-0 grid place-items-center pb-16">
      <div className="relative mt-24" style={{ animation: "devFadeUp 1s .2s ease-out both" }}>
        {/* The ribbon: two straps meeting behind the disc. */}
        <div aria-hidden className="absolute bottom-[78%] left-1/2 flex -translate-x-1/2">
          {[-15, 15].map((deg) => (
            <span
              key={deg}
              className="block h-[150px] w-[46px] sm:h-[180px] sm:w-[54px]"
              style={{
                transform: `rotate(${deg}deg)`,
                transformOrigin: deg < 0 ? "100% 100%" : "0% 100%",
                background:
                  "linear-gradient(90deg, #8a4a22 0 18%, #d97742 18% 34%, #2dd4bf 34% 66%, #d97742 66% 82%, #8a4a22 82%)",
                boxShadow: "inset 0 -30px 40px -20px rgba(0,0,0,.6)",
              }}
            />
          ))}
        </div>
        {/* The disc. */}
        <div
          className="relative grid h-[210px] w-[210px] place-items-center overflow-hidden rounded-full sm:h-[260px] sm:w-[260px]"
          style={{
            background:
              "radial-gradient(circle at 34% 28%, #fff7dc 0%, #ffd987 16%, #e3a640 42%, #a96a1d 70%, #6a3c0d 100%)",
            boxShadow:
              "0 34px 90px -24px rgba(255,180,80,.6), inset 0 0 0 5px rgba(255,236,180,.55), inset 0 0 0 13px rgba(140,82,18,.55), inset 0 0 0 15px rgba(255,226,160,.35), inset 0 -14px 34px rgba(70,35,0,.55)",
          }}
        >
          <div className="relative text-center" style={{ color: "#5a340b", textShadow: "0 1px 0 rgba(255,242,205,.75), 0 -1px 0 rgba(60,30,0,.35)" }}>
            <div className="text-[13px] tracking-[0.42em] sm:text-[14px]">RANK</div>
            <div className="text-[76px] font-bold leading-[0.95] sm:text-[94px]">17</div>
            <div className="mt-1 text-[9px] tracking-[0.3em] sm:text-[10px]">ANNA UNIVERSITY</div>
          </div>
          {/* The light crossing the metal. */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, transparent 30%, rgba(255,250,235,.55) 46%, rgba(255,250,235,0) 58%)",
              backgroundSize: "300% 100%",
              mixBlendMode: "soft-light",
              animation: "devGoldSweep 6s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** In the room's place when its code did not arrive: the medal, and the words
 *  that come with it. */
export function PlainAward({ onOpened }: { onOpened?: () => void }) {
  useEffect(() => onOpened?.(), [onOpened]);
  return <Medal />;
}
