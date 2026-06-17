"use client";

// Top-level orchestrator for the cinematic landing journey:
//   • a tall invisible scroll-track drives `journeyProgress.value` (0→1)
//   • <FilmBackdrop/> renders the real-footage world behind everything
//   • <Overlay/> floats the crossfading story beats on top
//   • light chrome: nav, a scroll-progress hairline, a "scroll" cue, intro veil
// Nothing re-renders from React on scroll; scroll only writes a plain number.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import FilmBackdrop from "./FilmBackdrop";
import Overlay from "./Overlay";
import { journeyProgress } from "./progress";

const PAGES = 9; // ~100vh of scroll per story beat → a long, unhurried journey

export default function JourneyExperience() {
  const [intro, setIntro] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Scroll → progress (0..1). Direct write, no React state in the hot path.
  useEffect(() => {
    let last = false;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      journeyProgress.value = p;
      if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      const s = p > 0.01;
      if (s !== last) {
        last = s;
        setScrolled(s);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Lift the intro veil shortly after mount.
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 900);
    return () => clearTimeout(t);
  }, []);

  // Paint the document dark so rubber-band overscroll never flashes white.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.background;
    const prevBody = body.style.background;
    root.style.background = "#04080e";
    body.style.background = "#04080e";
    return () => {
      root.style.background = prevRoot;
      body.style.background = prevBody;
    };
  }, []);

  return (
    <div className="relative bg-black text-white">
      <FilmBackdrop />
      <Overlay />

      {/* ── chrome ── */}
      <div
        ref={barRef}
        className="fixed inset-x-0 top-0 z-40 h-[2px] origin-left bg-gradient-to-r from-emerald-400 via-emerald-300 to-amber-300"
        style={{ transform: "scaleX(0)" }}
      />

      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-lg font-semibold tracking-tight drop-shadow">Mise</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-100 drop-shadow transition hover:text-white sm:px-3"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-400 px-3.5 py-2 text-[13px] font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:shadow-xl sm:px-4 sm:text-sm"
          >
            Register your hotel
          </Link>
        </div>
      </header>

      {/* scroll cue */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-7 z-30 flex flex-col items-center gap-2 transition-opacity duration-500"
        style={{ opacity: scrolled ? 0 : 1 }}
      >
        <span className="font-mono text-[10px] tracking-[0.35em] text-white/80 drop-shadow">
          SCROLL TO EXPLORE
        </span>
        <span className="mise-scroll-chevron text-white/80">↓</span>
      </div>

      {/* intro veil — a quick branded fade so the first frame never flashes */}
      <div
        className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[#04080e] transition-opacity duration-700"
        style={{ opacity: intro ? 1 : 0, visibility: intro ? "visible" : "hidden" }}
      >
        <div className="flex flex-col items-center">
          <Logo size={52} />
          <p className="mt-5 font-display text-4xl text-white sm:text-5xl">Mise</p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-200/80">
            Every plate · Every penny
          </p>
        </div>
      </div>

      {/* the invisible scroll-track that gives the page its length */}
      <div style={{ height: `${PAGES * 100}vh` }} aria-hidden />
    </div>
  );
}
