"use client";

// Full-bleed cinematic backdrop: a crisp still with up to TWO chained one-shot
// "morph" films layered above it. When the scene comes on (scroll-into-view,
// or an external `on` signal from the journey stage) the film fades in and
// plays once, then settles to the still. Leaving the scene REWINDS it, so
// coming back replays the moment — the site never goes dead on a second look.
//
// Films play on every device (~0.5–1MB each, pre-warmed into the HTTP cache).
// Only data-saver and reduced-motion visitors get stills alone.

import { useEffect, useRef, useState } from "react";
import { filmPath, HandoffVeil, stillPath, usePrefersReducedMotion, useSmallScreen } from "./bits";

type Stage = "idle" | "v0" | "v1" | "settled";

export default function CineMedia({
  still,
  preStill,
  videos = [],
  dim = 0.45,
  on,
  className = "",
}: {
  /** the DESTINATION still — what the scene settles on after the film */
  still: string;
  /** the film's opening world — shown before/while the film starts, so the
      first frame matches the backdrop and the destination is never spoiled */
  preStill?: string;
  /** up to two /experience/film clips (no extension), played back-to-back */
  videos?: string[];
  /** 0–1 darkness of the veil laid over the media */
  dim?: number;
  /** external play signal (journey stage); omit to self-observe visibility */
  on?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const small = useSmallScreen();
  const v0 = useRef<HTMLVideoElement>(null);
  const v1 = useRef<HTMLVideoElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [seen, setSeen] = useState(false); // self-observed visibility

  useEffect(() => {
    type NetInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    setAllowed(videos.length > 0 && !reduced && !conn?.saveData);
  }, [videos.length, reduced]);

  // Self-observe only when no external signal is given. Live (not once):
  // leaving re-arms the scene.
  useEffect(() => {
    if (on !== undefined) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setSeen(e.isIntersecting);
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [on]);

  // Pre-warm: start fetching the films while the scene is still ~a screen
  // away, so play() never waits on the network (preload="none" alone made
  // every film stall on arrival — the "loading takes so much time" bug).
  const warmed = useRef(false);
  useEffect(() => {
    if (!allowed) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !warmed.current) {
            warmed.current = true;
            v0.current?.load();
            v1.current?.load();
            io.disconnect();
          }
        }
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [allowed]);

  const active = on !== undefined ? on : seen;

  // Play when active; rewind + re-arm when not.
  useEffect(() => {
    const a = v0.current;
    const b = v1.current;
    if (!active) {
      setStage("idle");
      if (a) {
        a.pause();
        try { a.currentTime = 0; } catch { /* not loaded yet */ }
      }
      if (b) {
        b.pause();
        try { b.currentTime = 0; } catch { /* not loaded yet */ }
      }
      return;
    }
    if (!allowed) {
      setStage("settled");
      return;
    }
    // Let the stage crossfade land before the film starts.
    const t = window.setTimeout(() => {
      v0.current
        ?.play()
        .then(() => setStage("v0"))
        .catch(() => setStage("settled"));
    }, 380);
    return () => window.clearTimeout(t);
  }, [active, allowed]);

  // Bloom swells exactly as a film hands back to its still.
  const [bloom, setBloom] = useState(0);
  const settle = () => {
    setBloom((b) => b + 1);
    setStage("settled");
  };

  const advance = (from: 0 | 1) => {
    if (from === 0 && videos[1] && v1.current) {
      v1.current
        .play()
        .then(() => setStage("v1"))
        .catch(settle);
    } else {
      settle();
    }
  };

  // Before/while the film runs, show its opening world; settle on the
  // destination still only when the film lands (or when films are off).
  const showPre = allowed && preStill && stage !== "settled";

  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {preStill ? (
        <img
          src={stillPath(preStill, small)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: showPre ? 1 : 0, transition: "opacity 1000ms ease" }}
        />
      ) : null}
      <img
        src={stillPath(still, small)}
        alt=""
        loading="lazy"
        decoding="async"
        className={`absolute inset-0 h-full w-full object-cover ${reduced || !active ? "" : "mise-l-ken"}`}
        style={preStill ? { opacity: showPre ? 0 : 1, transition: "opacity 1000ms ease" } : undefined}
      />
      {allowed ? (
        <>
          <video
            ref={v0}
            muted
            playsInline
            preload="none"
            src={filmPath(videos[0], small)}
            onEnded={() => advance(0)}
            onError={() => setStage("settled")}
            className={
              small
                ? "mise-l-band absolute left-0 top-1/2 w-full -translate-y-1/2"
                : "absolute inset-0 h-full w-full object-cover"
            }
            style={{ opacity: stage === "v0" ? 1 : 0, transition: "opacity 1100ms ease" }}
          />
          {videos[1] ? (
            <video
              ref={v1}
              muted
              playsInline
              preload="none"
              src={filmPath(videos[1], small)}
              onEnded={() => advance(1)}
              onError={() => setStage("settled")}
              className={
                small
                  ? "mise-l-band absolute left-0 top-1/2 w-full -translate-y-1/2"
                  : "absolute inset-0 h-full w-full object-cover"
              }
              style={{ opacity: stage === "v1" ? 1 : 0, transition: "opacity 1100ms ease" }}
            />
          ) : null}
        </>
      ) : null}
      {bloom > 0 && <HandoffVeil key={bloom} />}
      <div className="absolute inset-0" style={{ background: `rgba(2,8,6,${dim})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950 via-transparent to-ink-950" />
    </div>
  );
}
