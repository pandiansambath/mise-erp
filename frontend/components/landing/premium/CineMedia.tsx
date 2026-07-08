"use client";

// Full-bleed cinematic backdrop: a crisp still, with an optional one-shot
// "morph" video layered above it. When the section scrolls into view the video
// fades in, plays ONCE (its final frame matches the still), then fades away —
// a moment of motion that settles, never a scrubbed or looping distraction.
// Mobile & data-saver & reduced-motion visitors get the still only.

import { useEffect, useRef, useState } from "react";
import { useInView, usePrefersReducedMotion } from "./bits";

export default function CineMedia({
  still,
  video,
  dim = 0.45,
  className = "",
}: {
  /** file name under /experience, without extension */
  still: string;
  /** file name under /experience/film, without extension */
  video?: string;
  /** 0–1 darkness of the veil laid over the media */
  dim?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const reduced = usePrefersReducedMotion();
  const vidRef = useRef<HTMLVideoElement>(null);
  const [showVideo, setShowVideo] = useState(false); // video layer visible
  const [wantVideo, setWantVideo] = useState(false); // device allows video

  useEffect(() => {
    type NetInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    setWantVideo(
      Boolean(video) && !reduced && window.innerWidth >= 768 && !conn?.saveData,
    );
  }, [video, reduced]);

  useEffect(() => {
    const el = vidRef.current;
    if (!inView || !wantVideo || !el) return;
    el.play()
      .then(() => setShowVideo(true))
      .catch(() => setShowVideo(false)); // autoplay blocked → the still is already there
  }, [inView, wantVideo]);

  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <img
        src={`/experience/${still}.jpg`}
        alt=""
        loading="lazy"
        className={`absolute inset-0 h-full w-full object-cover ${reduced ? "" : "mise-l-ken"}`}
      />
      {wantVideo ? (
        <video
          ref={vidRef}
          muted
          playsInline
          preload="none"
          src={`/experience/film/${video}.mp4`}
          onEnded={() => setShowVideo(false)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: showVideo ? 1 : 0, transition: "opacity 700ms ease" }}
        />
      ) : null}
      <div className="absolute inset-0" style={{ background: `rgba(2,8,6,${dim})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-transparent to-ink-950/80" />
    </div>
  );
}
