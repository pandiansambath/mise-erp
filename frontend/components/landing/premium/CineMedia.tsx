"use client";

// Full-bleed cinematic backdrop: a crisp still with up to TWO chained one-shot
// "morph" films layered above it. When the scene enters view (or immediately,
// with `eager`), film 1 fades in and plays once; if a second film is chained
// it takes over on the exact frame the first ended on; then the layer fades
// away to the still — motion that settles, never a loop or a scrub.
//
// Films play on every device (they're ~1MB each and pre-warmed into the HTTP
// cache by the landing shell). Only data-saver and reduced-motion visitors
// get stills alone.

import { useEffect, useRef, useState } from "react";
import { useInView, usePrefersReducedMotion } from "./bits";

type Stage = "idle" | "v0" | "v1" | "settled";

export default function CineMedia({
  still,
  videos = [],
  dim = 0.45,
  eager = false,
  className = "",
}: {
  /** file name under /experience, without extension */
  still: string;
  /** up to two /experience/film clips (no extension), played back-to-back */
  videos?: string[];
  /** 0–1 darkness of the veil laid over the media */
  dim?: number;
  /** start playing as soon as allowed instead of waiting for scroll-into-view */
  eager?: boolean;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = usePrefersReducedMotion();
  const v0 = useRef<HTMLVideoElement>(null);
  const v1 = useRef<HTMLVideoElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");

  useEffect(() => {
    type NetInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    setAllowed(videos.length > 0 && !reduced && !conn?.saveData);
  }, [videos.length, reduced]);

  const go = eager || inView;
  useEffect(() => {
    if (!go || !allowed || stage !== "idle") return;
    const el = v0.current;
    if (!el) return;
    el.play()
      .then(() => setStage("v0"))
      .catch(() => setStage("settled"));
  }, [go, allowed, stage]);

  const advance = (from: 0 | 1) => {
    if (from === 0 && videos[1] && v1.current) {
      v1.current
        .play()
        .then(() => setStage("v1"))
        .catch(() => setStage("settled"));
    } else {
      setStage("settled");
    }
  };

  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <img
        src={`/experience/${still}.jpg`}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`absolute inset-0 h-full w-full object-cover ${reduced || !go ? "" : "mise-l-ken"}`}
      />
      {allowed ? (
        <>
          <video
            ref={v0}
            muted
            playsInline
            preload="none"
            src={`/experience/film/${videos[0]}.mp4`}
            onEnded={() => advance(0)}
            onError={() => setStage("settled")}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: stage === "v0" ? 1 : 0, transition: "opacity 600ms ease" }}
          />
          {videos[1] ? (
            <video
              ref={v1}
              muted
              playsInline
              preload="none"
              src={`/experience/film/${videos[1]}.mp4`}
              onEnded={() => advance(1)}
              onError={() => setStage("settled")}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: stage === "v1" ? 1 : 0, transition: "opacity 400ms ease" }}
            />
          ) : null}
        </>
      ) : null}
      <div className="absolute inset-0" style={{ background: `rgba(2,8,6,${dim})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-transparent to-ink-950/80" />
    </div>
  );
}
