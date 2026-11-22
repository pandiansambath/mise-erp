"use client";

// The cursor, on every design: "also that cursor animation".
//
// A dot that sits on the pointer and a ring that trails it, swelling over
// anything you can press and squeezing on a click. The native cursor stays —
// this is decoration around it, never a replacement a visitor has to find.
// Mouse only: touch screens and reduced-motion visitors never see it. DOM
// writes in one frame loop, which sleeps when the ring has caught up.

import { useEffect, useRef } from "react";

const HOT = "a,button,[role=button],input,textarea,select,label,[data-block],summary";

export function DevCursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const d = dot.current;
    const r = ring.current;
    if (!d || !r) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let rx = x;
    let ry = y;
    let raf = 0;
    let shown = false;
    const show = (on: boolean) => {
      shown = on;
      d.style.opacity = on ? "1" : "0";
      r.style.opacity = on ? "1" : "0";
    };
    const frame = () => {
      raf = 0;
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      d.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      r.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      if (Math.abs(x - rx) > 0.2 || Math.abs(y - ry) > 0.2) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      if (!shown) {
        rx = x;
        ry = y;
        show(true);
      }
      const hot = !!(e.target as Element | null)?.closest?.(HOT);
      if (hot) r.setAttribute("data-hot", "");
      else r.removeAttribute("data-hot");
      wake();
    };
    const down = () => r.setAttribute("data-down", "");
    const up = () => r.removeAttribute("data-down");
    const leave = () => show(false);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div ref={ring} aria-hidden className="dev-cursor-ring" />
      <div ref={dot} aria-hidden className="dev-cursor-dot" />
    </>
  );
}
